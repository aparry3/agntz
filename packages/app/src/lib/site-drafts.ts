import { randomBytes } from "node:crypto";
import { Pool, type PoolConfig } from "pg";

export interface SiteDraft {
	id: string;
	yaml: string;
	source?: string;
	createdAt: string;
	expiresAt: string;
	consumedAt?: string | null;
}

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_YAML_LENGTH = 256_000;

const memoryDrafts = new Map<string, SiteDraft>();

let pool: Pool | null = null;
let initialized = false;

function usePostgres(): boolean {
	return (process.env.STORE ?? "memory") === "postgres";
}

function getPostgresConnectionString(): string {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL is required for Postgres site drafts.");
	}
	if (process.env.VERCEL) {
		try {
			const hostname = new URL(connectionString).hostname;
			if (hostname.endsWith(".railway.internal")) {
				throw new Error(
					"Vercel cannot connect to Railway private DATABASE_URL (*.railway.internal).",
				);
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes("Railway private")) {
				throw error;
			}
		}
	}
	return connectionString;
}

function getPoolConfig(connectionString: string): PoolConfig {
	if (!process.env.VERCEL) return { connectionString };
	return {
		connectionString,
		max: 1,
		connectionTimeoutMillis: 10_000,
		idleTimeoutMillis: 5_000,
		allowExitOnIdle: true,
	};
}

function getPool(): Pool {
	if (pool) return pool;
	pool = new Pool(getPoolConfig(getPostgresConnectionString()));
	return pool;
}

async function ensureTable(): Promise<void> {
	if (initialized) return;
	await getPool().query(`
		CREATE TABLE IF NOT EXISTS ar_site_drafts (
			draft_id TEXT PRIMARY KEY,
			yaml TEXT NOT NULL,
			source TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL,
			consumed_at TIMESTAMPTZ
		);
		CREATE INDEX IF NOT EXISTS idx_ar_site_drafts_expires
			ON ar_site_drafts(expires_at);
	`);
	initialized = true;
}

function createId(): string {
	return randomBytes(18).toString("base64url");
}

function assertYaml(yaml: string) {
	if (!yaml.trim()) throw new Error("yaml is required");
	if (yaml.length > MAX_YAML_LENGTH) {
		throw new Error(`yaml exceeds max length of ${MAX_YAML_LENGTH} characters`);
	}
}

export async function createSiteDraft(input: {
	yaml: string;
	source?: string;
}): Promise<SiteDraft> {
	assertYaml(input.yaml);
	const now = new Date();
	const draft: SiteDraft = {
		id: createId(),
		yaml: input.yaml,
		source: input.source,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
		consumedAt: null,
	};

	if (!usePostgres()) {
		memoryDrafts.set(draft.id, draft);
		return draft;
	}

	await ensureTable();
	await getPool().query(
		`INSERT INTO ar_site_drafts (draft_id, yaml, source, created_at, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		[
			draft.id,
			draft.yaml,
			draft.source ?? null,
			draft.createdAt,
			draft.expiresAt,
		],
	);
	return draft;
}

export async function consumeSiteDraft(id: string): Promise<SiteDraft | null> {
	if (!usePostgres()) {
		const draft = memoryDrafts.get(id);
		if (!draft) return null;
		if (draft.consumedAt || new Date(draft.expiresAt).getTime() <= Date.now()) {
			memoryDrafts.delete(id);
			return null;
		}
		const consumed = { ...draft, consumedAt: new Date().toISOString() };
		memoryDrafts.set(id, consumed);
		return consumed;
	}

	await ensureTable();
	const res = await getPool().query(
		`UPDATE ar_site_drafts
		 SET consumed_at = NOW()
		 WHERE draft_id = $1
		   AND consumed_at IS NULL
		   AND expires_at > NOW()
		 RETURNING draft_id, yaml, source, created_at, expires_at, consumed_at`,
		[id],
	);
	const row = res.rows[0] as
		| {
				draft_id: string;
				yaml: string;
				source?: string | null;
				created_at: Date;
				expires_at: Date;
				consumed_at?: Date | null;
		  }
		| undefined;
	if (!row) return null;
	return {
		id: row.draft_id,
		yaml: row.yaml,
		source: row.source ?? undefined,
		createdAt: row.created_at.toISOString(),
		expiresAt: row.expires_at.toISOString(),
		consumedAt: row.consumed_at?.toISOString() ?? null,
	};
}
