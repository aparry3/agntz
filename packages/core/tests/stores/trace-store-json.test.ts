import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach } from "vitest";
import { JsonFileStore } from "../../src/stores/json-file.js";
import { runTraceStoreConformance } from "../../src/__tests__/trace-store-conformance.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agntz-trace-json-"));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

runTraceStoreConformance("JsonFileStore", async () => {
  const store = new JsonFileStore(tmpDir);
  return store as unknown as import("../../src/types.js").TraceStore;
});
