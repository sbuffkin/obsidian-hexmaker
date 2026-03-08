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

This is a single-file Obsidian plugin (`main.ts`) compiled by esbuild into `main.js`. All source lives in `main.ts`; there are no other source files.

### Plugin purpose

Renders an interactive hex-grid map for tabletop RPG world-building inside Obsidian. Each hex cell corresponds to a Markdown note on disk.

### Key classes

- **`DuckmagePlugin`** — Main plugin entry point. Registers the view, ribbon icon, command, and settings tab. Exposes `hexPath(x, y)`, `createHexNote(x, y)`, and `loadAvailableIcons()`. Stores `availableIcons: string[]` (PNGs from the `icons/` folder, loaded at startup).
- **`HexMapView`** (extends `ItemView`) — Renders the hex grid. `renderGrid(terrainOverrides?)` does a full DOM re-render; the optional `terrainOverrides` map allows immediate visual updates before the metadata cache catches up. Left-click opens/creates a note; right-click opens `HexEditorModal`.
- **`HexEditorModal`** (extends `Modal`) — The right-click editor. Has a terrain picker (color swatch + icon grid) and link sections for Towns, Dungeons, and Features. Uses `ensureHexNote()` to create the note on demand before writing to it.
- **`FileLinkSuggestModal`** (extends `SuggestModal<TFile>`) — Reusable file-search modal scoped to `worldFolder`. Takes an `onChoose` callback.
- **`DuckmageSettingTab`** — Settings UI for folder paths, grid dimensions, hex gap, and terrain palette (name + color + icon dropdown).

### Data model

- **Hex notes**: stored at `{hexFolder}/{x}_{y}.md` (e.g. `RPG/duckmage/hexes/3_7.md`). Created via `DuckmagePlugin.createHexNote(x, y)` using the configured template or the built-in `DEFAULT_HEX_TEMPLATE`.
- **Template placeholders**: `{{x}}`, `{{y}}`, `{{title}}`. The default template and any custom template should include `## Towns`, `## Dungeons`, and `## Features` headings so that links added via the editor land in the right section.
- **Terrain**: stored in a hex note's YAML frontmatter as `terrain: <name>`. Read via `getTerrainFromFile` (uses metadata cache); written via `setTerrainInFile` (parses/patches raw file content).
- **Terrain icons**: PNG files in the plugin's `icons/` folder. Loaded at startup into `plugin.availableIcons`. Each `TerrainColor` entry has an optional `icon` filename. URLs are resolved via `getIconUrl(plugin, filename)` → `app.vault.adapter.getResourcePath(manifest.dir + '/icons/' + filename)`.
- **Section links**: `addLinkToSection(app, filePath, section, linkText)` inserts a wiki-link under the named `##` heading (appending the section if absent). `getLinksInSection` reads them back for display.
- **Settings** (`data.json`): `worldFolder`, `hexFolder`, `templatePath`, `hexGap`, `terrainPalette` (array of `{name, color, icon?}`), `gridSize` ({cols, rows}), `zoomLevel`.

### Key conventions

- Folder paths are normalized (no leading/trailing slashes) via `normalizeFolder()`.
- Links use vault-relative paths via `metadataCache.fileToLinktext(file, sourcePath)`.
- `obsidian` is an esbuild external — never bundled; provided by Obsidian at runtime.
- CSS classes use the `duckmage-` prefix (styles in `styles.css`).
