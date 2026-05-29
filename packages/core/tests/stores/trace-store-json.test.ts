import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { runTraceStoreConformance } from "../../src/__tests__/trace-store-conformance.js";
import { JsonFileStore } from "../../src/stores/json-file.js";

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
