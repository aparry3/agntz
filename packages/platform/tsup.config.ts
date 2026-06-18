import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/memory.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "node22",
	external: ["@agntz/contracts", "@agntz/core"],
});
