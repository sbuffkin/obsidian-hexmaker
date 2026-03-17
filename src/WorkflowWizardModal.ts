import { App, Modal, TFile, Notice } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { normalizeFolder } from "./utils";
import { parseWorkflow, generateDefaultTemplate, stepPlaceholder, type Workflow } from "./workflow";
import { parseRandomTable, rollOnTable } from "./randomTable";

export class WorkflowWizardModal extends Modal {
	private workflow!: Workflow;
	// rolls[stepIdx][rollIdx] = result string or null (not yet rolled)
	private rolls: (string | null)[][] = [];
	private templateContent = "";
	private stepEntries: string[][] = []; // [stepIdx] → display labels from the table
	private resultTextarea!: HTMLTextAreaElement;
	private saveNoteNameInput!: HTMLInputElement;
	private saveResultsFolderInput!: HTMLInputElement;
	private saveNoteBtn!: HTMLButtonElement;
	private saveStatusEl!: HTMLElement;
	private stepsArea!: HTMLElement;

	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private workflowFile: TFile,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		const rawContent = await this.app.vault.read(this.workflowFile);
		this.workflow = parseWorkflow(rawContent, this.workflowFile.basename);

		// Initialise rolls array
		this.rolls = this.workflow.steps.map(step => Array(step.rolls).fill(null));

		// Preload table entries for each step (for the manual-pick dropdown)
		this.stepEntries = await Promise.all(
			this.workflow.steps.map(async (step) => {
				const tableFile = this.app.vault.getAbstractFileByPath(step.tablePath + ".md")
					?? this.app.metadataCache.getFirstLinkpathDest(step.tablePath, this.workflowFile.path);
				if (!(tableFile instanceof TFile)) return [];
				const content = await this.app.vault.read(tableFile);
				const table = parseRandomTable(content);
				return table.entries.map(e =>
					e.result.startsWith("[[")
						? (e.result.slice(2, -2).split("/").pop() ?? e.result.slice(2, -2))
						: e.result
				);
			})
		);

		// Load template
		if (this.workflow.templateFile) {
			const tmplFile = this.app.vault.getAbstractFileByPath(this.workflow.templateFile);
			if (tmplFile instanceof TFile) {
				this.templateContent = await this.app.vault.read(tmplFile);
			}
		}
		if (!this.templateContent) {
			this.templateContent = generateDefaultTemplate(this.workflow.steps);
		}

