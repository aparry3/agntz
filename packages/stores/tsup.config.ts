import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/contracts.ts",
		"src/memory.ts",
		"src/postgres.ts",
		"src/sqlite.ts",
	],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "node22",
	external: [
		"better-sqlite3",
		"pg",
		"@agntz/contracts",
		"@agntz/db",
		"@agntz/db/postgres",
		"@agntz/db/sqlite",
	],
});
