import type { UnifiedStore } from "@agntz/core";
import { MemoryStore } from "@agntz/core";

let _store: UnifiedStore | null = null;

/**
 * Get the store instance. Lazily initialized from STORE env var.
 */
export async function getStore(): Promise<UnifiedStore> {
	if (_store) return _store;

	const storeType = process.env.STORE ?? "memory";

	switch (storeType) {
		case "postgres": {
			const connectionString = process.env.DATABASE_URL;
			if (!connectionString) {
				throw new Error("DATABASE_URL is required when STORE=postgres");
			}
			const { PostgresStore } = await import("@agntz/store-postgres");
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
