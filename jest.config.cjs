/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/tests/**/*.test.ts"],
	testPathIgnorePatterns: ["/node_modules/", "/.claude/"],
	modulePathIgnorePatterns: ["/.claude/"],
	moduleNameMapper: {
		"^obsidian$": "<rootDir>/tests/__mocks__/obsidian.ts",
		"^.+\\.png$": "<rootDir>/tests/__mocks__/fileMock.cjs",
	},
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: { skipLibCheck: true } }],
	},
};
