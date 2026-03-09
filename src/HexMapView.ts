import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { normalizeFolder, getIconUrl } from "./utils";
import { getTerrainFromFile, getIconOverrideFromFile, setTerrainInFile } from "./frontmatter";
import { HexEditorModal } from "./HexEditorModal";
import { TerrainPickerModal } from "./TerrainPickerModal";
import { VIEW_TYPE_HEX_MAP } from "./constants";

export class HexMapView extends ItemView {
	plugin: DuckmagePlugin;
	private zoom = 1;
	private panX = 0;
	private panY = 0;
	private viewportEl: HTMLElement | null = null;
	private drawingMode: "road" | "river" | "terrain" | null = null;
	private roadToolbarBtn: HTMLButtonElement | null = null;
	private riverToolbarBtn: HTMLButtonElement | null = null;
	private terrainToolbarBtn: HTMLButtonElement | null = null;
	private terrainBtnPreview: HTMLSpanElement | null = null;
	// The last-clicked hex key in each drawing mode — the next click extends from here
	private activeRoadEnd: string | null = null;
	private activeRiverEnd: string | null = null;
	private paintTerrainName: string | null = null;

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

		// ── Pan (click-drag) & Terrain drag-paint ─────────────────────────────
		let isDragging = false;
		let hasDragged = false;
		let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;
		let isTerrainPainting = false;
		let lastPaintedKey: string | null = null;

		this.registerDomEvent(contentEl, "mousedown", (e: MouseEvent) => {
			if (e.button !== 0) return;
			if (this.drawingMode === "terrain") {
				isTerrainPainting = true;
				lastPaintedKey = null;
				// Paint the hex under the cursor immediately
				const hexEl = (e.target as HTMLElement).closest<HTMLElement>(".duckmage-hex");
				if (hexEl) {
					const x = Number(hexEl.dataset.x);
					const y = Number(hexEl.dataset.y);
					lastPaintedKey = `${x}_${y}`;
					this.onHexPaintClick(x, y);
					hasDragged = true; // suppress the subsequent click event
				}
				return; // skip pan setup
			}
			isDragging = true;
			hasDragged = false;
			dragStartX = e.clientX;
			dragStartY = e.clientY;
			panStartX = this.panX;
			panStartY = this.panY;
			this.viewportEl?.addClass("is-dragging");
		});

		this.registerDomEvent(document, "mousemove", (e: MouseEvent) => {
			if (isTerrainPainting) {
				const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
				const hexEl = el?.closest<HTMLElement>(".duckmage-hex");
				if (hexEl) {
					const x = Number(hexEl.dataset.x);
					const y = Number(hexEl.dataset.y);
					const key = `${x}_${y}`;
					if (key !== lastPaintedKey) {
						lastPaintedKey = key;
						this.onHexPaintClick(x, y);
					}
				}
				return;
			}
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
			isTerrainPainting = false;
			lastPaintedKey = null;
			isDragging = false;
			this.viewportEl?.removeClass("is-dragging");
		});

		// Swallow clicks that ended a drag so hex click-handlers don't fire
		this.registerDomEvent(contentEl, "click", (e: MouseEvent) => {
			if (hasDragged) { e.stopPropagation(); hasDragged = false; }
		}, { capture: true } as AddEventListenerOptions);

		// Right-click anywhere exits terrain mode (before hex contextmenu fires)
		this.registerDomEvent(contentEl, "contextmenu", (e: MouseEvent) => {
			if (this.drawingMode !== "terrain") return;
			e.preventDefault();
			e.stopPropagation();
			this.exitTerrainMode();
		}, { capture: true } as AddEventListenerOptions);

		this.createExpandButtons(contentEl);
		this.createDrawingToolbar(contentEl);
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

