---
description: Build the duckmage plugin (type-check + bundle)
allowed-tools: Bash(npm:*)
---

Current directory: !`pwd`

Run the production build for the duckmage Obsidian plugin:

```
cd /mnt/c/Users/markr/Documents/KB/journal/.obsidian/plugins/duckmage-plugin && npm run build
```

Report the result clearly:
- If it succeeded, confirm that `main.js` was updated.
- If it failed, show the full error output and identify the likely cause (TypeScript type error, missing import, syntax error, etc.).
