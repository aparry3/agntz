import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/postgres.ts", "src/sqlite.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Native/optional-peer drivers stay external so single-backend consumers
  // never bundle the driver they don't use.
  external: ["pg", "better-sqlite3"],
});
