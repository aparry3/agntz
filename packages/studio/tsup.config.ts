import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    middleware: "src/middleware.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["@agent-runner/core"],
  sourcemap: true,
});
