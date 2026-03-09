# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (watch mode with inline sourcemaps) — use with Hot Reload (see below)
npm run dev

# Production build (type-checks then bundles)
npm run build

# Bump version (updates manifest.json and versions.json, stages both)
npm run version
```

Slash commands (invoke inside Claude Code):
- `/dev` — starts esbuild in watch mode (long-running; pairs with Hot Reload)
- `/rebuild` — one-off production build; reports errors if the build fails

There are no tests. The built output is `main.js` in the repo root, which Obsidian loads directly from this plugin folder.

## Dev loop

Each coding session:
1. Run `npm run dev` in a terminal (or `/dev` from Claude Code) — esbuild watches for changes and rebuilds `main.js` on every save
2. After a rebuild, reload the plugin in Obsidian via the developer console (Ctrl+Shift+I):
   ```js
   app.plugins.disablePlugin('duckmage-plugin'); app.plugins.enablePlugin('duckmage-plugin');
   ```
3. Use `/rebuild` for a final production build before committing (runs the TypeScript type-check too)

## Architecture

The plugin source is split across `main.ts` (entry point re-export) and modules under `src/`. esbuild bundles everything into `main.js`, which Obsidian loads directly.

### Source layout

```
main.ts                          ← thin re-export: export { default } from "./src/DuckmagePlugin"
src/
  DuckmagePlugin.ts              ← Plugin class (entry point, default export)
  HexMapView.ts                  ← ItemView — renders the hex grid, all drawing tools
  HexEditorModal.ts              ← Modal — right-click per-hex editor (terrain, links, notes, icon override)
  TerrainPickerModal.ts          ← Modal — full terrain palette picker for the terrain paint tool
  IconPickerModal.ts             ← Modal — icon picker for the icon paint tool
  FileLinkSuggestModal.ts        ← SuggestModal — file picker scoped to worldFolder
  DuckmageSettingTab.ts          ← PluginSettingTab — settings UI
  types.ts                       ← Interfaces & type constants (TerrainColor, DuckmagePluginSettings, LINK_SECTIONS, TEXT_SECTIONS)
  constants.ts                   ← Runtime constants (VIEW_TYPE_HEX_MAP, DEFAULT_TERRAIN_PALETTE, DEFAULT_SETTINGS)
  defaultHexTemplate.md          ← Built-in hex note template (imported as text via esbuild loader)
  frontmatter.ts                 ← YAML frontmatter helpers (terrain + icon override read/write)
  sections.ts                    ← Markdown section helpers (addLinkToSection, getLinksInSection, getSectionContent, setSectionContent)
  utils.ts                       ← Shared utilities (normalizeFolder, getIconUrl)
  md.d.ts                        ← TypeScript declaration for "*.md" text imports
