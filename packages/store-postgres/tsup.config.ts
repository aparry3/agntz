import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	external: ["pg", "@agntz/contracts", "@agntz/db", "@agntz/db/postgres"],
});
