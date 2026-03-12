import { App, Modal, Setting, TFile } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import type { TerrainColor } from "./types";
import { normalizeFolder } from "./utils";

export class TerrainEntryEditorModal extends Modal {
	// Pending values — only written to the entry on Save
	private pendingName: string;
	private pendingColor: string;
	private pendingIcon: string | undefined;
	private readonly originalName: string;

	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private entry: TerrainColor,
		private onSave: () => void,
		private onDelete: () => void,
	) {
		super(app);
		this.originalName = entry.name;
		this.pendingName  = entry.name;
		this.pendingColor = entry.color;
		this.pendingIcon  = entry.icon;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");
		contentEl.createEl("h2", { text: "Edit terrain type" });

		new Setting(contentEl)
			.setName("Name")
			.addText(text =>
				text
					.setValue(this.pendingName)
					.onChange(value => { this.pendingName = value.trim() || this.pendingName; }),
			);

		new Setting(contentEl)
			.setName("Color")
			.addColorPicker(color =>
				color
					.setValue(this.pendingColor)
					.onChange(value => { this.pendingColor = value; }),
			);

		new Setting(contentEl)
			.setName("Icon")
			.addDropdown(dropdown => {
				dropdown.addOption("", "— no icon —");
				for (const icon of this.plugin.availableIcons) {
					const label = icon.replace(/^bw-/, "").replace(/\.png$/, "").replace(/-/g, " ");
					dropdown.addOption(icon, label);
				}
				dropdown.setValue(this.pendingIcon ?? "");
				dropdown.onChange(value => { this.pendingIcon = value || undefined; });
			});

		const btnRow = contentEl.createDiv({ cls: "duckmage-tee-buttons" });

		const saveBtn = btnRow.createEl("button", { cls: "mod-cta", text: "Save" });
		saveBtn.addEventListener("click", async () => {
			const nameChanged = this.pendingName !== this.originalName;
			this.entry.name  = this.pendingName;
			this.entry.color = this.pendingColor;
			this.entry.icon  = this.pendingIcon;
			if (nameChanged) await this.renameTerrainTables(this.originalName, this.pendingName);
			await this.plugin.saveSettings();
			this.plugin.refreshHexMap();
			this.onSave();
			this.close();
		});

		btnRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

		const deleteBtn = btnRow.createEl("button", { cls: "duckmage-btn-danger", text: "Delete" });
		deleteBtn.addEventListener("click", async () => {
			const idx = this.plugin.settings.terrainPalette.indexOf(this.entry);
			if (idx >= 0) this.plugin.settings.terrainPalette.splice(idx, 1);
			await this.plugin.saveSettings();
			this.onDelete();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private getTerrainTablePath(name: string, type: "description" | "encounters"): string {
		const folder = normalizeFolder(this.plugin.settings.tablesFolder);
		const sub = folder ? `${folder}/terrain` : "terrain";
		return `${sub}/${name} - ${type}.md`;
	}

	private async renameTerrainTables(oldName: string, newName: string): Promise<void> {
		for (const type of ["description", "encounters"] as const) {
			const oldPath = this.getTerrainTablePath(oldName, type);
			const newPath = this.getTerrainTablePath(newName, type);
			const file = this.app.vault.getAbstractFileByPath(oldPath);
			if (file instanceof TFile) {
				try { await this.app.vault.rename(file, newPath); } catch { /* ignore */ }
			}
		}
	}
}
