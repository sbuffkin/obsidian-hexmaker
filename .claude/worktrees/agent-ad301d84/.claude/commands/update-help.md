---
description: Update src/help.md to match the current tools and controls
allowed-tools: Read, Edit, Write, Bash(npm:*)
---

The help file for the hex map is at `src/help.md`. It is bundled into the plugin and shown when the user clicks the **?** button on the hex map.

**When to run this:** Any time a tool is added, removed, renamed, or its behaviour changes in `src/HexMapView.ts`.

**Steps:**

1. Read `src/help.md` to see the current documented state.
2. Read the relevant parts of `src/HexMapView.ts` to identify what changed (toolbar buttons, drawing modes, click behaviour, view buttons).
3. Edit `src/help.md` so every tool and control is accurately and concisely described.
4. Run `/rebuild` to confirm the build still passes.

Keep the tone brief and practical — one or two sentences per tool is enough.
