import { SqliteStore } from "../src/sqlite.js";
import { runTraceStoreConformance } from "./support/trace-store-conformance.js";

runTraceStoreConformance("SqliteStore", async () => {
	// In-memory SQLite DB so tests don't touch disk.
	const store = new SqliteStore(":memory:");
	return store as unknown as import("@agntz/contracts").TraceStore;
});