```

The `.md` loader is configured in `esbuild.config.mjs` (`loader: { '.md': 'text' }`), allowing `defaultHexTemplate.md` to be imported as a plain string.

### Plugin purpose

Renders an interactive hex-grid map for tabletop RPG world-building inside Obsidian. Each hex cell corresponds to a Markdown note on disk. The map supports terrain painting, icon painting, road/river chain drawing, panning, and zooming.

### Key classes

- **`DuckmagePlugin`** (`src/DuckmagePlugin.ts`) — Main plugin entry point. Registers the view, ribbon icon, command, and settings tab. Exposes `hexPath(x, y)`, `createHexNote(x, y)`, `loadAvailableIcons()`, and `refreshHexMap()` (re-renders all open map views). Stores `availableIcons: string[]` (icons from the plugin's `icons/` folder merged with the user's custom icons folder).

- **`HexMapView`** (`src/HexMapView.ts`, extends `ItemView`) — Renders the hex grid and handles all user interaction.
  - **DOM structure**: `contentEl` (`.duckmage-hex-map-container`) contains two children: `.duckmage-hex-map-clip` (clips the panning viewport, `overflow: hidden`) and `.duckmage-hex-map-controls` (transparent overlay for buttons, `pointer-events: none`). This separation ensures toolbar/expand buttons are never clipped by the viewport transform.
  - **`renderGrid(terrainOverrides?, iconOverrides?)`** — full DOM re-render of the hex grid. The optional override Maps allow callers to pass values that haven't hit the metadata cache yet.
  - **Drawing tools**: toolbar buttons toggle `drawingMode` (`"road" | "river" | "terrain" | "icon" | null`). Terrain and icon tools use immediate DOM patching for responsiveness with background file writes via per-hex coalescing write queues (`pendingTerrainWrites`, `pendingIconWrites`, `flushing`).
  - **Write queues**: `scheduleTerrainWrite` / `scheduleIconWrite` deduplicate rapid repaints of the same hex — only the latest value is ever written, preventing stale intermediate writes from overwriting the final state.
  - Left-click: opens/creates a hex note (normal mode), paints terrain/icon, or extends a road/river chain.
  - Right-click: opens `HexEditorModal` (normal mode), deletes a road/river node, or exits terrain/icon mode.
  - Expand buttons (+) grow the grid in any of the four cardinal directions, adjusting `gridOffset` and `gridSize` in settings.

- **`HexEditorModal`** (`src/HexEditorModal.ts`, extends `Modal`) — The right-click per-hex editor. Contains:
  - A 2-row scrollable terrain picker (color + icon grid).
  - An icon override row with a "Clear terrain" button (only shown when terrain is set).
  - Link sections for Towns, Dungeons, and Features (using `FileLinkSuggestModal`).
  - Free-text note sections (Description, Landmark, Hidden, Secret, Encounters, Weather, Hooks & Rumors).
  - Uses `ensureHexNote()` to create the note on demand before writing to it.

- **`TerrainPickerModal`** (`src/TerrainPickerModal.ts`, extends `Modal`) — Full-grid (no row cap) terrain picker opened by the toolbar Terrain button. Includes a "Clear" option to erase terrain. Calls back with `string | null`.

- **`IconPickerModal`** (`src/IconPickerModal.ts`, extends `Modal`) — Full-grid icon picker opened by the toolbar Icon button. Shows all `availableIcons` with image previews. Includes a "Remove" option. Calls back with `string | null`.

- **`FileLinkSuggestModal`** (`src/FileLinkSuggestModal.ts`, extends `SuggestModal<TFile>`) — Reusable file-search modal scoped to a configured folder. Takes an `onChoose` callback.

- **`DuckmageSettingTab`** (`src/DuckmageSettingTab.ts`) — Settings UI for folder paths, orientation, grid dimensions, hex gap, custom icons folder, road/river colors, and the terrain palette (name + color + icon). Calls `plugin.refreshHexMap()` after terrain color or icon changes so the map updates live.

### Data model

- **Hex notes**: stored at `{hexFolder}/{x}_{y}.md` (e.g. `world/hexes/3_7.md`). Created via `DuckmagePlugin.createHexNote(x, y)` using the configured template or the built-in `src/defaultHexTemplate.md`.
- **Template placeholders**: `{{x}}`, `{{y}}`, `{{title}}`. Templates should include `### Towns`, `### Dungeons`, and `### Features` headings so that links added via the editor land in the right section.
- **Terrain**: stored in a hex note's YAML frontmatter as `terrain: <name>`. Read via `getTerrainFromFile` (uses metadata cache); written via `setTerrainInFile` (parses/patches raw file content). Both in `src/frontmatter.ts`.
- **Icon override**: stored in frontmatter as `icon: <filename>`. Read via `getIconOverrideFromFile`; written via `setIconOverrideInFile`. Both in `src/frontmatter.ts`. When set, the override icon is shown instead of the terrain's default icon.
- **Terrain icons**: image files in the plugin's `icons/` folder plus any user-configured custom icons folder. Loaded into `plugin.availableIcons` at startup. URLs resolved via `getIconUrl(plugin, filename)` in `src/utils.ts`. Vault-sourced icon filenames are tracked in `plugin.vaultIconsSet`.
- **Roads & rivers**: stored in `settings.roadChains` and `settings.riverChains` — each an array of `string[]` chains, where each element is an `"x_y"` key. Drawn as SVG lines overlaid on the grid connecting adjacent hexes in the same chain.
- **Section links**: `addLinkToSection(app, filePath, section, linkText)` inserts a wiki-link under the named `###` heading. `getLinksInSection` reads them back. Both in `src/sections.ts`.
- **Settings** (`data.json`): `worldFolder`, `hexFolder`, `townsFolder`, `dungeonsFolder`, `iconsFolder`, `templatePath`, `hexGap`, `hexOrientation` (`"pointy" | "flat"`), `terrainPalette` (array of `{name, color, icon?}`), `gridSize` (`{cols, rows}`), `gridOffset` (`{x, y}`), `zoomLevel`, `roadChains`, `riverChains`, `roadColor`, `riverColor`.

### Hex orientations

- **Pointy-top** (default): points face north/south, flat sides east/west. Rows are rendered with odd rows offset right. Adjacency uses odd-r offset coordinates.
- **Flat-top**: flat sides face north/south, points east/west. Columns are rendered with odd columns offset down. Adjacency uses odd-q offset coordinates.
- `hexNeighbors(x, y)` in `HexMapView` branches on `settings.hexOrientation` to return the correct 6 neighbors.

### Key conventions

- Folder paths are normalized (no leading/trailing slashes) via `normalizeFolder()` in `src/utils.ts`.
- Links use vault-relative paths via `metadataCache.fileToLinktext(file, sourcePath)`.
- `obsidian` is an esbuild external — never bundled; provided by Obsidian at runtime.
- CSS classes use the `duckmage-` prefix (styles in `styles.css`).
- View/modal/tab files use `import type DuckmagePlugin` to avoid circular runtime dependencies.
- Paint tool methods (`onHexPaintClick`, `onHexIconClick`) are synchronous — they patch the DOM immediately and schedule file writes via the coalescing queue rather than awaiting I/O before updating the visual.
