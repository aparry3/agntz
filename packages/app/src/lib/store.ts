import type { UnifiedStore } from "@agntz/core";

let _store: UnifiedStore | null = null;

function isVercelRuntime(): boolean {
	return Boolean(process.env.VERCEL);
}

function isRailwayPrivateUrl(connectionString: string): boolean {
	try {
		return new URL(connectionString).hostname.endsWith(".railway.internal");
	} catch {
		return false;
	}
}

function getPostgresConnectionString(): string {
	const connectionString = process.env.DATABASE_URL;

	if (!connectionString) {
		throw new Error(
			"DATABASE_URL is required when STORE=postgres. On Vercel with Railway Postgres, set it to the Railway public TCP proxy URL.",
		);
	}

	if (isVercelRuntime() && isRailwayPrivateUrl(connectionString)) {
		throw new Error(
			"Vercel cannot connect to Railway private DATABASE_URL (*.railway.internal). Set DATABASE_URL to Railway's public TCP proxy URL.",
		);
	}

	return connectionString;
}

function getPostgresPoolConfig(connectionString: string) {
	const isVercel = isVercelRuntime();

	return {
		connectionString,
		...(isVercel
			? {
					max: 1,
					connectionTimeoutMillis: 10_000,
					idleTimeoutMillis: 5_000,
					allowExitOnIdle: true,
				}
			: {}),
	};
}

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
			const connectionString = getPostgresConnectionString();
			const { PostgresStore } = await import("@agntz/store-postgres");
			_store = new PostgresStore({
				connection: getPostgresPoolConfig(connectionString),
			});
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