	private createDrawingToolbar(container: HTMLElement): void {
		const toolbar = container.createDiv({ cls: "duckmage-draw-toolbar" });
		this.roadToolbarBtn    = toolbar.createEl("button", { cls: "duckmage-draw-btn", text: "Road" });
		this.riverToolbarBtn   = toolbar.createEl("button", { cls: "duckmage-draw-btn", text: "River" });
		this.terrainToolbarBtn = toolbar.createEl("button", { cls: "duckmage-draw-btn duckmage-draw-btn-terrain" });
		this.terrainToolbarBtn.createSpan({ text: "Terrain" });
		this.terrainBtnPreview = this.terrainToolbarBtn.createSpan({ cls: "duckmage-terrain-btn-preview" });
		this.roadToolbarBtn.addEventListener("click",    () => this.setDrawingMode("road"));
		this.riverToolbarBtn.addEventListener("click",   () => this.setDrawingMode("river"));
		this.terrainToolbarBtn.addEventListener("click", () => this.handleTerrainButton());
	}

	private setDrawingMode(mode: "road" | "river"): void {
		this.drawingMode = this.drawingMode === mode ? null : mode;
		this.paintTerrainName = null;
		this.updateToolbarButtonStates();
		this.updateRoadRiverOverlay(); // refresh active-end marker visibility
	}

	private handleTerrainButton(): void {
		// Always open the picker — even if already active, so user can switch terrain
		new TerrainPickerModal(this.app, this.plugin, (terrainName: string | null) => {
			this.drawingMode = "terrain";
			this.paintTerrainName = terrainName;
			this.updateToolbarButtonStates();
		}).open();
	}

	private exitTerrainMode(): void {
		if (this.drawingMode !== "terrain") return;
		this.drawingMode = null;
		this.paintTerrainName = null;
		this.updateToolbarButtonStates();
	}

	private updateToolbarButtonStates(): void {
		this.roadToolbarBtn?.toggleClass("is-active", this.drawingMode === "road");
		this.riverToolbarBtn?.toggleClass("is-active", this.drawingMode === "river");
		this.terrainToolbarBtn?.toggleClass("is-active", this.drawingMode === "terrain");
		this.viewportEl?.toggleClass("duckmage-draw-mode", this.drawingMode !== null);
		if (this.drawingMode === "terrain") {
			const entry = this.paintTerrainName
				? this.plugin.settings.terrainPalette.find(p => p.name === this.paintTerrainName)
				: undefined;
			if (entry) {
				if (this.terrainToolbarBtn) {
					this.terrainToolbarBtn.style.borderColor = entry.color;
					this.terrainToolbarBtn.style.color = entry.color;
				}
				if (this.terrainBtnPreview) {
					this.terrainBtnPreview.style.backgroundColor = entry.color;
					this.terrainBtnPreview.style.display = "inline-block";
				}
			} else {
				// Clear mode — show active state without a color
				if (this.terrainToolbarBtn) {
					this.terrainToolbarBtn.style.borderColor = "";
					this.terrainToolbarBtn.style.color = "";
				}
				if (this.terrainBtnPreview) {
					this.terrainBtnPreview.style.display = "none";
				}
			}
		} else {
			if (this.terrainToolbarBtn) {
				this.terrainToolbarBtn.style.borderColor = "";
				this.terrainToolbarBtn.style.color = "";
			}
			if (this.terrainBtnPreview) {
				this.terrainBtnPreview.style.display = "none";
			}
		}
	}

