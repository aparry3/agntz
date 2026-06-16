import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/templates/index.ts", "src/manifest/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
});