		this.titleEl.setText(this.workflowFile.basename);
		this.buildUI();
	}

	private buildUI(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-wf-wizard");

		// ── Header buttons ────────────────────────────────────────────────
		const header = contentEl.createDiv({ cls: "duckmage-wf-wizard-header" });

		const rollAllBtn = header.createEl("button", { text: "Roll all", cls: "mod-cta" });
		rollAllBtn.title = "Roll all unfilled slots";
		rollAllBtn.addEventListener("click", async () => {
			await this.rollAll(false);
		});

		const rerollAllBtn = header.createEl("button", { text: "Reroll all" });
		rerollAllBtn.title = "Reroll every slot";
		rerollAllBtn.addEventListener("click", async () => {
			await this.rollAll(true);
		});

		const copyResultBtn = header.createEl("button", { text: "Copy result" });
		copyResultBtn.addEventListener("click", () => {
			navigator.clipboard.writeText(this.resultTextarea?.value ?? "").then(() => {
				copyResultBtn.setText("Copied!");
				setTimeout(() => copyResultBtn.setText("Copy result"), 1500);
			});
		});

		// ── Steps area ────────────────────────────────────────────────────
		this.stepsArea = contentEl.createDiv({ cls: "duckmage-wf-wizard-steps" });
		this.renderSteps();

		// ── Result textarea ───────────────────────────────────────────────
		contentEl.createEl("p", { text: "Result", cls: "duckmage-table-editor-heading" });
		this.resultTextarea = contentEl.createEl("textarea", { cls: "duckmage-wf-template-area" });
		this.resultTextarea.style.minHeight = "120px";
		this.resultTextarea.readOnly = true;
		this.resultTextarea.value = this.assembleResult();

		// ── Save section ──────────────────────────────────────────────────
		contentEl.createEl("p", { text: "Save as note", cls: "duckmage-table-editor-heading" });

		const saveNoteNameRow = contentEl.createDiv({ cls: "duckmage-table-editor-name-row" });
		saveNoteNameRow.createEl("label", { text: "Note name", cls: "duckmage-table-editor-name-label" });
		this.saveNoteNameInput = saveNoteNameRow.createEl("input", {
			type: "text",
			cls: "duckmage-table-editor-name-input",
		});
		this.saveNoteNameInput.value = "";

		const saveResultsFolderRow = contentEl.createDiv({ cls: "duckmage-table-editor-name-row" });
		saveResultsFolderRow.createEl("label", { text: "Results folder", cls: "duckmage-table-editor-name-label" });
		this.saveResultsFolderInput = saveResultsFolderRow.createEl("input", {
			type: "text",
			cls: "duckmage-table-editor-name-input",
		});
		this.saveResultsFolderInput.value = normalizeFolder(this.workflow.resultsFolder ?? "");

		this.saveNoteBtn = contentEl.createEl("button", { text: "Save as note", cls: "mod-cta" });
		this.saveStatusEl = contentEl.createDiv({ cls: "duckmage-wf-save-status" });

		this.updateSaveButton();
		this.saveNoteBtn.addEventListener("click", async () => {
			await this.saveAsNote();
		});
	}

	private renderSteps(): void {
		this.stepsArea.empty();

		for (let si = 0; si < this.workflow.steps.length; si++) {
			const step = this.workflow.steps[si];
			const stepEl = this.stepsArea.createDiv({ cls: "duckmage-wf-wizard-step" });

			const stepHeader = stepEl.createDiv({ cls: "duckmage-wf-wizard-step-header" });
			const tableName = step.tablePath.split("/").pop() ?? step.tablePath;
			stepHeader.createEl("strong", { text: step.label || tableName });
			stepHeader.createSpan({ cls: "duckmage-wf-roll-badge", text: `×${step.rolls}` });

			for (let ri = 0; ri < step.rolls; ri++) {
				const rollRow = stepEl.createDiv({ cls: "duckmage-wf-step-row" });

				// Show the placeholder name as a label
				const varLabel = rollRow.createEl("code", { cls: "duckmage-wf-placeholder-label" });
				varLabel.setText(stepPlaceholder(step, ri));

				const rollInput = rollRow.createEl("input", {
					type: "text",
					cls: "duckmage-wf-roll-input" + (this.rolls[si][ri] !== null ? " is-rolled" : ""),
				});
				rollInput.value = this.rolls[si][ri] ?? "";
				rollInput.placeholder = "—";
				rollInput.addEventListener("input", () => {
					this.rolls[si][ri] = rollInput.value.trim() || null;
					this.updateResultTextarea();
					this.updateSaveButton();
				});

				const pickerSelect = rollRow.createEl("select", { cls: "duckmage-wf-pick-select" });
				pickerSelect.createEl("option", { value: "", text: "— pick —" });
				for (const label of (this.stepEntries[si] ?? [])) {
					pickerSelect.createEl("option", { value: label, text: label });
				}
				pickerSelect.addEventListener("change", () => {
					const picked = pickerSelect.value;
					if (!picked) return;
					this.rolls[si][ri] = picked;
					rollInput.value = picked;
					rollInput.classList.add("is-rolled");
					rollBtn.setText("Reroll");
					pickerSelect.value = "";
					this.updateResultTextarea();
					this.updateSaveButton();
				});

				const rollBtn = rollRow.createEl("button", {
					text: this.rolls[si][ri] !== null ? "Reroll" : "Roll",
				});
				rollBtn.addEventListener("click", async () => {
					rollBtn.disabled = true;
					rollBtn.setText("…");
					await this.rollStep(si, ri);
					rollInput.value = this.rolls[si][ri] ?? "";
					rollInput.classList.toggle("is-rolled", this.rolls[si][ri] !== null);
					rollBtn.setText("Reroll");
					rollBtn.disabled = false;
					this.updateResultTextarea();
					this.updateSaveButton();
				});
			}
		}
	}

	private async rollStep(stepIdx: number, rollIdx: number): Promise<void> {
		const step = this.workflow.steps[stepIdx];
		// Try exact path first, then Obsidian link resolution with workflow file as source
		const tableFile = this.app.vault.getAbstractFileByPath(step.tablePath + ".md")
			?? this.app.metadataCache.getFirstLinkpathDest(step.tablePath, this.workflowFile.path);
		if (!(tableFile instanceof TFile)) {
			new Notice(`Table not found: ${step.tablePath}`);
			return;
		}
		const content = await this.app.vault.read(tableFile);
		const table = parseRandomTable(content);
		const entry = rollOnTable(table);
		if (!entry) return;

		const displayLabel = entry.isLink
			? (entry.result.split("/").pop() ?? entry.result)
			: entry.result;

		this.rolls[stepIdx][rollIdx] = displayLabel;
	}

	/** Roll all unfilled slots (rerollAll=false) or every slot (rerollAll=true). */
	private async rollAll(rerollAll: boolean): Promise<void> {
		for (let si = 0; si < this.workflow.steps.length; si++) {
			for (let ri = 0; ri < this.workflow.steps[si].rolls; ri++) {
				if (rerollAll || this.rolls[si][ri] === null) {
					await this.rollStep(si, ri);
				}
			}
		}
		this.renderSteps();
		this.updateResultTextarea();
		this.updateSaveButton();
	}

	private assembleResult(): string {
		let result = this.templateContent;
		for (let si = 0; si < this.workflow.steps.length; si++) {
			const step = this.workflow.steps[si];
			for (let ri = 0; ri < step.rolls; ri++) {
				const placeholder = stepPlaceholder(step, ri);
				const value = this.rolls[si][ri];
				// Replace all occurrences of this placeholder
				const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				result = result.replace(new RegExp(escaped, "g"),
					value !== null ? value : `[${placeholder}]`);
			}
		}
		return result;
	}

	private updateResultTextarea(): void {
		if (this.resultTextarea) {
			this.resultTextarea.value = this.assembleResult();
		}
	}

	private allRolled(): boolean {
		return this.rolls.every(stepRolls => stepRolls.every(r => r !== null));
	}

	private updateSaveButton(): void {
		if (this.saveNoteBtn) {
			this.saveNoteBtn.disabled = !this.allRolled();
		}
	}

	private defaultNoteName(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
		return `${this.workflowFile.basename} ${ts}`;
	}

	private async saveAsNote(): Promise<void> {
		const noteName = this.saveNoteNameInput.value.trim();
		if (!noteName) {
			this.saveStatusEl.style.color = "var(--color-red)";
			this.saveStatusEl.setText("Note name is required.");
			return;
		}

		const folder = normalizeFolder(this.saveResultsFolderInput.value.trim());
		const notePath = folder ? `${folder}/${noteName}.md` : `${noteName}.md`;

		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			try { await this.app.vault.createFolder(folder); } catch { /* may already exist */ }
		}

		const noteContent = this.resultTextarea.value;

		try {
			let savedFile: TFile;
			const existing = this.app.vault.getAbstractFileByPath(notePath);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, noteContent);
				savedFile = existing;
			} else {
				savedFile = await this.app.vault.create(notePath, noteContent);
			}
			this.close();
			await this.app.workspace.getLeaf("tab").openFile(savedFile);
		} catch (err) {
			this.saveStatusEl.style.color = "var(--color-red)";
			this.saveStatusEl.setText(`Error: ${err}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
