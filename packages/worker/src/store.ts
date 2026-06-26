import type { AgntzStore } from "@agntz/stores/contracts";
import { MemoryStore } from "@agntz/stores/memory";

let _store: AgntzStore | null = null;

/**
 * Get the store instance. Lazily initialized from STORE env var.
 */
export async function getStore(): Promise<AgntzStore> {
	if (_store) return _store;

	const storeType = process.env.STORE ?? "memory";

	switch (storeType) {
		case "postgres": {
			const connectionString = process.env.DATABASE_URL;
			if (!connectionString) {
				throw new Error("DATABASE_URL is required when STORE=postgres");
			}
			const { PostgresStore } = await import("@agntz/stores/postgres");
			_store = new PostgresStore(connectionString);
			break;
		}
		default: {
			_store = new MemoryStore();
			break;
		}
	}

	return _store;
}
