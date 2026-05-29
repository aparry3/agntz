import type { UnifiedStore } from "@agntz/core";

let _store: UnifiedStore | null = null;

/**
 * Get the store instance. Lazily initialized from environment config.
 * Supports: postgres, memory (default).
 * SQLite is only supported for local development — use `pnpm dev` instead of Docker.
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
		case "sqlite": {
			throw new Error(
				"STORE=sqlite is only supported for local development. Use STORE=postgres in Docker, or run locally with `pnpm dev`.",
			);
		}
		default: {
			const { MemoryStore } = await import("@agntz/core");
			_store = new MemoryStore();
			break;
		}
	}

	return _store!;
}
