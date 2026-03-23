Release a new version of the plugin. Follow these steps exactly:

## 1. Check current version

Read `manifest.json` to confirm the current version number, then ask the user what the new version should be (or check if they've already specified it).

## 2. Bump version

```bash
npm run version
```

This updates `manifest.json` and `versions.json` and stages both files. Confirm the version was bumped correctly by reading `manifest.json`.

## 3. Build and test

```bash
npm run build && npm test
```

Do not proceed if either fails.

## 4. Commit and push

```bash
git add manifest.json versions.json
git commit -m "chore: release X.Y.Z"
git push prod master
```

Replace `X.Y.Z` with the actual version from `manifest.json`.

## 5. Tag and push tag

```bash
git tag -a X.Y.Z -m "X.Y.Z"
git push prod X.Y.Z
```

The tag **must exactly match** the version in `manifest.json`. The GitHub Actions release workflow is triggered by this tag push and will:
- Run tests
- Build `main.js`
- Create a **draft** GitHub release with `main.js`, `manifest.json`, and `styles.css` attached

## 6. Publish the draft release

Go to the GitHub releases page, find the draft, add release notes, and publish it.

---

**Notes:**
- The remote is named `prod` (not `origin`)
- `main.js` is in `.gitignore` — never commit it manually; the CI builds it
- The tag version must match `manifest.json` exactly (not `package.json`)
- The release workflow creates a **draft** — you must publish it manually after adding release notes
