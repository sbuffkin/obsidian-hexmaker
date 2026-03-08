import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, TFile, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE_HEX_MAP = "duckmage-hex-map";
const LINK_SECTIONS = ["Towns", "Dungeons", "Features"] as const;
type LinkSection = typeof LINK_SECTIONS[number];

const TEXT_SECTIONS = [
	{ key: "description",    label: "Description" },
	{ key: "landmark",       label: "Landmark" },
	{ key: "hidden",         label: "Hidden" },
	{ key: "secret",         label: "Secret" },
	{ key: "encounters",     label: "Encounters" },
	{ key: "weather",        label: "Weather" },
	{ key: "hooks & rumors", label: "Hooks & Rumors" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeFolder(path: string): string {
	return path.replace(/^\/+|\/+$/g, "") || "";
}

function getTerrainFromFile(app: App, path: string): string | null {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return null;
	const cache = app.metadataCache.getFileCache(file);
	const terrain = cache?.frontmatter?.terrain;
	return typeof terrain === "string" ? terrain : null;
}

async function setTerrainInFile(app: App, path: string, terrainKey: string | null): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return false;
	const content = await app.vault.read(file);
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	let newContent: string;
	if (fmMatch) {
		const fmBlock = fmMatch[1];
		const rest = content.slice(fmMatch[0].length);
		let newFm: string;
		if (terrainKey === null) {
			newFm = fmBlock.replace(/^\s*terrain:\s*[^\r\n]*(?:\r?\n)?/gm, "").trimEnd();
		} else {
			const terrainLine = /^\s*terrain:\s*.*$/m;
			newFm = terrainLine.test(fmBlock)
				? fmBlock.replace(terrainLine, `terrain: ${terrainKey}`)
				: fmBlock.trimEnd() + (fmBlock.endsWith("\n") ? "" : "\n") + `terrain: ${terrainKey}\n`;
		}
		newContent = `---\n${newFm}\n---\n${rest}`;
	} else {
		if (terrainKey === null) return true;
		newContent = `---\nterrain: ${terrainKey}\n---\n\n${content}`;
	}
	await app.vault.modify(file, newContent);
	return true;
}

function getIconUrl(plugin: DuckmagePlugin, iconFilename: string): string {
	return plugin.app.vault.adapter.getResourcePath(`${plugin.manifest.dir}/icons/${iconFilename}`);
}

/** Insert a wiki-link under the named ### section, creating the section if absent. */
async function addLinkToSection(app: App, filePath: string, section: string, linkText: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	let content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);

	if (!match) {
		content = content.trimEnd() + `\n\n### ${section}\n\n${linkText}\n`;
		await app.vault.modify(file, content);
		return;
	}

	const afterHeading = match.index + match[0].length;
	const nextHeadingMatch = /\n###? /m.exec(content.slice(afterHeading));
	const sectionEnd = nextHeadingMatch ? afterHeading + nextHeadingMatch.index : content.length;
	const sectionContent = content.slice(afterHeading, sectionEnd);

	if (sectionContent.includes(linkText)) return; // already present

	const trimmedSection = sectionContent.trimEnd();
	const insertAt = afterHeading + trimmedSection.length;
	content = content.slice(0, insertAt) + "\n\n" + linkText + content.slice(insertAt);
	await app.vault.modify(file, content);
}

/** Return all wiki-link targets found under a named ### section. */
async function getLinksInSection(app: App, filePath: string, section: string): Promise<string[]> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return [];
	const content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return [];

	const afterHeading = match.index + match[0].length;
	const nextHeadingMatch = /\n###? /m.exec(content.slice(afterHeading));
	const sectionEnd = nextHeadingMatch ? afterHeading + nextHeadingMatch.index : content.length;
	const sectionContent = content.slice(afterHeading, sectionEnd);

	const links: string[] = [];
	const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
	let m;
	while ((m = linkRegex.exec(sectionContent)) !== null) {
		links.push(m[1]);
	}
	return links;
}

/** Return the plain text body of a named ### section (stops at next heading or ---). */
async function getSectionContent(app: App, filePath: string, section: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return "";
	const content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return "";

	const afterHeading = match.index + match[0].length;
	const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
	return content.slice(afterHeading, sectionEnd).trim();
}

