import { SqliteStore } from "../src/sqlite-store.js";
import { runTraceStoreConformance } from "../../core/src/__tests__/trace-store-conformance.js";

runTraceStoreConformance("SqliteStore", async () => {
  // In-memory SQLite DB so tests don't touch disk.
  const store = new SqliteStore(":memory:");
  return store as unknown as import("@agntz/core").TraceStore;
});
