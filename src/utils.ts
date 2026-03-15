import type DuckmagePlugin from "./DuckmagePlugin";

export function normalizeFolder(path: string): string {
	return path.replace(/^\/+|\/+$/g, "") || "";
}

export function makeTableTemplate(dice: number, extraFrontmatter?: Record<string, string | boolean | number>, preamble?: string): string {
	const rows = "|  | 1 |";
	const extra = extraFrontmatter
		? Object.entries(extraFrontmatter).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n"
		: "";
	const preambleBlock = preamble ? `\n${preamble}\n` : "";
	return `---\ndice: ${dice}\n${extra}---\n${preambleBlock}\n| Result | Weight |\n|--------|--------|\n${rows}\n`;
}

export function getIconUrl(plugin: DuckmagePlugin, iconFilename: string): string {
	if (plugin.vaultIconsSet.has(iconFilename)) {
		const folder = normalizeFolder(plugin.settings.iconsFolder ?? "");
		return plugin.app.vault.adapter.getResourcePath(`${folder}/${iconFilename}`);
	}
	return plugin.app.vault.adapter.getResourcePath(`${plugin.manifest.dir}/icons/${iconFilename}`);
}
