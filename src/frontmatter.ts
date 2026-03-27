import { App, TFile } from "obsidian";

export function getTerrainFromFile(app: App, path: string): string | null {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return null;
	const cache = app.metadataCache.getFileCache(file);
	const terrain = cache?.frontmatter?.terrain;
	return typeof terrain === "string" ? terrain : null;
}

export async function setTerrainInFile(app: App, path: string, terrainKey: string | null): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return false;
	await app.fileManager.processFrontMatter(file, (fm) => {
		if (terrainKey === null) {
			delete fm["terrain"];
		} else {
			fm["terrain"] = terrainKey;
		}
	});
	return true;
}

export function getIconOverrideFromFile(app: App, path: string): string | null {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return null;
	const cache = app.metadataCache.getFileCache(file);
	const icon = cache?.frontmatter?.icon;
	return typeof icon === "string" ? icon : null;
}

export async function setIconOverrideInFile(app: App, path: string, icon: string | null): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return false;
	await app.fileManager.processFrontMatter(file, (fm) => {
		if (icon === null) {
			delete fm["icon"];
		} else {
			fm["icon"] = icon;
		}
	});
	return true;
}
