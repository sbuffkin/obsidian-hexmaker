import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	test: {
		environment: "node",
		exclude: ["**/node_modules/**", ".claude/**"],
	},
	resolve: {
		alias: {
			obsidian: resolve(__dirname, "tests/__mocks__/obsidian.ts"),
		},
	},
});
