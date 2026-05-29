import { runTraceStoreConformance } from "../../src/__tests__/trace-store-conformance.js";
import { MemoryStore } from "../../src/stores/memory.js";

runTraceStoreConformance("MemoryStore", async () => {
	const admin = new MemoryStore();
	// MemoryStore is not owner-scoped at construction; methods take ownerId.
	// Cast to TraceStore — the conformance suite only uses TraceStore methods.
	return admin as unknown as import("../../src/types.js").TraceStore;
});
