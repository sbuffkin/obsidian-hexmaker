import { describe, it, expect, vi } from "vitest";
import { normalizeFolder, makeTableTemplate, getIconUrl } from "../src/utils";
import type DuckmagePlugin from "../src/DuckmagePlugin";

// ── normalizeFolder ───────────────────────────────────────────────────────────

describe("normalizeFolder", () => {
	it("returns empty string for empty input", () => {
		expect(normalizeFolder("")).toBe("");
	});

	it("strips a leading slash", () => {
		expect(normalizeFolder("/tables")).toBe("tables");
	});

	it("strips a trailing slash", () => {
		expect(normalizeFolder("tables/")).toBe("tables");
	});

	it("strips both leading and trailing slashes", () => {
		expect(normalizeFolder("/tables/")).toBe("tables");
	});

	it("strips multiple leading and trailing slashes", () => {
		expect(normalizeFolder("///tables///")).toBe("tables");
	});

	it("leaves interior slashes intact", () => {
		expect(normalizeFolder("world/tables")).toBe("world/tables");
	});

	it("returns empty string for a string that is only slashes", () => {
		expect(normalizeFolder("///")).toBe("");
	});

	it("does not modify a clean path", () => {
		expect(normalizeFolder("tables/terrain")).toBe("tables/terrain");
	});
});

// ── makeTableTemplate ─────────────────────────────────────────────────────────

describe("makeTableTemplate", () => {
	it("includes the dice value in frontmatter", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("dice: 6");
	});

	it("produces valid YAML frontmatter block", () => {
		const t = makeTableTemplate(4);
		expect(t).toMatch(/^---\n/);
		expect(t).toContain("\n---\n");
	});

	it("generates the default 3 example rows (A, B, C)", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("Example result A");
		expect(t).toContain("Example result B");
		expect(t).toContain("Example result C");
	});

	it("generates 1 example row when exampleRows=1", () => {
		const t = makeTableTemplate(6, 1);
		// Single-row form: "|  | 1 |"
		expect(t).toContain("|  | 1 |");
		expect(t).not.toContain("Example result A");
	});

	it("generates the correct number of example rows", () => {
		const t = makeTableTemplate(6, 5);
		expect(t).toContain("Example result E");
		expect(t).not.toContain("Example result F");
	});

	it("includes extra frontmatter fields when provided", () => {
		const t = makeTableTemplate(6, 3, { terrain: "forest", category: "monsters" });
		expect(t).toContain("terrain: forest");
		expect(t).toContain("category: monsters");
	});

	it("includes preamble between frontmatter and table", () => {
		const t = makeTableTemplate(6, 3, undefined, "[🎲 Open](obsidian://roll)");
		expect(t).toContain("[🎲 Open](obsidian://roll)");
		// preamble should appear before the markdown table header
		const preambleIdx = t.indexOf("[🎲 Open]");
		const tableIdx = t.indexOf("| Result |");
		expect(preambleIdx).toBeLessThan(tableIdx);
	});

	it("includes the Result/Weight table header", () => {
		const t = makeTableTemplate(6);
		expect(t).toContain("| Result | Weight |");
		expect(t).toContain("|--------|--------|");
	});

	it("dice: 0 still produces valid frontmatter", () => {
		const t = makeTableTemplate(0);
		expect(t).toContain("dice: 0");
	});

	it("produces a valid (empty-row) template when exampleRows is 0", () => {
		const t = makeTableTemplate(6, 0);
		expect(t).toContain("dice: 6");
		expect(t).toContain("| Result | Weight |");
		expect(t).not.toContain("Example result");
	});

	it("serialises boolean extra frontmatter values", () => {
		const t = makeTableTemplate(6, 3, { "roll-filter": false });
		expect(t).toContain("roll-filter: false");
	});

	it("serialises number extra frontmatter values", () => {
		const t = makeTableTemplate(6, 3, { level: 3 });
		expect(t).toContain("level: 3");
	});
});

// ── getIconUrl ────────────────────────────────────────────────────────────────

/** Build a minimal plugin stub for getIconUrl. */
function makePluginForIcon(
	vaultIcons: string[],
	iconsFolder: string,
	manifestDir: string,
): { plugin: DuckmagePlugin; getLastPath: () => string } {
	let lastPath = "";
	const getResourcePath = vi.fn((p: string) => {
		lastPath = p;
		return `resource://${p}`;
	});
	const plugin = {
		vaultIconsSet: new Set(vaultIcons),
		settings: { iconsFolder },
		manifest: { dir: manifestDir },
		app: { vault: { adapter: { getResourcePath } } },
	} as unknown as DuckmagePlugin;
	return { plugin, getLastPath: () => lastPath };
}

describe("getIconUrl", () => {
	it("uses plugin icons dir when icon is not in vaultIconsSet", () => {
		const { plugin, getLastPath } = makePluginForIcon([], "custom", "plugins/duckmage-plugin");
		getIconUrl(plugin, "tower.png");
		expect(getLastPath()).toBe("plugins/duckmage-plugin/icons/tower.png");
	});

	it("uses vault iconsFolder when icon is in vaultIconsSet", () => {
		const { plugin, getLastPath } = makePluginForIcon(["village.png"], "custom-icons", "plugins/duckmage-plugin");
		getIconUrl(plugin, "village.png");
		expect(getLastPath()).toBe("custom-icons/village.png");
	});

	it("uses plugin icons dir for icons not in vaultIconsSet even when others are", () => {
		const { plugin, getLastPath } = makePluginForIcon(["village.png"], "custom-icons", "plugins/duckmage-plugin");
		getIconUrl(plugin, "castle.png");
		expect(getLastPath()).toBe("plugins/duckmage-plugin/icons/castle.png");
	});

	it("normalises iconsFolder by stripping leading/trailing slashes", () => {
		const { plugin, getLastPath } = makePluginForIcon(["icon.png"], "/my-icons/", "plugins/duckmage-plugin");
		getIconUrl(plugin, "icon.png");
		expect(getLastPath()).toBe("my-icons/icon.png");
	});

	it("returns a string (the resource path)", () => {
		const { plugin } = makePluginForIcon([], "icons", "plugins/duckmage-plugin");
		const result = getIconUrl(plugin, "ruins.png");
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});
});