	private applyTransform(): void {
		if (this.viewportEl) {
			this.viewportEl.style.transform =
				`translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
		}
	}

	renderGrid(terrainOverrides?: Map<string, string | null>, iconOverrides?: Map<string, string | null>): void {
		if (!this.viewportEl) return;
		this.viewportEl.empty();

		const gap = this.plugin.settings.hexGap?.trim() || "0.15";
		this.viewportEl.style.setProperty("--duckmage-hex-gap", /^\d*\.?\d+$/.test(gap) ? `${gap}em` : gap);

		const { cols, rows } = this.plugin.settings.gridSize;
		const { x: ox, y: oy } = this.plugin.settings.gridOffset;
		const folder = normalizeFolder(this.plugin.settings.hexFolder);
		const palette = this.plugin.settings.terrainPalette ?? [];
		const isFlat = this.plugin.settings.hexOrientation === "flat";
		const gridContainer = this.viewportEl.createDiv({
			cls: `duckmage-hex-map-grid${isFlat ? " duckmage-grid-flat" : ""}`,
		});

		const addHex = (parent: HTMLElement, x: number, y: number) => {
			const path = folder ? `${folder}/${x}_${y}.md` : `${x}_${y}.md`;
			const exists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
			const terrainKey = terrainOverrides?.has(path)
				? terrainOverrides.get(path)!
				: getTerrainFromFile(this.app, path);
			const terrainEntry = terrainKey != null ? palette.find(p => p.name === terrainKey) : undefined;

			const hexEl = parent.createDiv({
				cls: `duckmage-hex${exists ? " duckmage-hex-exists" : ""}`,
				attr: { "data-x": String(x), "data-y": String(y) },
			});
			hexEl.tabIndex = -1;

			if (terrainEntry?.color) hexEl.style.backgroundColor = terrainEntry.color;

			const iconOverride = iconOverrides?.has(path)
				? iconOverrides.get(path)!
				: getIconOverrideFromFile(this.app, path);
			const iconToShow = iconOverride ?? terrainEntry?.icon;
			if (iconToShow) {
				const img = hexEl.createEl("img", { cls: "duckmage-hex-icon" });
				img.src = getIconUrl(this.plugin, iconToShow);
				img.alt = terrainEntry?.name ?? "";
			}

			hexEl.createSpan({ cls: "duckmage-hex-label", text: `${x},${y}` });
			if (exists && !terrainEntry) hexEl.createSpan({ cls: "duckmage-hex-dot" });

			hexEl.addEventListener("click", () => this.onHexClick(x, y));
			hexEl.addEventListener("contextmenu", (evt) => this.onHexContextMenu(evt, x, y));
		};

		if (isFlat) {
			// Flat-top: iterate columns; odd columns shift down by half hex height
			for (let i = 0; i < cols; i++) {
				const x = ox + i;
				const colEl = gridContainer.createDiv({
					cls: `duckmage-hex-col${x % 2 !== 0 ? " duckmage-hex-col-offset" : ""}`,
				});
				for (let j = 0; j < rows; j++) {
					addHex(colEl, x, oy + j);
				}
			}
		} else {
			// Pointy-top: iterate rows; odd rows shift right by half hex width
			for (let j = 0; j < rows; j++) {
				const y = oy + j;
				const rowEl = gridContainer.createDiv({
					cls: `duckmage-hex-row${y % 2 !== 0 ? " duckmage-hex-row-offset" : ""}`,
				});
				for (let i = 0; i < cols; i++) {
					addHex(rowEl, ox + i, y);
				}
			}
		}

		this.renderRoadRiverOverlay(gridContainer);
	}

	private onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
		evt.preventDefault();
		new HexEditorModal(this.app, this.plugin, x, y, (t, i) => this.renderGrid(t, i)).open();
	}

	private async onHexClick(x: number, y: number): Promise<void> {
		if (this.drawingMode === "road" || this.drawingMode === "river") {
			await this.onHexDrawClick(x, y);
			return;
		}
		if (this.drawingMode === "terrain") {
			await this.onHexPaintClick(x, y);
			return;
		}

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

	private async onHexPaintClick(x: number, y: number): Promise<void> {
		if (this.drawingMode !== "terrain") return;
		const path = this.plugin.hexPath(x, y);
		if (this.paintTerrainName === null) {
			// Clear mode — only act if the hex note exists
			if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) return;
			await setTerrainInFile(this.app, path, null);
			this.renderGrid(new Map([[path, null]]));
			return;
		}
		if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
			const created = await this.plugin.createHexNote(x, y);
			if (!created) return;
		}
		await setTerrainInFile(this.app, path, this.paintTerrainName);
		this.renderGrid(new Map([[path, this.paintTerrainName]]));
	}

	private async onHexDrawClick(x: number, y: number): Promise<void> {
		const key = `${x}_${y}`;
		const chains = this.drawingMode === "road"
			? this.plugin.settings.roadChains
			: this.plugin.settings.riverChains;

		// ── If adjacent to active end, always extend (chains may overlap) ──────
		const activeEnd = this.drawingMode === "road" ? this.activeRoadEnd : this.activeRiverEnd;

		if (activeEnd !== null) {
			const [ax, ay] = activeEnd.split("_").map(Number);
			const isAdjacent = this.hexNeighbors(ax, ay).some(([nx, ny]) => nx === x && ny === y);

			if (isAdjacent) {
				// Find the chain whose last node is activeEnd and append
				for (const chain of chains) {
					if (chain[chain.length - 1] === activeEnd) {
						chain.push(key);
						if (this.drawingMode === "road") this.activeRoadEnd = key;
						else this.activeRiverEnd = key;
						await this.plugin.saveSettings();
						this.updateRoadRiverOverlay();
						return;
					}
				}
			}
		}

		// ── Not an extension — delete one node from the first matching chain ───
		for (let ci = 0; ci < chains.length; ci++) {
			const pos = chains[ci].indexOf(key);
			if (pos === -1) continue;

			const chain = chains[ci];
			if (chain.length === 1) {
				chains.splice(ci, 1);
			} else if (pos === 0) {
				chain.splice(0, 1);
			} else if (pos === chain.length - 1) {
				chain.splice(pos, 1);
			} else {
				// Split chain at this position
				chains.splice(ci, 1, chain.slice(0, pos), chain.slice(pos + 1));
			}

			// Clear active end if it was this hex
			if (this.drawingMode === "road" && this.activeRoadEnd === key) this.activeRoadEnd = null;
			if (this.drawingMode === "river" && this.activeRiverEnd === key) this.activeRiverEnd = null;

			await this.plugin.saveSettings();
			this.updateRoadRiverOverlay();
			return;
		}

		// ── No existing chain — start a new one ────────────────────────────────
		chains.push([key]);
		if (this.drawingMode === "road") this.activeRoadEnd = key;
		else this.activeRiverEnd = key;
		await this.plugin.saveSettings();
		this.updateRoadRiverOverlay();
	}

	private hexNeighbors(x: number, y: number): [number, number][] {
		if (this.plugin.settings.hexOrientation === "flat") {
			// Flat-top, odd-q offset (odd columns shifted down)
			return x % 2 === 0
				? [[x,y-1],[x,y+1],[x+1,y-1],[x+1,y],[x-1,y-1],[x-1,y]]
				: [[x,y-1],[x,y+1],[x+1,y],[x+1,y+1],[x-1,y],[x-1,y+1]];
		}
		// Pointy-top, odd-r offset (odd rows shifted right)
		return y % 2 === 0
			? [[x+1,y],[x-1,y],[x-1,y-1],[x,y-1],[x-1,y+1],[x,y+1]]
			: [[x+1,y],[x-1,y],[x,  y-1],[x+1,y-1],[x,y+1],[x+1,y+1]];
	}

	private renderRoadRiverOverlay(gridContainer: HTMLElement): void {
		this.viewportEl?.querySelector("svg.duckmage-road-river-svg")?.remove();

		const roadChains  = this.plugin.settings.roadChains  ?? [];
		const riverChains = this.plugin.settings.riverChains ?? [];
		const hasContent  = roadChains.some(c => c.length > 0) || riverChains.some(c => c.length > 0)
			|| this.activeRoadEnd !== null || this.activeRiverEnd !== null;
		if (!hasContent) return;

		// Build hex center map — offsetLeft/offsetTop are unaffected by CSS transform
		const centerMap = new Map<string, { cx: number; cy: number }>();
		gridContainer.querySelectorAll<HTMLElement>(".duckmage-hex").forEach(hexEl => {
			const x = Number(hexEl.dataset.x);
			const y = Number(hexEl.dataset.y);
			let ox = hexEl.offsetWidth / 2;
			let oy = hexEl.offsetHeight / 2;
			let cur: HTMLElement | null = hexEl;
			while (cur && cur !== this.viewportEl) {
				ox += cur.offsetLeft;
				oy += cur.offsetTop;
				cur = cur.offsetParent as HTMLElement | null;
			}
			centerMap.set(`${x}_${y}`, { cx: ox, cy: oy });
		});

		const svgNS = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(svgNS, "svg");
		svg.classList.add("duckmage-road-river-svg");
		const w = gridContainer.offsetLeft + gridContainer.offsetWidth  + 20;
		const h = gridContainer.offsetTop  + gridContainer.offsetHeight + 20;
		svg.setAttribute("width",  String(w));
		svg.setAttribute("height", String(h));
		svg.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:5;";

		// Build a smooth path through an ordered list of points using quadratic
		// bezier curves — corners are rounded by curving through midpoints.
		const smoothPath = (pts: { cx: number; cy: number }[]): string => {
			if (pts.length < 2) return "";
			if (pts.length === 2) {
				return `M ${pts[0].cx} ${pts[0].cy} L ${pts[1].cx} ${pts[1].cy}`;
			}
			const mx = (a: { cx: number }, b: { cx: number }) => (a.cx + b.cx) / 2;
			const my = (a: { cy: number }, b: { cy: number }) => (a.cy + b.cy) / 2;
			let d = `M ${pts[0].cx} ${pts[0].cy}`;
			d += ` L ${mx(pts[0], pts[1])} ${my(pts[0], pts[1])}`;
			for (let i = 1; i < pts.length - 1; i++) {
				d += ` Q ${pts[i].cx} ${pts[i].cy} ${mx(pts[i], pts[i+1])} ${my(pts[i], pts[i+1])}`;
			}
			d += ` L ${pts[pts.length - 1].cx} ${pts[pts.length - 1].cy}`;
			return d;
		};

		const appendPath = (pts: { cx: number; cy: number }[], color: string, strokeWidth: number) => {
			const path = document.createElementNS(svgNS, "path");
			path.setAttribute("d", smoothPath(pts));
			path.setAttribute("stroke", color);
			path.setAttribute("stroke-width", String(strokeWidth));
			path.setAttribute("stroke-linecap", "round");
			path.setAttribute("stroke-linejoin", "round");
			path.setAttribute("fill", "none");
			svg.appendChild(path);
		};

		// Roads: each chain draws fully — crossings are fine.
		const drawChains = (chains: string[][], color: string, strokeWidth: number) => {
			for (const chain of chains) {
				const pts = chain.map(k => centerMap.get(k)).filter((p): p is { cx: number; cy: number } => !!p);
				if (pts.length >= 2) appendPath(pts, color, strokeWidth);
			}
		};

		// Rivers: newer chains truncate at the first hex already drawn by an
		// older chain, so tributaries visually end on top of the main river.
		const drawRiverChains = (chains: string[][], color: string, strokeWidth: number) => {
			const drawn = new Set<string>();
			for (const chain of chains) {
				// Find the first hex in this chain that's already drawn
				let end = chain.length - 1;
				for (let i = 0; i < chain.length; i++) {
					if (drawn.has(chain[i])) { end = i; break; }
				}
				const pts = chain.slice(0, end + 1)
					.map(k => centerMap.get(k))
					.filter((p): p is { cx: number; cy: number } => !!p);
				if (pts.length >= 2) appendPath(pts, color, strokeWidth);
				for (const key of chain) drawn.add(key);
			}
		};

		// Small circle to mark the active endpoint (only visible in drawing mode)
		const drawActiveEndMarker = (activeEnd: string | null, color: string) => {
			if (!activeEnd) return;
			const pos = centerMap.get(activeEnd);
			if (!pos) return;
			const circle = document.createElementNS(svgNS, "circle");
			circle.setAttribute("cx", String(pos.cx));
			circle.setAttribute("cy", String(pos.cy));
			circle.setAttribute("r", "5");
			circle.setAttribute("fill", color);
			circle.setAttribute("stroke", "white");
			circle.setAttribute("stroke-width", "1.5");
			circle.setAttribute("opacity", "0.9");
			svg.appendChild(circle);
		};

		drawRiverChains(riverChains, this.plugin.settings.riverColor, 3);
		drawChains(roadChains,      this.plugin.settings.roadColor,  4);

		if (this.drawingMode === "road")  drawActiveEndMarker(this.activeRoadEnd,  this.plugin.settings.roadColor);
		if (this.drawingMode === "river") drawActiveEndMarker(this.activeRiverEnd, this.plugin.settings.riverColor);

		this.viewportEl?.appendChild(svg);
	}

	private updateRoadRiverOverlay(): void {
		const gridContainer = this.viewportEl?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
		if (!gridContainer) { this.renderGrid(); return; }
		this.renderRoadRiverOverlay(gridContainer);
	}
}
