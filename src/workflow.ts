export interface WorkflowStep {
	tablePath: string;  // vault-relative path, no .md extension
	rolls: number;      // >= 1
	label?: string;     // optional display name
}

export interface Workflow {
	name: string;
	resultsFolder?: string;
	templateFile?: string;
	steps: WorkflowStep[];
}

/** Parse a workflow markdown file into a Workflow. */
export function parseWorkflow(content: string, name: string): Workflow {
	const workflow: Workflow = { name, steps: [] };

	// Extract YAML frontmatter
	const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (fmMatch) {
		const fm = fmMatch[1];
		const rfMatch = /^results-folder:\s*(.+)$/m.exec(fm);
		if (rfMatch) workflow.resultsFolder = rfMatch[1].trim();
		const tfMatch = /^template-file:\s*(.+)$/m.exec(fm);
		if (tfMatch) workflow.templateFile = tfMatch[1].trim();
	}

	// Find the workflow steps table (| Table | Rolls | Label |)
	const tableMatch = /\|\s*Table\s*\|\s*Rolls\s*\|\s*Label\s*\|/i.exec(content);
	if (!tableMatch) return workflow;

	const afterHeader = content.slice(tableMatch.index);
	const lines = afterHeader.split("\n");

	// Skip header line and separator line
	for (let i = 2; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line.startsWith("|")) break;

		const cols = line.split("|").map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
		if (cols.length < 2) continue;

		const rawTable = cols[0];
		const rolls = parseInt(cols[1], 10);
		const label = cols[2] ?? "";

		if (!rawTable || isNaN(rolls) || rolls < 1) continue;

		// Extract path from [[link]] syntax or plain text
		const linkMatch = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(rawTable);
		const tablePath = linkMatch ? linkMatch[1].trim() : rawTable.trim();

		workflow.steps.push({
			tablePath,
			rolls,
			label: label || undefined,
		});
	}

	return workflow;
}

/** Serialize a Workflow back to markdown. */
export function buildWorkflowContent(workflow: Workflow): string {
	const lines: string[] = [];

	// Frontmatter
	lines.push("---");
	if (workflow.resultsFolder) lines.push(`results-folder: ${workflow.resultsFolder}`);
	if (workflow.templateFile) lines.push(`template-file: ${workflow.templateFile}`);
	lines.push("---");
	lines.push("");

	// Steps table
	lines.push("| Table | Rolls | Label |");
	lines.push("|-------|-------|-------|");
	for (const step of workflow.steps) {
		const tableCell = `[[${step.tablePath}]]`;
		const label = step.label ?? "";
		lines.push(`| ${tableCell} | ${step.rolls} | ${label} |`);
	}

	return lines.join("\n") + "\n";
}

/** Derive the variable base name for a step: label if set, else table basename with spaces→underscores. */
export function stepVarName(step: WorkflowStep): string {
	const base = step.label || (step.tablePath.split("/").pop() ?? step.tablePath);
	return base.replace(/ /g, "_");
}

/** Return the placeholder string for a specific roll of a step.
 *  Single-roll step: `$label`   Multi-roll step: `$label_1`, `$label_2`, … */
export function stepPlaceholder(step: WorkflowStep, rollIndex: number): string {
	const varName = stepVarName(step);
	return step.rolls === 1 ? `$${varName}` : `$${varName}_${rollIndex + 1}`;
}

/** Return an auto-generated template body with label-based placeholders per step. */
export function generateDefaultTemplate(steps: WorkflowStep[]): string {
	const lines: string[] = [];

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const heading = step.label || `Table ${i + 1}`;
		lines.push(`## ${heading}`);
		lines.push("");
		for (let r = 0; r < step.rolls; r++) {
			lines.push(stepPlaceholder(step, r));
		}
		lines.push("");
	}

	return lines.join("\n");
}

/** Return the list of all required placeholder strings for the given steps. */
export function requiredPlaceholders(steps: WorkflowStep[]): string[] {
	const placeholders: string[] = [];
	for (const step of steps) {
		for (let r = 0; r < step.rolls; r++) {
			placeholders.push(stepPlaceholder(step, r));
		}
	}
	return placeholders;
}
