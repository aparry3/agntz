import type { ResourceProvider } from "@agntz/core";
import {
	InMemoryMemoryStore,
	PostgresMemoryStore,
	createMemrez,
} from "@agntz/memrez";

let _resources: Record<string, ResourceProvider> | null = null;
type MemrezStoreKind = "postgres" | "memory" | "disabled";

/**
 * Worker-wide resource providers. Hosted deployments enable memrez by default
 * when STORE=postgres so agents that declare `resources.memory` work without
 * per-route setup.
 */
export function getResourceProviders(): Record<string, ResourceProvider> {
	if (_resources) return _resources;

	const memrezStore = resolveMemrezStore();
	if (memrezStore === "disabled") {
		_resources = {};
		return _resources;
	}

	const store =
		memrezStore === "postgres"
			? new PostgresMemoryStore({
					connection: requiredConnectionString(),
					tablePrefix: process.env.MEMREZ_TABLE_PREFIX,
					runMigrations: process.env.MEMREZ_RUN_MIGRATIONS !== "false",
				})
			: new InMemoryMemoryStore();

	const memrez = createMemrez({ store });
	_resources = { memory: memrez.provider() };
	return _resources;
}

export function describeResourceProviders(
	resources: Record<string, ResourceProvider>,
): string {
	const names = Object.keys(resources);
	return names.length > 0 ? names.join(", ") : "none";
}

function resolveMemrezStore(): MemrezStoreKind {
	const explicit = process.env.MEMREZ_STORE ?? process.env.MEMREZ;
	if (explicit) {
		const normalized = explicit.toLowerCase();
		if (isDisabled(normalized)) return "disabled";
		if (normalized === "postgres" || normalized === "memory") {
			return normalized;
		}
		throw new Error("MEMREZ_STORE must be one of: postgres, memory, disabled");
	}
	return process.env.STORE === "postgres" ? "postgres" : "memory";
}

function isDisabled(value: string): boolean {
	return ["0", "false", "off", "none", "disabled"].includes(value);
}

function requiredConnectionString(): string {
	const connectionString =
		process.env.MEMREZ_DATABASE_URL ?? process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error(
			"MEMREZ_DATABASE_URL or DATABASE_URL is required when MEMREZ_STORE=postgres",
		);
	}
	return connectionString;
}