/** Replace the body of a named ### section in-place. */
async function setSectionContent(app: App, filePath: string, section: string, newText: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	let content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return;

	const afterHeading = match.index + match[0].length;
	const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;

	const replacement = newText.trim() ? `\n\n${newText.trim()}\n` : "\n";
	await app.vault.modify(file, content.slice(0, afterHeading) + replacement + content.slice(sectionEnd));
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TerrainColor {
	name: string;
	color: string;
	icon?: string;
}

interface DuckmagePluginSettings {
	mySetting: string;
	worldFolder: string;
	hexFolder: string;
	templatePath: string;
	hexGap: string;
	terrainPalette: TerrainColor[];
	gridSize: { cols: number; rows: number };
	gridOffset: { x: number; y: number };
	zoomLevel: number;
}

const DEFAULT_TERRAIN_PALETTE: TerrainColor[] = [
	// Open
	{ name: "grass",                  color: "#84cc16", icon: "bw-grassland.png" },
	{ name: "hills",                  color: "#a8a29e", icon: "bw-hills.png" },
	// Desert
	{ name: "desert",                 color: "#eab308", icon: "bw-desert.png" },
	{ name: "desert rocky",           color: "#d97706", icon: "bw-desert-rocky.png" },
	{ name: "dunes",                  color: "#fbbf24", icon: "bw-dunes.png" },
	{ name: "cactus",                 color: "#ca8a04", icon: "bw-cactus.png" },
	{ name: "cactus heavy",           color: "#b45309", icon: "bw-cactus-heavy.png" },
	{ name: "badlands",               color: "#c2410c", icon: "bw-badlands.png" },
	{ name: "brokenlands",            color: "#92400e", icon: "bw-brokenlands.png" },
	// Forest
	{ name: "forest",                 color: "#16a34a", icon: "bw-forest.png" },
	{ name: "forest heavy",           color: "#15803d", icon: "bw-forest-heavy.png" },
	{ name: "forested hills",         color: "#22c55e", icon: "bw-forested-hills.png" },
	{ name: "mixed forest",           color: "#16a34a", icon: "bw-forest-mixed.png" },
	{ name: "mixed forest heavy",     color: "#15803d", icon: "bw-forest-mixed-heavy.png" },
	{ name: "mixed forest hills",     color: "#22c55e", icon: "bw-forest-mixed-hills.png" },
	// Evergreen
	{ name: "evergreen",              color: "#166534", icon: "bw-evergreen.png" },
	{ name: "evergreen heavy",        color: "#14532d", icon: "bw-evergreen-heavy.png" },
	{ name: "evergreen hills",        color: "#4ade80", icon: "bw-evergreen-hills.png" },
	// Jungle
	{ name: "jungle",                 color: "#15803d", icon: "bw-jungle.png" },
	{ name: "jungle heavy",           color: "#14532d", icon: "bw-jungle-heavy.png" },
	{ name: "jungle hills",           color: "#4ade80", icon: "bw-jungle-hills.png" },
	// Mountains
	{ name: "mountain",               color: "#9ca3af", icon: "bw-mountains.png" },
	{ name: "mountain peak",          color: "#78716c", icon: "bw-mountain.png" },
	{ name: "mountains snow",         color: "#bfdbfe", icon: "bw-mountains-snow.png" },
	{ name: "snow",                   color: "#e0f2fe", icon: "bw-mountain-snow.png" },
	{ name: "forested mountain",      color: "#6b9e7c", icon: "bw-forested-mountain.png" },
	{ name: "forested mountains",     color: "#5e8c6a", icon: "bw-forested-mountains.png" },
	{ name: "mixed forest mountain",  color: "#6b9e7c", icon: "bw-forest-mixed-mountain.png" },
	{ name: "mixed forest mountains", color: "#5e8c6a", icon: "bw-forest-mixed-mountains.png" },
	{ name: "evergreen mountain",     color: "#6b7280", icon: "bw-evergreen-mountain.png" },
	{ name: "evergreen mountains",    color: "#4b5563", icon: "bw-evergreen-mountains.png" },
	{ name: "jungle mountain",        color: "#4d7c0f", icon: "bw-jungle-mountain.png" },
	{ name: "jungle mountains",       color: "#3f6212", icon: "bw-jungle-mountains.png" },
	// Volcanic
	{ name: "volcano",                color: "#b91c1c", icon: "bw-volcano.png" },
	{ name: "volcano dormant",        color: "#78350f", icon: "bw-volcano-dormant.png" },
	// Wetlands
	{ name: "marsh",                  color: "#4d7c0f", icon: "bw-marsh.png" },
	{ name: "swamp",                  color: "#365314", icon: "bw-swamp.png" },
	// Water / cliffs (no icons)
	{ name: "water",                  color: "#60a5fa" },
	{ name: "cliffs",                 color: "#a16207" },
];

const DEFAULT_SETTINGS: DuckmagePluginSettings = {
	mySetting: "default",
	worldFolder: "world",
	hexFolder: "world/hexes",
	templatePath: "",
	hexGap: "0.15",
	terrainPalette: DEFAULT_TERRAIN_PALETTE,
	gridSize: { cols: 20, rows: 16 },
	gridOffset: { x: 0, y: 0 },
	zoomLevel: 1,
};

const DEFAULT_HEX_TEMPLATE = `---
terrain:
---

# Hex {{x}}, {{y}}

**Region:**
**Terrain:**

---

### description

What the party sees and feels. Terrain, atmosphere, any obvious features.

---

### landmark

The visible standout feature — spire, ruin, lighthouse, statue, village — that can be spotted or used for navigation.

---

### Towns

---

### Dungeons

---

### Features

---

### hidden

Discoverable with exploration, tracking, or clues. Hidden lairs, ruins, tombs, camps, shortcuts.

---

### secret

Revealed only through specific actions, NPCs, or investigation.

---

### encounters

- **Table:** *(terrain from world/encounters)*
- **Custom / notable:**

---

### weather

Normal for region, or special (e.g. always pleasant, sandstorms, magic zone effect).

---

### hooks & rumors

Seeds for adventures, things locals might mention, or what finding this hex could lead to.
`;

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class DuckmagePlugin extends Plugin {
	settings: DuckmagePluginSettings;
	availableIcons: string[] = [];

	async onload() {
		await this.loadSettings();
		await this.loadAvailableIcons();

		this.registerView(VIEW_TYPE_HEX_MAP, (leaf) => new HexMapView(leaf, this));
		this.addRibbonIcon("map", "Duckmage: Open hex map", () => this.openHexMap());
		this.addCommand({
			id: "open-hex-map",
			name: "Open Duckmage hex map",
			callback: () => this.openHexMap(),
		});
		this.addSettingTab(new DuckmageSettingTab(this.app, this));
	}

	onunload() {}

	private openHexMap(): void {
		this.app.workspace.getLeaf(false).setViewState({ type: VIEW_TYPE_HEX_MAP });
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (!this.settings.gridOffset) this.settings.gridOffset = { x: 0, y: 0 };
		if (!Array.isArray(this.settings.terrainPalette) || this.settings.terrainPalette.length === 0) {
			this.settings.terrainPalette = [...DEFAULT_TERRAIN_PALETTE];
		} else {
			// Merge in any new default entries not already present by name
			const existing = new Set(this.settings.terrainPalette.map(e => e.name));
			for (const entry of DEFAULT_TERRAIN_PALETTE) {
				if (!existing.has(entry.name)) {
					this.settings.terrainPalette.push({ ...entry });
				}
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async loadAvailableIcons() {
		try {
			const result = await this.app.vault.adapter.list(`${this.manifest.dir}/icons`);
			this.availableIcons = result.files
				.filter(f => f.toLowerCase().endsWith(".png"))
				.map(f => f.split("/").pop() as string)
				.sort();
		} catch {
			this.availableIcons = [];
		}
	}

	hexPath(x: number, y: number): string {
		const folder = normalizeFolder(this.settings.hexFolder);
		return folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
	}

	/** Create a hex note from the configured template (or the built-in default). */
	async createHexNote(x: number, y: number): Promise<TFile | null> {
		const path = this.hexPath(x, y);
		const templatePath = (this.settings.templatePath ?? "").replace(/^\/+|\/+$/g, "");
		let content: string;

		if (templatePath) {
			try {
				content = await this.app.vault.adapter.read(templatePath);
			} catch {
				new Notice("Template not found: " + templatePath);
				return null;
			}
		} else {
			content = DEFAULT_HEX_TEMPLATE;
		}

		content = content
			.replace(/\{\{x\}\}/g, String(x))
			.replace(/\{\{y\}\}/g, String(y))
			.replace(/\{\{title\}\}/g, `Hex ${x}, ${y}`);

		const folder = normalizeFolder(this.settings.hexFolder);
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		try {
			return await this.app.vault.create(path, content);
		} catch (e) {
			new Notice("Could not create note: " + (e instanceof Error ? e.message : String(e)));
			return null;
		}
	}
}

// ─── Hex Map View ─────────────────────────────────────────────────────────────

class HexMapView extends ItemView {
	plugin: DuckmagePlugin;
	private zoom = 1;
	private panX = 0;
	private panY = 0;
	private viewportEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DuckmagePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_HEX_MAP; }
	getDisplayText(): string { return "Hex map"; }

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass("duckmage-hex-map-container");

		this.viewportEl = contentEl.createDiv({ cls: "duckmage-hex-map-viewport" });
		this.applyTransform();

		// ── Zoom (scroll wheel, no modifier required) ──────────────────────────
		this.registerDomEvent(contentEl, "wheel", (e: WheelEvent) => {
			e.preventDefault();
			const rect = contentEl.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
			const newZoom = Math.min(5, Math.max(0.2, this.zoom * factor));
			this.panX = cx - (cx - this.panX) * (newZoom / this.zoom);
			this.panY = cy - (cy - this.panY) * (newZoom / this.zoom);
			this.zoom = newZoom;
			this.applyTransform();
		}, { passive: false });

		// ── Pan (click-drag) ───────────────────────────────────────────────────
		let isDragging = false;
		let hasDragged = false;
		let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

		this.registerDomEvent(contentEl, "mousedown", (e: MouseEvent) => {
			if (e.button !== 0) return;
			isDragging = true;
			hasDragged = false;
			dragStartX = e.clientX;
			dragStartY = e.clientY;
			panStartX = this.panX;
			panStartY = this.panY;
			this.viewportEl?.addClass("is-dragging");
		});

		this.registerDomEvent(document, "mousemove", (e: MouseEvent) => {
			if (!isDragging) return;
			const dx = e.clientX - dragStartX;
			const dy = e.clientY - dragStartY;
			if (!hasDragged && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) hasDragged = true;
			if (hasDragged) {
				this.panX = panStartX + dx;
				this.panY = panStartY + dy;
				this.applyTransform();
			}
		});

		this.registerDomEvent(document, "mouseup", () => {
			isDragging = false;
			this.viewportEl?.removeClass("is-dragging");
		});

		// Swallow clicks that ended a drag so hex click-handlers don't fire
		this.registerDomEvent(contentEl, "click", (e: MouseEvent) => {
			if (hasDragged) { e.stopPropagation(); hasDragged = false; }
		}, { capture: true } as AddEventListenerOptions);

		this.createExpandButtons(contentEl);
		this.renderGrid();
	}

	private createExpandButtons(container: HTMLElement): void {
		const dirs = [
			{
				cls: "duckmage-expand-top",
				action: async () => {
					this.plugin.settings.gridOffset.y--;
					this.plugin.settings.gridSize.rows++;
					await this.plugin.saveSettings();
					this.renderGrid();
				},
			},
			{
				cls: "duckmage-expand-bottom",
				action: async () => {
					this.plugin.settings.gridSize.rows++;
					await this.plugin.saveSettings();
					this.renderGrid();
				},
			},
			{
				cls: "duckmage-expand-left",
				action: async () => {
					this.plugin.settings.gridOffset.x--;
					this.plugin.settings.gridSize.cols++;
					await this.plugin.saveSettings();
					this.renderGrid();
				},
			},
			{
				cls: "duckmage-expand-right",
				action: async () => {
					this.plugin.settings.gridSize.cols++;
					await this.plugin.saveSettings();
					this.renderGrid();
				},
			},
		];
		for (const { cls, action } of dirs) {
			const btn = container.createEl("button", { cls: `duckmage-expand-btn ${cls}`, text: "+" });
			btn.addEventListener("click", action);
		}
	}

	private applyTransform(): void {
		if (this.viewportEl) {
			this.viewportEl.style.transform =
				`translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
		}
	}

	renderGrid(terrainOverrides?: Map<string, string | null>): void {
		if (!this.viewportEl) return;
		this.viewportEl.empty();

		const gap = this.plugin.settings.hexGap?.trim() || "0.15";
		this.viewportEl.style.setProperty("--duckmage-hex-gap", /^\d*\.?\d+$/.test(gap) ? `${gap}em` : gap);

		const { cols, rows } = this.plugin.settings.gridSize;
		const { x: ox, y: oy } = this.plugin.settings.gridOffset;
		const folder = normalizeFolder(this.plugin.settings.hexFolder);
		const palette = this.plugin.settings.terrainPalette ?? [];
		const gridContainer = this.viewportEl.createDiv({ cls: "duckmage-hex-map-grid" });

		for (let j = 0; j < rows; j++) {
			const y = oy + j;
			// Stagger based on the actual y coordinate so adding rows above never shifts the pattern
			const rowEl = gridContainer.createDiv({
				cls: `duckmage-hex-row${y % 2 !== 0 ? " duckmage-hex-row-offset" : ""}`,
			});
			for (let i = 0; i < cols; i++) {
				const x = ox + i;
				const path = folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
				const exists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
				const terrainKey = terrainOverrides?.has(path)
					? terrainOverrides.get(path)!
					: getTerrainFromFile(this.app, path);
				const terrainEntry = terrainKey != null ? palette.find(p => p.name === terrainKey) : undefined;

				const hexEl = rowEl.createDiv({
					cls: `duckmage-hex${exists ? " duckmage-hex-exists" : ""}`,
					attr: { "data-x": String(x), "data-y": String(y) },
				});
				hexEl.tabIndex = -1;

				if (terrainEntry?.color) hexEl.style.backgroundColor = terrainEntry.color;

				if (terrainEntry?.icon) {
					const img = hexEl.createEl("img", { cls: "duckmage-hex-icon" });
					img.src = getIconUrl(this.plugin, terrainEntry.icon);
					img.alt = terrainEntry.name;
				}

				hexEl.createSpan({ cls: "duckmage-hex-label", text: `${x},${y}` });
				if (exists) hexEl.createSpan({ cls: "duckmage-hex-dot" });

				hexEl.addEventListener("click", () => this.onHexClick(x, y));
				hexEl.addEventListener("contextmenu", (evt) => this.onHexContextMenu(evt, x, y));
			}
		}
	}

	private onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
		evt.preventDefault();
		new HexEditorModal(this.app, this.plugin, x, y, (overrides) => this.renderGrid(overrides)).open();
	}

	private async onHexClick(x: number, y: number): Promise<void> {
		const path = this.plugin.hexPath(x, y);
		const abstract = this.app.vault.getAbstractFileByPath(path);
		let fileToOpen: TFile | null = abstract instanceof TFile ? abstract : null;

		if (!fileToOpen) {
			fileToOpen = await this.plugin.createHexNote(x, y);
			if (fileToOpen) this.renderGrid();
			else return;
		}

		await this.app.workspace.getLeaf(false).openFile(fileToOpen);
	}
}

// ─── Hex Editor Modal ─────────────────────────────────────────────────────────

class HexEditorModal extends Modal {
	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private x: number,
		private y: number,
		private onChanged: (overrides?: Map<string, string | null>) => void,
	) {
		super(app);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");
		contentEl.createEl("h2", { text: `Hex ${this.x}, ${this.y}` });

		const path = this.plugin.hexPath(this.x, this.y);
		const hexExists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;

		this.renderTerrainSection(contentEl, path);

		contentEl.createEl("hr", { cls: "duckmage-editor-divider" });
		contentEl.createEl("h3", { text: "World features" });

		for (const section of LINK_SECTIONS) {
			await this.renderLinkSection(contentEl, path, section, hexExists);
		}

		contentEl.createEl("hr", { cls: "duckmage-editor-divider" });
		contentEl.createEl("h3", { text: "Notes" });

		for (const { key, label } of TEXT_SECTIONS) {
			await this.renderTextSection(contentEl, path, key, label);
		}
	}

	onClose() { this.contentEl.empty(); }

	private renderTerrainSection(container: HTMLElement, path: string): void {
		const currentTerrain = getTerrainFromFile(this.app, path);
		const palette = this.plugin.settings.terrainPalette;

		const section = container.createDiv({ cls: "duckmage-editor-section" });
		section.createEl("h3", { text: "Terrain" });

		const grid = section.createDiv({ cls: "duckmage-terrain-picker" });

		for (const entry of palette) {
			const btn = grid.createDiv({
				cls: `duckmage-terrain-option${entry.name === currentTerrain ? " is-selected" : ""}`,
			});

			const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
			preview.style.backgroundColor = entry.color;

			if (entry.icon) {
				const img = preview.createEl("img", { cls: "duckmage-terrain-preview-icon" });
				img.src = getIconUrl(this.plugin, entry.icon);
				img.alt = entry.name;
			}

			btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });

			btn.addEventListener("click", async () => {
				await this.ensureHexNote();
				await setTerrainInFile(this.app, path, entry.name);
				this.onChanged(new Map([[path, entry.name]]));
				this.close();
			});
		}

		if (currentTerrain) {
			const clearBtn = section.createEl("button", { text: "Clear terrain", cls: "duckmage-clear-btn mod-warning" });
			clearBtn.addEventListener("click", async () => {
				await setTerrainInFile(this.app, path, null);
				this.onChanged(new Map([[path, null]]));
				this.close();
			});
		}
	}

	private async renderLinkSection(
		container: HTMLElement,
		path: string,
		section: LinkSection,
		hexExists: boolean,
	): Promise<void> {
		const sectionEl = container.createDiv({ cls: "duckmage-editor-link-section" });
		const header = sectionEl.createDiv({ cls: "duckmage-link-section-header" });
		header.createEl("h4", { text: section });
		const addBtn = header.createEl("button", { text: "+ Add", cls: "duckmage-add-btn" });
		const linksEl = sectionEl.createDiv({ cls: "duckmage-link-list" });

		if (hexExists) {
			const links = await getLinksInSection(this.app, path, section);
			this.renderLinkList(linksEl, links);
		} else {
			linksEl.createSpan({ text: "—", cls: "duckmage-link-empty" });
		}

		addBtn.addEventListener("click", () => {
			new FileLinkSuggestModal(this.app, this.plugin, async (file) => {
				const hexFile = await this.ensureHexNote();
				if (!hexFile) { new Notice("Could not create hex note."); return; }
				const linkText = `[[${this.app.metadataCache.fileToLinktext(file, path)}]]`;
				await addLinkToSection(this.app, path, section, linkText);
				this.onChanged();
				const links = await getLinksInSection(this.app, path, section);
				linksEl.empty();
				this.renderLinkList(linksEl, links);
			}).open();
		});
	}

	private renderLinkList(container: HTMLElement, links: string[]): void {
		if (links.length === 0) {
			container.createSpan({ text: "None", cls: "duckmage-link-empty" });
		} else {
			for (const link of links) {
				container.createDiv({ text: `[[${link}]]`, cls: "duckmage-link-item" });
			}
		}
	}

	private async renderTextSection(
		container: HTMLElement,
		path: string,
		section: string,
		label: string,
	): Promise<void> {
		const hexFile = this.app.vault.getAbstractFileByPath(path);
		const currentContent = hexFile instanceof TFile
			? await getSectionContent(this.app, path, section)
			: "";

		const sectionEl = container.createDiv({ cls: "duckmage-editor-text-section" });
		sectionEl.createEl("label", { text: label, cls: "duckmage-text-section-label" });
		const textarea = sectionEl.createEl("textarea", { cls: "duckmage-text-section-textarea" });
		textarea.rows = 3;
		textarea.placeholder = `${label}…`;
		textarea.value = currentContent;

		textarea.addEventListener("blur", async () => {
			const file = await this.ensureHexNote();
			if (!file) return;
			await setSectionContent(this.app, path, section, textarea.value);
			this.onChanged();
		});
	}

	private async ensureHexNote(): Promise<TFile | null> {
		const path = this.plugin.hexPath(this.x, this.y);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		return this.plugin.createHexNote(this.x, this.y);
	}
}

// ─── File Suggest Modal ───────────────────────────────────────────────────────

class FileLinkSuggestModal extends SuggestModal<TFile> {
	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private onChoose: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Search for a file to link...");
	}

	getSuggestions(query: string): TFile[] {
		const rootFolder = normalizeFolder(this.plugin.settings.worldFolder?.trim() ?? "");
		let files: TFile[];
		if (rootFolder) {
			files = this.app.vault.getFiles().filter(
				f => f.path.startsWith(rootFolder + "/") || f.path === rootFolder,
			);
		} else {
			files = this.app.vault.getFiles();
		}
		return files
			.filter(f => f.basename.toLowerCase().contains(query.toLowerCase()))
			.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createSpan({ text: file.basename });
		el.createEl("small", { text: ` — ${file.path}`, cls: "duckmage-suggestion-path" });
	}

	onChooseSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(file);
	}
}

// ─── Settings ─────────────────────────────────────────────────────────────────

class DuckmageSettingTab extends PluginSettingTab {
	plugin: DuckmagePlugin;

	constructor(app: App, plugin: DuckmagePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("World notes folder")
			.setDesc("Vault-relative path. Scopes the file search when adding links to hexes.")
			.addText(text =>
				text
					.setPlaceholder("world")
					.setValue(this.plugin.settings.worldFolder)
					.onChange(async value => {
						this.plugin.settings.worldFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Hex notes folder")
			.setDesc("Vault-relative path where hex notes (x_y.md) are stored.")
			.addText(text =>
				text
					.setPlaceholder("world/hexes")
					.setValue(this.plugin.settings.hexFolder)
					.onChange(async value => {
						this.plugin.settings.hexFolder = normalizeFolder(value ?? "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Template path")
			.setDesc("Vault-relative path to a hex note template. Supports {{x}}, {{y}}, {{title}}. Include ## Towns, ## Dungeons, and ## Features headings for the link sections.")
			.addText(text =>
				text
					.setPlaceholder("templates/hex.md")
					.setValue(this.plugin.settings.templatePath)
					.onChange(async value => {
						this.plugin.settings.templatePath = (value ?? "").replace(/^\/+|\/+$/g, "");
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Grid width")
			.setDesc("Number of hex columns.")
			.addText(text =>
				text
					.setPlaceholder("20")
					.setValue(String(this.plugin.settings.gridSize.cols))
					.onChange(async value => {
						this.plugin.settings.gridSize.cols = Number(value.trim()) || 20;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Grid height")
			.setDesc("Number of hex rows.")
			.addText(text =>
				text
					.setPlaceholder("16")
					.setValue(String(this.plugin.settings.gridSize.rows))
					.onChange(async value => {
						this.plugin.settings.gridSize.rows = Number(value.trim()) || 16;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Hex cell spacing")
			.setDesc("Gap between hex cells. A bare number is treated as em units (e.g. 0.15), or append em/px.")
			.addText(text =>
				text
					.setPlaceholder("0.15")
					.setValue(this.plugin.settings.hexGap ?? "0.15")
					.onChange(async value => {
						this.plugin.settings.hexGap = (value ?? "0.15").trim() || "0";
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Terrain palette" });
		containerEl.createEl("p", {
			text: "Right-click a hex to set terrain. Each type can have a fill color and an icon from the plugin's icons folder.",
			cls: "setting-item-description",
		});

		const listEl = containerEl.createDiv({ cls: "duckmage-palette-list" });
		const palette = this.plugin.settings.terrainPalette ?? [];

		for (let i = 0; i < palette.length; i++) {
			const entry = palette[i];
			const itemEl = listEl.createDiv({ cls: "duckmage-palette-item" });

			new Setting(itemEl)
				.addText(text =>
					text
						.setPlaceholder("Name")
						.setValue(entry.name)
						.onChange(async value => {
							entry.name = (value ?? "").trim() || entry.name;
							await this.plugin.saveSettings();
						}),
				)
				.addColorPicker(color =>
					color.setValue(entry.color).onChange(async value => {
						entry.color = value;
						await this.plugin.saveSettings();
					}),
				)
				.addDropdown(dropdown => {
					dropdown.addOption("", "— no icon —");
					for (const icon of this.plugin.availableIcons) {
						const label = icon.replace(/^bw-/, "").replace(/\.png$/, "").replace(/-/g, " ");
						dropdown.addOption(icon, label);
					}
					dropdown.setValue(entry.icon ?? "");
					dropdown.onChange(async value => {
						entry.icon = value || undefined;
						await this.plugin.saveSettings();
					});
				})
				.addExtraButton(btn =>
					btn.setIcon("trash-2").onClick(async () => {
						this.plugin.settings.terrainPalette.splice(i, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
				);
		}

		new Setting(containerEl).addButton(btn =>
			btn.setButtonText("Add terrain type").onClick(async () => {
				this.plugin.settings.terrainPalette.push({ name: "New", color: "#888888" });
				await this.plugin.saveSettings();
				this.display();
			}),
		);
	}
}
