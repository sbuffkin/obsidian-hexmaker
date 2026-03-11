# Architecture Overview — Duckmage Plugin

A tabletop RPG world-building plugin for Obsidian. Three interconnected views (hex map, hex table, random tables) operate on a shared vault of Markdown notes.

---

## Views

### HexMapView
The primary interactive surface. Renders a hex grid where every cell corresponds to a `{hexFolder}/{x}_{y}.md` note on disk.

**DOM structure:**
```
.duckmage-hex-map-container
  ├── .duckmage-hex-map-clip          ← overflow:hidden clipping layer
  │     └── .duckmage-hex-map-viewport  ← transform target (pan + zoom)
  │           └── .duckmage-hex × N    ← individual hex cells
  └── .duckmage-hex-map-controls      ← pointer-events:none overlay
        ├── expand buttons (+)
        └── drawing toolbar
```

The clip/controls separation ensures toolbar buttons are never hidden by the viewport's CSS transform.

**Drawing tools** — each follows the same pattern:

| Tool | drawingMode | Opens | Section written |
|------|-------------|-------|-----------------|
| Road | `"road"` | (direct click) | `settings.roadChains` |
| River | `"river"` | (direct click) | `settings.riverChains` |
| Terrain | `"terrain"` | `TerrainPickerModal` | frontmatter `terrain:` |
| Icon | `"icon"` | `IconPickerModal` | frontmatter `icon:` |
| Link Table | `"tableLink"` | `TablePickerModal` | `### Encounters Table` |
| Link Faction | `"factionLink"` | `FactionPickerModal` | `### Factions` |

**Tool lifecycle** (standard pattern):
1. Button click → `handle*Button()` opens picker modal
2. Picker callback sets `drawingMode` + paint target, calls `updateToolbarButtonStates()`
3. Hex left-click → `onHex*Click(x, y)`
4. Right-click (on any hex) → `exit*Mode()` → `drawingMode = null`
5. `updateToolbarButtonStates()` syncs active CSS and button labels

**Write strategies:**
- Terrain/icon: synchronous DOM patch + coalescing async write queue (`scheduleTerrainWrite` / `scheduleIconWrite`). Only the latest value per hex is flushed, preventing stale writes.
- Link tools: purely async, no DOM patch needed (badge added directly after `await addLinkToSection`).
- Roads/rivers: written to `plugin.settings` and persisted via `saveSettings()`.

**Visual feedback for link tools:**
- Persistent: accent-coloured outline + emoji badge (📋 table, ⚔️ faction)
- Transient: `.duckmage-hex-blip` — a CSS-animated circle that expands and fades, then self-removes on `animationend`

---

### HexTableView
A live spreadsheet of all hex notes found in `hexFolder`. Updates on vault `modify` events (300 ms debounce per file).

**Columns:** Hex (coords + ◎ jump button), Terrain (colour swatch), then one column per section key from `COLUMNS`.

**Filters (toolbar):**
- X / Y numeric range inputs
- Terrain multi-select modal — left-click to include, right-click to exclude (strikethrough + red)
- Has Town / Has Dungeon / Has Feature / Has Quest / Has Faction checkboxes
- Sort priority (X→Y or Y→X) and direction (Asc / Desc)

Filter state is stored as `dataset` attributes on each `<tr>` (`data-terrain`, `data-has-town`, etc.) and read by `applyFilters()` — no file I/O on filter change.

**Jump button (◎):** Calls `HexMapView.centerOnHex(x, y)` on the first open map leaf, panning the viewport to that hex.

---

### RandomTableView
A two-column browser for random table files under `tablesFolder`.

- **Left:** Folder tree (collapsible) + search filter. New-table creator at the bottom.
- **Right:** Selected table — entries with die-range (`dN` column) and percentage odds, die-size selector, Roll button, copy-result textarea, recent roll history.

Edit button opens `RandomTableEditorModal` for in-place entry editing.

---

## Modals

| Modal | Purpose |
|-------|---------|
| `HexEditorModal` | Right-click per-hex editor — terrain, all link sections, all text sections |
| `TerrainPickerModal` | Full terrain palette picker (toolbar terrain button) |
| `IconPickerModal` | Full icon picker with image previews (toolbar icon button) |
| `TablePickerModal` | Folder-tree file picker scoped to `tablesFolder` (Link Table tool) |
| `FactionPickerModal` | Folder-tree file picker scoped to `factionsFolder` (Link Faction tool) |
| `FileLinkSuggestModal` | Fuzzy-search file picker scoped to any folder (used internally by `LinkPickerModal`) |
| `RandomTableModal` | Inline roll modal — used from HexEditorModal 🎲 buttons |
| `RandomTableEditorModal` | Edit table entries (result + weight) and save back to file |
| `GotoHexModal` | Enter X/Y coords to jump the map to that hex |

---

## Data model

