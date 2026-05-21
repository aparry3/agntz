import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/sqlite.ts", "src/cli.ts"],
  format: ["esm"],
  // Skip .d.ts for the CLI — it's a binary, not a public API surface. The
  // library entries still get full type emission.
  dts: { entry: ["src/index.ts", "src/sqlite.ts"] },
  clean: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  external: ["@agntz/store-sqlite"],
});