### Hex notes
Path: `{hexFolder}/{x}_{y}.md`

```yaml
---
terrain: forest
icon: custom-castle.png   # optional override
---

### Towns
[[My Town]]

### Dungeons

### Features

### Quests

### Factions
[[Iron Brotherhood]]

### Encounters Table
[[forest-encounters]]

### Description
Rolling hills...

### Landmark
### Hidden
### Secret
### Encounters
### Weather
### Hooks & Rumors
```

- `terrain` and `icon` live in YAML frontmatter (read via metadata cache, written via raw-text patching in `frontmatter.ts`).
- All other data lives under `###` headings (read/written via `sections.ts`).

### Link sections (`LINK_SECTIONS`)
```
"Towns" | "Dungeons" | "Features" | "Quests" | "Factions" | "Encounters Table"
```
Each has a corresponding folder setting. The heading key used in files is the section name lowercased.

### Text sections (`TEXT_SECTIONS`)
```
description | landmark | hidden | secret | encounters | weather | hooks & rumors
```

### Roads & rivers
Stored as `string[][]` in `settings.roadChains` / `settings.riverChains`. Each chain is an ordered array of `"x_y"` keys. Rendered as SVG polylines connecting adjacent hexes.

### Random tables
Markdown files with:
```yaml
---
dice: 100
---
| Result | Weight |
|--------|--------|
| Dragons | 1 |
| Goblins | 5 |
```
Parsed by `randomTable.ts` into `{ dice, entries: [{result, weight}] }`. Terrain tables generated at `{tablesFolder}/terrain/{name} - description.md` and `…encounters.md`.

### Settings (`data.json`)

| Key | Purpose |
|-----|---------|
| `worldFolder` | Root vault folder — scopes file search |
| `hexFolder` | Where `x_y.md` notes live |
| `townsFolder` | Folder for the Towns dropdown |
| `dungeonsFolder` | Folder for the Dungeons dropdown |
| `questsFolder` | Folder for the Quests dropdown |
| `featuresFolder` | Folder for the Features dropdown |
| `factionsFolder` | Folder for the Factions dropdown |
| `tablesFolder` | Folder for random table files |
| `iconsFolder` | User custom icons (merged with plugin `icons/`) |
| `templatePath` | Path to hex note template |
| `hexGap` | CSS gap between cells |
| `hexOrientation` | `"pointy"` or `"flat"` |
| `terrainPalette` | `[{name, color, icon?}]` |
| `gridSize` | `{cols, rows}` |
| `gridOffset` | `{x, y}` origin offset (adjusted by expand buttons) |
| `zoomLevel` | Current zoom |
| `roadChains` | `string[][]` road chains |
| `riverChains` | `string[][]` river chains |
| `roadColor` / `riverColor` | CSS colour strings |
| `defaultTableDice` | Die size for new table files |

---

## Module responsibilities

| File | Responsibility |
|------|---------------|
| `DuckmagePlugin.ts` | Entry point, view registration, cross-view API, terrain table generation |
| `HexMapView.ts` | Grid rendering, all drawing tools, panning/zooming, expand |
| `HexEditorModal.ts` | Per-hex right-click editor |
| `HexTableView.ts` | Hex spreadsheet, filters, sort, jump |
| `RandomTableView.ts` | Table browser, roll UI |
| `RandomTableModal.ts` | Inline roll from hex editor |
| `RandomTableEditorModal.ts` | Table entry editor |
| `randomTable.ts` | Pure parse/roll/weight logic (no Obsidian API) |
| `frontmatter.ts` | `terrain:` and `icon:` read/write |
| `sections.ts` | `###` heading read/write (`addLinkToSection`, `getLinksInSection`, `getAllSectionData`, `setSectionContent`, `addBacklinkToFile`) |
| `utils.ts` | `normalizeFolder`, `getIconUrl`, `makeTableTemplate` |
| `types.ts` | `DuckmagePluginSettings`, `LINK_SECTIONS`, `TEXT_SECTIONS`, `TerrainColor` |
| `constants.ts` | `VIEW_TYPE_*`, `DEFAULT_TERRAIN_PALETTE`, `DEFAULT_SETTINGS` |
| `DuckmageSettingTab.ts` | Settings UI including "Generate folders" and "Generate terrain tables" buttons |

---

## Key conventions

- Folder paths normalised (no leading/trailing slashes) via `normalizeFolder()`.
- All wiki-links use `metadataCache.fileToLinktext(file, sourcePath)` for vault-relative resolution.
- `obsidian` is an esbuild external — never bundled.
- CSS classes use the `duckmage-` prefix.
- Views and modals import `DuckmagePlugin` as a type only (`import type`) to avoid circular runtime deps.
- Metadata-cache race after `vault.modify`: `HexEditorModal.onChanged()` defers `renderGrid()` by 300 ms when no terrain/icon overrides are passed, giving the cache time to repopulate.
