import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	INVOCATION_LOG_BLOCKS_PREFIX as BLOCKS_JSON_PREFIX,
	decryptSecret,
	defineSkill,
	encryptSecret,
	getLastFour,
	listEvalRunsInProcess,
} from "@agntz/core";
import type {
	AgentDefinition,
	AgentVersionSummary,
	ApiKeyRecord,
	Connection,
	ConnectionConfig,
	ConnectionKind,
	ContentBlock,
	ContextEntry,
	EvalDataset,
	EvalDatasetListFilters,
	EvalDatasetVersionSummary,
	EvalDefinition,
	EvalLatestScore,
	EvalLatestScoreKey,
	EvalLatestScoreListFilters,
	EvalListFilters,
	EvalRun,
	EvalRunListFilters,
	EvalRunListResult,
	EvalVersionSummary,
	InvocationLog,
	InvokeResult,
	LogFilter,
	Message,
	ProviderConfig,
	Run,
	RunListFilters,
	RunListResult,
	RunStatus,
	SecretDefinition,
	SecretMetadata,
	SessionSnapshot,
	SessionSummary,
	SkillDefinition,
	Span,
	TraceFilter,
	TraceSummary,
	UnifiedStore,
	WebhookDelivery,
} from "@agntz/core";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

const MIGRATIONS = [
	// v1: Initial schema
	`
  CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    activated_at TEXT,
    PRIMARY KEY (agent_id, created_at)
  );
  CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(agent_id, activated_at);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_call_id TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

  CREATE TABLE IF NOT EXISTS context_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    context_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    invocation_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_context_entries_context ON context_entries(context_id);

  CREATE TABLE IF NOT EXISTS invocation_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    tool_calls TEXT NOT NULL DEFAULT '[]',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    error TEXT,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_logs_agent ON invocation_logs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_logs_session ON invocation_logs(session_id);
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON invocation_logs(timestamp);

  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );
  INSERT INTO schema_version (version) VALUES (1);
  `,
	// v2: Provider configuration
	`
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    base_url TEXT,
    config TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  UPDATE schema_version SET version = 2;
  `,
	// v3: Per-user scoping + API keys. Dev data is wiped (can't backfill).
	`
  DROP TABLE IF EXISTS workspaces;

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash_active
    ON api_keys(key_hash) WHERE revoked_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

  DELETE FROM messages;
  DELETE FROM sessions;
  DELETE FROM context_entries;
  DELETE FROM invocation_logs;
  DELETE FROM agents;
  DELETE FROM providers;

  ALTER TABLE agents ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE context_entries ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE invocation_logs ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE providers ADD COLUMN user_id TEXT NOT NULL DEFAULT '';

  CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_context_entries_user ON context_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_invocation_logs_user ON invocation_logs(user_id);

  UPDATE schema_version SET version = 3;
  `,
	// v4: User-scoped connections (MCP servers today; more kinds later).
	`
  CREATE TABLE IF NOT EXISTS connections (
    user_id      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description  TEXT,
    config       TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, kind, id)
  );
  CREATE INDEX IF NOT EXISTS idx_connections_user_kind ON connections(user_id, kind);

  UPDATE schema_version SET version = 4;
  `,
	// v5: Runs — first-class agent invocations tracked by RunRegistry.
	// Composite PK on (user_id, id) so Run ids are unique per user, mirroring
	// the per-user scoping used by providers/connections.
	`
  CREATE TABLE IF NOT EXISTS runs (
    user_id           TEXT NOT NULL,
    id                TEXT NOT NULL,
    root_id           TEXT NOT NULL,
    parent_id         TEXT,
    agent_id          TEXT NOT NULL,
    session_id        TEXT,
    spawn_tool_use_id TEXT,
    status            TEXT NOT NULL,
    input             TEXT NOT NULL,
    output            TEXT,
    result_json       TEXT,
    error             TEXT,
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    depth             INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(user_id, parent_id);
  CREATE INDEX IF NOT EXISTS idx_runs_root ON runs(user_id, root_id);
  CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(user_id, started_at DESC);

  UPDATE schema_version SET version = 5;
  `,
	// v6: Distributed tracing — spans + trace summaries.
	`
  CREATE TABLE IF NOT EXISTS ar_spans (
    span_id      TEXT PRIMARY KEY,
    trace_id     TEXT NOT NULL,
    parent_id    TEXT,
    owner_id     TEXT NOT NULL,
    run_id       TEXT,
    session_id   TEXT,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('run','manifest','step','invoke','model','tool')),
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    duration_ms  INTEGER,
    status       TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
    error        TEXT,
    attributes   TEXT NOT NULL DEFAULT '{}',
    events       TEXT NOT NULL DEFAULT '[]',
    scores       TEXT NOT NULL DEFAULT '{}',
    cost_usd     REAL
  );
  CREATE INDEX IF NOT EXISTS idx_ar_spans_owner_started ON ar_spans (owner_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ar_spans_trace ON ar_spans (trace_id);
  CREATE INDEX IF NOT EXISTS idx_ar_spans_parent ON ar_spans (parent_id);

  CREATE TABLE IF NOT EXISTS ar_trace_summaries (
    trace_id        TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL,
    root_name       TEXT NOT NULL,
    agent_id        TEXT,
    started_at      TEXT NOT NULL,
    ended_at        TEXT,
    duration_ms     INTEGER,
    span_count      INTEGER NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    total_cost_usd  REAL
  );
  CREATE INDEX IF NOT EXISTS idx_ar_trace_summaries_owner_started ON ar_trace_summaries (owner_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ar_trace_summaries_owner_agent ON ar_trace_summaries (owner_id, agent_id);

  UPDATE schema_version SET version = 6;
  `,
	// v7: Skills — reusable (instruction + tools) bundles per user.
	// Composite PK on (user_id, name); same skill name may exist for different users.
	`
  CREATE TABLE IF NOT EXISTS skills (
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL,
    instructions TEXT NOT NULL,
    tools        TEXT,
    metadata     TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id);

  UPDATE schema_version SET version = 7;
  `,
	// v8: GymText integration + HTTP tool + unified secrets.
	// Four schema changes that ship together as one PR:
	//   1. invocation_logs.status — terminal state ("completed" | "cancelled"
	//      | "failed") for billing/audit when a run is superseded by
	//      cancel-and-replace.
	//   2. messages.content_blocks — multimodal payload (JSON ContentBlock[])
	//      alongside the legacy text-only `content` column. Writes are dual:
	//      `content` always holds a flattened text view, `content_blocks` is
	//      non-null only when the original message was multimodal. Sqlite
	//      has no native JSONB; TEXT storing JSON is fine.
	//   3. `secrets` table — user-scoped encrypted credentials used for both
	//      HTTP-tool auth tokens and webhook HMAC signing keys. `value` is
	//      AES-256-GCM ciphertext (`base64(iv):base64(tag):base64(ct)`),
	//      `last_four` is the last 4 chars of plaintext for masked-UI
	//      display. Rotation is in-place via SecretStore.putSecret upsert
	//      on (user_id, name).
	//   4. `webhook_deliveries` outbox. `secret_name` references the active
	//      HMAC signing key by name — the dispatcher resolves it at each
	//      delivery attempt so an out-of-band rotation flows through
	//      naturally.
	`
  ALTER TABLE invocation_logs ADD COLUMN status TEXT;

  ALTER TABLE messages ADD COLUMN content_blocks TEXT;

  CREATE TABLE IF NOT EXISTS secrets (
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    value        TEXT NOT NULL,
    last_four    TEXT NOT NULL,
    description  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_secrets_user ON secrets(user_id);

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              TEXT NOT NULL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    run_id          TEXT NOT NULL,
    callback_url    TEXT NOT NULL,
    secret_name     TEXT NOT NULL,
    payload         TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    status          TEXT NOT NULL CHECK (status IN ('pending','delivered','failed_permanent')),
    last_error      TEXT,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_user ON webhook_deliveries(user_id);
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_run ON webhook_deliveries(user_id, run_id);

  UPDATE schema_version SET version = 8;
  `,
	// v9: Per-version aliases (`stable`, `prod`, `pre-tools-overhaul`).
	// Aliases are scoped to (user_id, agent_id) so two agents can share names
	// like `stable`. Pointing an alias is "last write wins" — assigning it to
	// a new version moves it.
	`
  CREATE TABLE IF NOT EXISTS agent_aliases (
    user_id            TEXT NOT NULL,
    agent_id           TEXT NOT NULL,
    alias              TEXT NOT NULL,
    version_created_at TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, agent_id, alias)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_aliases_version
    ON agent_aliases(user_id, agent_id, version_created_at);

  UPDATE schema_version SET version = 9;
  `,
	// v10: Evals — first-class rubric definitions, reusable datasets, and
	// immutable eval run history.
	`
  CREATE TABLE IF NOT EXISTS evals (
    user_id    TEXT NOT NULL,
    id         TEXT NOT NULL,
    agent_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_evals_user_agent ON evals(user_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_evals_user_updated ON evals(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS eval_datasets (
    user_id    TEXT NOT NULL,
    id         TEXT NOT NULL,
    name       TEXT NOT NULL,
    dataset    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_eval_datasets_user_updated ON eval_datasets(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS eval_runs (
    user_id                 TEXT NOT NULL,
    id                      TEXT NOT NULL,
    eval_id                 TEXT NOT NULL,
    dataset_id              TEXT NOT NULL,
    agent_id                TEXT NOT NULL,
    agent_version           TEXT,
    requested_agent_version TEXT,
    status                  TEXT NOT NULL,
    run                     TEXT NOT NULL,
    started_at              TEXT NOT NULL,
    ended_at                TEXT,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_eval_runs_user_started ON eval_runs(user_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_eval_runs_user_agent ON eval_runs(user_id, agent_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_eval_runs_user_eval ON eval_runs(user_id, eval_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_eval_runs_user_dataset ON eval_runs(user_id, dataset_id, started_at DESC);

  UPDATE schema_version SET version = 10;
  `,
	// v11: Agent-scoped eval datasets plus a latest-score cache for
	// version-comparison views. Run history remains append-only in eval_runs.
	`
  ALTER TABLE eval_datasets ADD COLUMN agent_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_eval_datasets_user_agent
    ON eval_datasets(user_id, agent_id, updated_at DESC);

  UPDATE eval_datasets
     SET agent_id = COALESCE(
       json_extract(dataset, '$.agentId'),
       (
         SELECT e.agent_id
           FROM evals e
          WHERE e.user_id = eval_datasets.user_id
            AND json_extract(e.definition, '$.defaultDatasetId') = eval_datasets.id
          LIMIT 1
       ),
       ''
     )
   WHERE agent_id IS NULL;

  UPDATE eval_datasets
     SET dataset = json_set(dataset, '$.agentId', agent_id)
   WHERE agent_id IS NOT NULL
     AND agent_id <> ''
     AND json_extract(dataset, '$.agentId') IS NULL;

  CREATE TABLE IF NOT EXISTS eval_latest_scores (
    user_id                 TEXT NOT NULL,
    eval_id                 TEXT NOT NULL,
    dataset_id              TEXT NOT NULL,
    agent_id                TEXT NOT NULL,
    resolved_agent_version  TEXT NOT NULL,
    requested_agent_version TEXT,
    run_id                  TEXT NOT NULL,
    status                  TEXT NOT NULL,
    overall_score           REAL NOT NULL,
    passed                  INTEGER NOT NULL,
    score                   TEXT NOT NULL,
    started_at              TEXT NOT NULL,
    ended_at                TEXT,
    updated_at              TEXT NOT NULL,
    PRIMARY KEY (user_id, eval_id, dataset_id, resolved_agent_version)
  );
  CREATE INDEX IF NOT EXISTS idx_eval_latest_scores_user_agent
    ON eval_latest_scores(user_id, agent_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_eval_latest_scores_user_eval
    ON eval_latest_scores(user_id, eval_id, dataset_id);

  UPDATE schema_version SET version = 11;
  `,
	// v12: Versioned evals/datasets and latest-score keys pinned by eval,
	// dataset, and agent versions.
	`
  CREATE TABLE IF NOT EXISTS eval_versions (
    user_id      TEXT NOT NULL,
    eval_id      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    activated_at TEXT,
    definition   TEXT NOT NULL,
    PRIMARY KEY (user_id, eval_id, created_at)
  );
  CREATE INDEX IF NOT EXISTS idx_eval_versions_user_eval
    ON eval_versions(user_id, eval_id, created_at DESC);

  INSERT OR IGNORE INTO eval_versions
    (user_id, eval_id, created_at, activated_at, definition)
  SELECT user_id,
         id,
         created_at,
         updated_at,
         json_set(definition, '$.version', created_at)
    FROM evals;

  CREATE TABLE IF NOT EXISTS eval_aliases (
    user_id            TEXT NOT NULL,
    eval_id            TEXT NOT NULL,
    alias              TEXT NOT NULL,
    version_created_at TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, eval_id, alias)
  );
  CREATE INDEX IF NOT EXISTS idx_eval_aliases_version
    ON eval_aliases(user_id, eval_id, version_created_at);

  CREATE TABLE IF NOT EXISTS eval_dataset_versions (
    user_id      TEXT NOT NULL,
    dataset_id   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    activated_at TEXT,
    dataset      TEXT NOT NULL,
    PRIMARY KEY (user_id, dataset_id, created_at)
  );
  CREATE INDEX IF NOT EXISTS idx_eval_dataset_versions_user_dataset
    ON eval_dataset_versions(user_id, dataset_id, created_at DESC);

  INSERT OR IGNORE INTO eval_dataset_versions
    (user_id, dataset_id, created_at, activated_at, dataset)
  SELECT user_id,
         id,
         created_at,
         updated_at,
         json_set(dataset, '$.version', created_at)
    FROM eval_datasets;

  CREATE TABLE IF NOT EXISTS eval_dataset_aliases (
    user_id            TEXT NOT NULL,
    dataset_id         TEXT NOT NULL,
    alias              TEXT NOT NULL,
    version_created_at TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, dataset_id, alias)
  );
  CREATE INDEX IF NOT EXISTS idx_eval_dataset_aliases_version
    ON eval_dataset_aliases(user_id, dataset_id, version_created_at);

  CREATE TABLE IF NOT EXISTS eval_latest_scores_new (
    user_id                 TEXT NOT NULL,
    eval_id                 TEXT NOT NULL,
    eval_version            TEXT NOT NULL,
    dataset_id              TEXT NOT NULL,
    dataset_version         TEXT NOT NULL,
    agent_id                TEXT NOT NULL,
    resolved_agent_version  TEXT NOT NULL,
    requested_agent_version TEXT,
    run_id                  TEXT NOT NULL,
    status                  TEXT NOT NULL,
    overall_score           REAL NOT NULL,
    passed                  INTEGER NOT NULL,
    score                   TEXT NOT NULL,
    started_at              TEXT NOT NULL,
    ended_at                TEXT,
    updated_at              TEXT NOT NULL,
    PRIMARY KEY (
      user_id,
      eval_id,
      eval_version,
      dataset_id,
      dataset_version,
      resolved_agent_version
    )
  );
  CREATE INDEX IF NOT EXISTS idx_eval_latest_scores_new_user_agent
    ON eval_latest_scores_new(user_id, agent_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_eval_latest_scores_new_user_eval
    ON eval_latest_scores_new(user_id, eval_id, eval_version, dataset_id, dataset_version);

  INSERT OR REPLACE INTO eval_latest_scores_new
    (user_id, eval_id, eval_version, dataset_id, dataset_version, agent_id,
     resolved_agent_version, requested_agent_version, run_id, status,
     overall_score, passed, score, started_at, ended_at, updated_at)
  SELECT user_id,
         eval_id,
         COALESCE(json_extract(score, '$.evalVersion'), ''),
         dataset_id,
         COALESCE(json_extract(score, '$.datasetVersion'), ''),
         agent_id,
         resolved_agent_version,
         requested_agent_version,
         run_id,
         status,
         overall_score,
         passed,
         score,
         started_at,
         ended_at,
         updated_at
    FROM eval_latest_scores;

  DROP TABLE eval_latest_scores;
  ALTER TABLE eval_latest_scores_new RENAME TO eval_latest_scores;
  CREATE INDEX IF NOT EXISTS idx_eval_latest_scores_user_agent
    ON eval_latest_scores(user_id, agent_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_eval_latest_scores_user_eval
    ON eval_latest_scores(user_id, eval_id, eval_version, dataset_id, dataset_version);

  UPDATE schema_version SET version = 12;
  `,
];

export interface SqliteStoreOptions {
	path: string;
	wal?: boolean;
	verbose?: boolean;
	userId?: string;
}

export class SqliteStore implements UnifiedStore {
	private db: DatabaseType;
	private ownsDb: boolean;
	private lastTs = 0;
	readonly userId: string | null;

	private nextTimestamp(): string {
		const now = Date.now();
		const next = now > this.lastTs ? now : this.lastTs + 1;
		this.lastTs = next;
		return new Date(next).toISOString();
	}

	constructor(
		options: SqliteStoreOptions | string,
		_internal?: { db: DatabaseType; userId: string },
	) {
		if (_internal) {
			this.db = _internal.db;
			this.ownsDb = false;
			this.userId = _internal.userId;
			return;
		}

		const opts: SqliteStoreOptions =
			typeof options === "string" ? { path: options } : options;

		this.db = new Database(opts.path, {
			verbose: opts.verbose ? console.log : undefined,
		});
		this.ownsDb = true;
		this.userId = opts.userId ?? null;

		this.db.pragma("journal_mode = WAL");
		this.db.pragma("synchronous = NORMAL");
		this.db.pragma("foreign_keys = ON");
		this.db.pragma("busy_timeout = 5000");

		if (opts.wal === false) {
			this.db.pragma("journal_mode = DELETE");
		}

		this.migrate();
	}

	forUser(userId: string): SqliteStore {
		return new SqliteStore({ path: ":memory:" }, { db: this.db, userId });
	}

	private requireUser(): string {
		if (!this.userId) {
			throw new Error("SqliteStore: user not set. Call forUser(id) first.");
		}
		return this.userId;
	}

	private migrate(): void {
		const currentVersion = this.getSchemaVersion();
		for (let i = currentVersion; i < MIGRATIONS.length; i++) {
			this.db.exec(MIGRATIONS[i]);
		}
	}

	private getSchemaVersion(): number {
		try {
			const row = this.db
				.prepare(
					"SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
				)
				.get() as { version: number } | undefined;
			return row?.version ?? 0;
		} catch {
			return 0;
		}
	}

	// ═══ AgentStore ═══

	async getAgent(id: string): Promise<AgentDefinition | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT definition FROM agents
         WHERE user_id = ? AND agent_id = ?
         ORDER BY activated_at DESC NULLS LAST
         LIMIT 1`,
			)
			.get(u, id) as { definition: string } | undefined;
		if (!row) return null;
		return JSON.parse(row.definition) as AgentDefinition;
	}

	async listAgents(): Promise<
		Array<{ id: string; name: string; description?: string }>
	> {
		const u = this.requireUser();
		const rows = this.db
			.prepare(
				`SELECT agent_id, name, description FROM agents
         WHERE user_id = ? AND (agent_id, activated_at) IN (
           SELECT agent_id, MAX(activated_at) FROM agents
           WHERE user_id = ? AND activated_at IS NOT NULL
           GROUP BY agent_id
         )
         ORDER BY name`,
			)
			.all(u, u) as Array<{
			agent_id: string;
			name: string;
			description: string | null;
		}>;

		return rows.map((r) => ({
			id: r.agent_id,
			name: r.name,
			description: r.description ?? undefined,
		}));
	}

	async putAgent(agent: AgentDefinition): Promise<void> {
		const u = this.requireUser();
		const now = this.nextTimestamp();
		const agentWithTimestamp = { ...agent, createdAt: now, updatedAt: now };
		this.db
			.prepare(
				`INSERT INTO agents (user_id, agent_id, name, description, definition, created_at, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				u,
				agent.id,
				agent.name,
				agent.description ?? null,
				JSON.stringify(agentWithTimestamp),
				now,
				now,
			);
	}

	async deleteAgent(id: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare("DELETE FROM agents WHERE user_id = ? AND agent_id = ?")
			.run(u, id);
	}

	async listAgentVersions(agentId: string): Promise<AgentVersionSummary[]> {
		const u = this.requireUser();
		const versionRows = this.db
			.prepare(
				`SELECT created_at, activated_at FROM agents
         WHERE user_id = ? AND agent_id = ?
         ORDER BY created_at DESC`,
			)
			.all(u, agentId) as Array<{
			created_at: string;
			activated_at: string | null;
		}>;
		const aliasRows = this.db
			.prepare(
				`SELECT alias, version_created_at FROM agent_aliases
         WHERE user_id = ? AND agent_id = ?
         ORDER BY alias ASC`,
			)
			.all(u, agentId) as Array<{ alias: string; version_created_at: string }>;
		const aliasesByVersion = new Map<string, string[]>();
		for (const r of aliasRows) {
			const list = aliasesByVersion.get(r.version_created_at) ?? [];
			list.push(r.alias);
			aliasesByVersion.set(r.version_created_at, list);
		}
		return versionRows.map((r) => ({
			createdAt: r.created_at,
			activatedAt: r.activated_at,
			aliases: aliasesByVersion.get(r.created_at) ?? [],
		}));
	}

	async getAgentVersion(
		agentId: string,
		createdAt: string,
	): Promise<AgentDefinition | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT definition FROM agents
         WHERE user_id = ? AND agent_id = ? AND created_at = ?`,
			)
			.get(u, agentId, createdAt) as { definition: string } | undefined;
		if (!row) return null;
		return JSON.parse(row.definition) as AgentDefinition;
	}

	async activateAgentVersion(
		agentId: string,
		createdAt: string,
	): Promise<void> {
		const u = this.requireUser();
		const now = this.nextTimestamp();
		this.db
			.prepare(
				`UPDATE agents SET activated_at = ?
         WHERE user_id = ? AND agent_id = ? AND created_at = ?`,
			)
			.run(now, u, agentId, createdAt);
	}

	async resolveAgentAlias(
		agentId: string,
		alias: string,
	): Promise<string | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT version_created_at FROM agent_aliases
         WHERE user_id = ? AND agent_id = ? AND alias = ?`,
			)
			.get(u, agentId, alias) as { version_created_at: string } | undefined;
		return row?.version_created_at ?? null;
	}

	async setAgentVersionAlias(
		agentId: string,
		createdAt: string,
		alias: string,
	): Promise<void> {
		const u = this.requireUser();
		const exists = this.db
			.prepare(
				`SELECT 1 FROM agents
         WHERE user_id = ? AND agent_id = ? AND created_at = ?`,
			)
			.get(u, agentId, createdAt);
		if (!exists) {
			throw new Error(`Agent version not found: ${agentId}@${createdAt}`);
		}
		const now = this.nextTimestamp();
		this.db
			.prepare(
				`INSERT INTO agent_aliases (user_id, agent_id, alias, version_created_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, agent_id, alias)
         DO UPDATE SET version_created_at = excluded.version_created_at, created_at = excluded.created_at`,
			)
			.run(u, agentId, alias, createdAt, now);
	}

	async removeAgentVersionAlias(agentId: string, alias: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare(
				`DELETE FROM agent_aliases
         WHERE user_id = ? AND agent_id = ? AND alias = ?`,
			)
			.run(u, agentId, alias);
	}

	// ═══ SessionStore ═══

	async getMessages(sessionId: string): Promise<Message[]> {
		const u = this.requireUser();
		const rows = this.db
			.prepare(
				`SELECT m.role, m.content, m.content_blocks, m.tool_calls, m.tool_call_id, m.timestamp
         FROM messages m
         INNER JOIN sessions s ON s.id = m.session_id
         WHERE s.user_id = ? AND m.session_id = ?
         ORDER BY m.id`,
			)
			.all(u, sessionId) as Array<{
			role: string;
			content: string;
			content_blocks: string | null;
			tool_calls: string | null;
			tool_call_id: string | null;
			timestamp: string;
		}>;

		return rows.map((r) => {
			// Prefer the multimodal blocks payload if present; fall back to the
			// legacy text-only column.
			let content: string | ContentBlock[] = r.content;
			if (r.content_blocks) {
				try {
					const parsed = JSON.parse(r.content_blocks);
					if (Array.isArray(parsed)) content = parsed as ContentBlock[];
				} catch {
					// Malformed JSON — surface text fallback rather than throwing.
				}
			}

			const msg: Message = {
				role: r.role as Message["role"],
				content,
				timestamp: r.timestamp,
			};
			if (r.tool_calls) msg.toolCalls = JSON.parse(r.tool_calls);
			if (r.tool_call_id) msg.toolCallId = r.tool_call_id;
			return msg;
		});
	}

	async append(sessionId: string, messages: Message[]): Promise<void> {
		const u = this.requireUser();
		const now = new Date().toISOString();

		const checkOwnership = this.db.prepare(
			"SELECT user_id FROM sessions WHERE id = ?",
		);
		const upsertSession = this.db.prepare(
			`INSERT INTO sessions (user_id, id, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
		);
		const insertMsg = this.db.prepare(
			`INSERT INTO messages (session_id, role, content, content_blocks, tool_calls, tool_call_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);

		const transaction = this.db.transaction(() => {
			const existing = checkOwnership.get(sessionId) as
				| { user_id: string }
				| undefined;
			if (existing && existing.user_id !== u) {
				throw new Error(`Session ${sessionId} belongs to a different user`);
			}
			upsertSession.run(u, sessionId, now, now);
			for (const msg of messages) {
				// Dual-write: legacy text column always populated (flattened view of
				// any blocks), content_blocks only when input was multimodal.
				const { contentText, contentBlocksJson } = serializeContent(
					msg.content,
				);
				insertMsg.run(
					sessionId,
					msg.role,
					contentText,
					contentBlocksJson,
					msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
					msg.toolCallId ?? null,
					msg.timestamp,
				);
			}
		});

		transaction();
	}

	async putSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
		const u = this.requireUser();
		const now = new Date().toISOString();
		const createdAt = snapshot.createdAt ?? now;
		const updatedAt = snapshot.updatedAt ?? now;

		const checkOwnership = this.db.prepare(
			"SELECT user_id FROM sessions WHERE id = ?",
		);
		const upsertSession = this.db.prepare(
			`INSERT INTO sessions (user_id, id, agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         agent_id = excluded.agent_id,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`,
		);
		const deleteMessages = this.db.prepare(
			"DELETE FROM messages WHERE session_id = ?",
		);
		const insertMsg = this.db.prepare(
			`INSERT INTO messages (session_id, role, content, content_blocks, tool_calls, tool_call_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);

		const transaction = this.db.transaction(() => {
			const existing = checkOwnership.get(snapshot.sessionId) as
				| { user_id: string }
				| undefined;
			if (existing && existing.user_id !== u) {
				throw new Error(
					`Session ${snapshot.sessionId} belongs to a different user`,
				);
			}
			upsertSession.run(
				u,
				snapshot.sessionId,
				snapshot.agentId ?? null,
				createdAt,
				updatedAt,
			);
			deleteMessages.run(snapshot.sessionId);
			for (const msg of snapshot.messages) {
				const { contentText, contentBlocksJson } = serializeContent(
					msg.content,
				);
				insertMsg.run(
					snapshot.sessionId,
					msg.role,
					contentText,
					contentBlocksJson,
					msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
					msg.toolCallId ?? null,
					msg.timestamp,
				);
			}
		});

		transaction();
	}

	async deleteSession(sessionId: string): Promise<void> {
		const u = this.requireUser();
		const transaction = this.db.transaction(() => {
			this.db
				.prepare(
					`DELETE FROM messages WHERE session_id IN (
            SELECT id FROM sessions WHERE user_id = ? AND id = ?
          )`,
				)
				.run(u, sessionId);
			this.db
				.prepare("DELETE FROM sessions WHERE user_id = ? AND id = ?")
				.run(u, sessionId);
		});
		transaction();
	}

	async getOrCreateSession(sessionId: string): Promise<void> {
		const u = this.requireUser();
		// Ownership check: if a row exists for a different user, surface that
		// rather than silently aliasing the id.
		const existing = this.db
			.prepare("SELECT user_id FROM sessions WHERE id = ?")
			.get(sessionId) as { user_id: string } | undefined;
		if (existing && existing.user_id !== u) {
			throw new Error(`Session ${sessionId} belongs to a different user`);
		}
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT OR IGNORE INTO sessions (user_id, id, agent_id, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?)`,
			)
			.run(u, sessionId, now, now);
	}

	async listSessions(agentId?: string): Promise<SessionSummary[]> {
		const u = this.requireUser();
		let query = `
      SELECT s.id, s.agent_id, s.created_at, s.updated_at,
             COUNT(m.id) as message_count
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.user_id = ?
    `;
		const params: string[] = [u];

		if (agentId) {
			query += " AND s.agent_id = ?";
			params.push(agentId);
		}

		query += " GROUP BY s.id ORDER BY s.updated_at DESC";

		const rows = this.db.prepare(query).all(...params) as Array<{
			id: string;
			agent_id: string | null;
			created_at: string;
			updated_at: string;
			message_count: number;
		}>;

		return rows.map((r) => ({
			sessionId: r.id,
			agentId: r.agent_id ?? undefined,
			messageCount: r.message_count,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));
	}

	// ═══ ContextStore ═══

	async getContext(contextId: string): Promise<ContextEntry[]> {
		const u = this.requireUser();
		const rows = this.db
			.prepare(
				`SELECT context_id, agent_id, invocation_id, content, created_at FROM context_entries
         WHERE user_id = ? AND context_id = ? ORDER BY id`,
			)
			.all(u, contextId) as Array<{
			context_id: string;
			agent_id: string;
			invocation_id: string;
			content: string;
			created_at: string;
		}>;

		return rows.map((r) => ({
			contextId: r.context_id,
			agentId: r.agent_id,
			invocationId: r.invocation_id,
			content: r.content,
			createdAt: r.created_at,
		}));
	}

	async addContext(contextId: string, entry: ContextEntry): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare(
				`INSERT INTO context_entries (user_id, context_id, agent_id, invocation_id, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				u,
				contextId,
				entry.agentId,
				entry.invocationId,
				entry.content,
				entry.createdAt,
			);
	}

	async clearContext(contextId: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare(
				"DELETE FROM context_entries WHERE user_id = ? AND context_id = ?",
			)
			.run(u, contextId);
	}

	// ═══ LogStore ═══

	async log(entry: InvocationLog): Promise<void> {
		const u = this.requireUser();
		// For multimodal input we serialize the blocks JSON into the existing
		// `input` TEXT column with a sentinel prefix so the column shape stays
		// backward-compatible: legacy readers see the prefix + JSON (still a
		// string); the row helper below detects the prefix and rehydrates the
		// blocks. Avoids adding a separate input_blocks column.
		const inputStored =
			typeof entry.input === "string"
				? entry.input
				: `${BLOCKS_JSON_PREFIX}${JSON.stringify(entry.input)}`;
		this.db
			.prepare(
				`INSERT INTO invocation_logs (user_id, id, agent_id, session_id, input, output, tool_calls,
          prompt_tokens, completion_tokens, total_tokens, duration, model, error, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				u,
				entry.id,
				entry.agentId,
				entry.sessionId ?? null,
				inputStored,
				entry.output,
				JSON.stringify(entry.toolCalls),
				entry.usage.promptTokens,
				entry.usage.completionTokens,
				entry.usage.totalTokens,
				entry.duration,
				entry.model,
				entry.error ?? null,
				entry.timestamp,
				entry.status ?? null,
			);
	}

	async getLogs(filter?: LogFilter): Promise<InvocationLog[]> {
		const u = this.requireUser();
		let query = "SELECT * FROM invocation_logs WHERE user_id = ?";
		const params: unknown[] = [u];

		if (filter?.agentId) {
			query += " AND agent_id = ?";
			params.push(filter.agentId);
		}
		if (filter?.sessionId) {
			query += " AND session_id = ?";
			params.push(filter.sessionId);
		}
		if (filter?.since) {
			query += " AND timestamp >= ?";
			params.push(filter.since);
		}

		query += " ORDER BY timestamp DESC";

		if (filter?.limit) {
			query += " LIMIT ?";
			params.push(filter.limit);
		}
		if (filter?.offset) {
			query += " OFFSET ?";
			params.push(filter.offset);
		}

		const rows = this.db.prepare(query).all(...params) as Array<LogRow>;
		return rows.map(rowToLog);
	}

	async getLog(id: string): Promise<InvocationLog | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare("SELECT * FROM invocation_logs WHERE user_id = ? AND id = ?")
			.get(u, id) as LogRow | undefined;
		if (!row) return null;
		return rowToLog(row);
	}

	// ═══ ProviderStore ═══

	async getProvider(id: string): Promise<ProviderConfig | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				"SELECT id, api_key, base_url, config, updated_at FROM providers WHERE user_id = ? AND id = ?",
			)
			.get(u, id) as
			| {
					id: string;
					api_key: string;
					base_url: string | null;
					config: string | null;
					updated_at: string;
			  }
			| undefined;
		if (!row) return null;
		return {
			id: row.id,
			apiKey: row.api_key,
			baseUrl: row.base_url ?? undefined,
			config: row.config
				? (JSON.parse(row.config) as Record<string, unknown>)
				: undefined,
			updatedAt: row.updated_at,
		};
	}

	async listProviders(): Promise<Array<{ id: string; configured: boolean }>> {
		const u = this.requireUser();
		const rows = this.db
			.prepare(
				"SELECT id, api_key FROM providers WHERE user_id = ? ORDER BY id",
			)
			.all(u) as Array<{ id: string; api_key: string }>;
		return rows.map((r) => ({ id: r.id, configured: !!r.api_key }));
	}

	async putProvider(provider: ProviderConfig): Promise<void> {
		const u = this.requireUser();
		const now = new Date().toISOString();
		const existing = this.db
			.prepare("SELECT id FROM providers WHERE user_id = ? AND id = ?")
			.get(u, provider.id);
		if (existing) {
			this.db
				.prepare(
					`UPDATE providers SET api_key = ?, base_url = ?, config = ?, updated_at = ?
           WHERE user_id = ? AND id = ?`,
				)
				.run(
					provider.apiKey,
					provider.baseUrl ?? null,
					provider.config ? JSON.stringify(provider.config) : null,
					now,
					u,
					provider.id,
				);
		} else {
			this.db
				.prepare(
					`INSERT INTO providers (user_id, id, api_key, base_url, config, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.run(
					u,
					provider.id,
					provider.apiKey,
					provider.baseUrl ?? null,
					provider.config ? JSON.stringify(provider.config) : null,
					now,
				);
		}
	}

	async deleteProvider(id: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare("DELETE FROM providers WHERE user_id = ? AND id = ?")
			.run(u, id);
	}

	// ═══ ConnectionStore ═══

	async getConnection(
		kind: ConnectionKind,
		id: string,
	): Promise<Connection | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT id, kind, display_name, description, config, created_at, updated_at
         FROM connections
         WHERE user_id = ? AND kind = ? AND id = ?`,
			)
			.get(u, kind, id) as
			| {
					id: string;
					kind: string;
					display_name: string;
					description: string | null;
					config: string;
					created_at: string;
					updated_at: string;
			  }
			| undefined;
		if (!row) return null;
		return sqliteRowToConnection(row);
	}

	async listConnections(kind?: ConnectionKind): Promise<Connection[]> {
		const u = this.requireUser();
		const rows = kind
			? (this.db
					.prepare(
						`SELECT id, kind, display_name, description, config, created_at, updated_at
             FROM connections WHERE user_id = ? AND kind = ? ORDER BY kind, id`,
					)
					.all(u, kind) as Array<{
					id: string;
					kind: string;
					display_name: string;
					description: string | null;
					config: string;
					created_at: string;
					updated_at: string;
				}>)
			: (this.db
					.prepare(
						`SELECT id, kind, display_name, description, config, created_at, updated_at
             FROM connections WHERE user_id = ? ORDER BY kind, id`,
					)
					.all(u) as Array<{
					id: string;
					kind: string;
					display_name: string;
					description: string | null;
					config: string;
					created_at: string;
					updated_at: string;
				}>);
		return rows.map(sqliteRowToConnection);
	}

	async putConnection(connection: Connection): Promise<void> {
		const u = this.requireUser();
		const now = new Date().toISOString();
		const existing = this.db
			.prepare(
				"SELECT 1 FROM connections WHERE user_id = ? AND kind = ? AND id = ?",
			)
			.get(u, connection.kind, connection.id);
		if (existing) {
			this.db
				.prepare(
					`UPDATE connections
           SET display_name = ?, description = ?, config = ?, updated_at = ?
           WHERE user_id = ? AND kind = ? AND id = ?`,
				)
				.run(
					connection.displayName,
					connection.description ?? null,
					JSON.stringify(connection.config),
					now,
					u,
					connection.kind,
					connection.id,
				);
		} else {
			this.db
				.prepare(
					`INSERT INTO connections
             (user_id, kind, id, display_name, description, config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					u,
					connection.kind,
					connection.id,
					connection.displayName,
					connection.description ?? null,
					JSON.stringify(connection.config),
					now,
					now,
				);
		}
	}

	async deleteConnection(kind: ConnectionKind, id: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare(
				"DELETE FROM connections WHERE user_id = ? AND kind = ? AND id = ?",
			)
			.run(u, kind, id);
	}

	// ═══ RunStore ═══

	async putRun(run: Run): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare(
				`INSERT INTO runs (
            user_id, id, root_id, parent_id, agent_id, session_id,
            spawn_tool_use_id, status, input, output, result_json, error,
            started_at, ended_at, depth
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET
           root_id = excluded.root_id,
           parent_id = excluded.parent_id,
           agent_id = excluded.agent_id,
           session_id = excluded.session_id,
           spawn_tool_use_id = excluded.spawn_tool_use_id,
           status = excluded.status,
           input = excluded.input,
           output = excluded.output,
           result_json = excluded.result_json,
           error = excluded.error,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           depth = excluded.depth`,
			)
			.run(
				u,
				run.id,
				run.rootId,
				run.parentId ?? null,
				run.agentId,
				run.sessionId ?? null,
				run.spawnToolUseId ?? null,
				run.status,
				run.input,
				run.result?.output ?? null,
				run.result ? JSON.stringify(run.result) : null,
				run.error ?? null,
				run.startedAt,
				run.endedAt ?? null,
				run.depth,
			);
	}

	async getRun(runId: string): Promise<Run | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT id, user_id, root_id, parent_id, agent_id, session_id,
                spawn_tool_use_id, status, input, output, result_json, error,
                started_at, ended_at, depth
         FROM runs
         WHERE user_id = ? AND id = ?`,
			)
			.get(u, runId) as RunRow | undefined;
		return row ? rowToRun(row) : null;
	}

	async listChildren(parentRunId: string): Promise<Run[]> {
		const u = this.requireUser();
		const rows = this.db
			.prepare(
				`SELECT id, user_id, root_id, parent_id, agent_id, session_id,
                spawn_tool_use_id, status, input, output, result_json, error,
                started_at, ended_at, depth
         FROM runs
         WHERE user_id = ? AND parent_id = ?
         ORDER BY started_at, id`,
			)
			.all(u, parentRunId) as RunRow[];
		return rows.map(rowToRun);
	}

	async listSubtree(rootId: string): Promise<Run[]> {
		const u = this.requireUser();
		// Recursive CTE walks the parent_id graph starting at rootId.
		// Includes the root itself when present.
		const rows = this.db
			.prepare(
				`WITH RECURSIVE subtree(id) AS (
            SELECT id FROM runs WHERE user_id = ? AND id = ?
            UNION ALL
            SELECT r.id FROM runs r
            INNER JOIN subtree s ON r.parent_id = s.id
            WHERE r.user_id = ?
         )
         SELECT r.id, r.user_id, r.root_id, r.parent_id, r.agent_id, r.session_id,
                r.spawn_tool_use_id, r.status, r.input, r.output, r.result_json, r.error,
                r.started_at, r.ended_at, r.depth
         FROM runs r
         INNER JOIN subtree s ON s.id = r.id
         WHERE r.user_id = ?
         ORDER BY r.depth, r.started_at, r.id`,
			)
			.all(u, rootId, u, u) as RunRow[];
		return rows.map(rowToRun);
	}

	async listRuns(filters: RunListFilters): Promise<RunListResult> {
		const u = this.requireUser();
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
		const rootsOnly = filters.rootsOnly ?? true;

		const clauses: string[] = ["user_id = ?"];
		const args: unknown[] = [u];

		if (rootsOnly) clauses.push("parent_id IS NULL");
		if (filters.agentId) {
			clauses.push("agent_id = ?");
			args.push(filters.agentId);
		}
		if (filters.status) {
			clauses.push("status = ?");
			args.push(filters.status);
		}
		if (filters.startedAfter) {
			const t = Date.parse(filters.startedAfter);
			if (Number.isFinite(t)) {
				clauses.push("started_at >= ?");
				args.push(t);
			}
		}
		if (filters.startedBefore) {
			const t = Date.parse(filters.startedBefore);
			if (Number.isFinite(t)) {
				clauses.push("started_at <= ?");
				args.push(t);
			}
		}
		if (filters.cursor) {
			const c = decodeRunCursor(filters.cursor);
			if (c) {
				// strict less-than on (started_at DESC, id DESC)
				clauses.push("(started_at < ? OR (started_at = ? AND id < ?))");
				args.push(c.startedAt, c.startedAt, c.id);
			}
		}

		args.push(limit + 1); // fetch one extra to detect a next page

		const stmt = this.db.prepare(
			`SELECT * FROM runs
       WHERE ${clauses.join(" AND ")}
       ORDER BY started_at DESC, id DESC
       LIMIT ?`,
		);
		const rawRows = stmt.all(...args) as RunRow[];
		const hasMore = rawRows.length > limit;
		const page = hasMore ? rawRows.slice(0, limit) : rawRows;
		const rows = page.map((r) => rowToRun(r));

		let cursor: string | undefined;
		if (hasMore) {
			const last = rows[rows.length - 1];
			cursor = encodeRunCursor({ startedAt: last.startedAt, id: last.id });
		}
		return { rows, cursor };
	}

	// ═══ EvalStore ═══

	async listEvals(filters: EvalListFilters = {}): Promise<EvalDefinition[]> {
		const u = this.requireUser();
		if (filters.agentId) {
			const rows = this.db
				.prepare(
					`SELECT definition, created_at FROM evals
           WHERE user_id = ? AND agent_id = ?
           ORDER BY updated_at DESC, id DESC`,
				)
				.all(u, filters.agentId) as Array<{ definition: string }>;
			return rows.map((r) => rowToEvalDefinition(r));
		}
		const rows = this.db
			.prepare(
				`SELECT definition, created_at FROM evals
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC`,
			)
			.all(u) as Array<{ definition: string }>;
		return rows.map((r) => rowToEvalDefinition(r));
	}

	async getEval(evalId: string): Promise<EvalDefinition | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				"SELECT definition, created_at FROM evals WHERE user_id = ? AND id = ?",
			)
			.get(u, evalId) as { definition: string } | undefined;
		return row ? rowToEvalDefinition(row) : null;
	}

	async putEval(definition: EvalDefinition): Promise<void> {
		const u = this.requireUser();
		const existing = await this.getEval(definition.id);
		const now = this.nextTimestamp();
		const row: EvalDefinition = {
			...definition,
			createdAt: existing?.createdAt ?? definition.createdAt ?? now,
			version: now,
			updatedAt: now,
		};
		const insertHead = this.db.prepare(
			`INSERT INTO evals
           (user_id, id, agent_id, name, definition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET
           agent_id = excluded.agent_id,
           name = excluded.name,
           definition = excluded.definition,
           updated_at = excluded.updated_at`,
		);
		const insertVersion = this.db.prepare(
			`INSERT INTO eval_versions
           (user_id, eval_id, created_at, activated_at, definition)
         VALUES (?, ?, ?, ?, ?)`,
		);
		const tx = this.db.transaction(() => {
			insertHead.run(
				u,
				row.id,
				row.agentId,
				row.name,
				JSON.stringify(row),
				row.createdAt,
				now,
			);
			insertVersion.run(u, row.id, now, now, JSON.stringify(row));
		});
		tx();
	}

	async deleteEval(evalId: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare("DELETE FROM evals WHERE user_id = ? AND id = ?")
			.run(u, evalId);
		this.db
			.prepare("DELETE FROM eval_versions WHERE user_id = ? AND eval_id = ?")
			.run(u, evalId);
		this.db
			.prepare("DELETE FROM eval_aliases WHERE user_id = ? AND eval_id = ?")
			.run(u, evalId);
	}

	async listEvalVersions(evalId: string): Promise<EvalVersionSummary[]> {
		const u = this.requireUser();
		const rows = this.db
			.prepare(
				`SELECT created_at, activated_at
           FROM eval_versions
          WHERE user_id = ? AND eval_id = ?
          ORDER BY created_at DESC`,
			)
			.all(u, evalId) as Array<{
			created_at: string;
			activated_at: string | null;
		}>;
		const aliases = this.db
			.prepare(
				`SELECT alias, version_created_at
           FROM eval_aliases
          WHERE user_id = ? AND eval_id = ?`,
			)
			.all(u, evalId) as Array<{
			alias: string;
			version_created_at: string;
		}>;
		const aliasesByVersion = new Map<string, string[]>();
		for (const row of aliases) {
			const list = aliasesByVersion.get(row.version_created_at) ?? [];
			list.push(row.alias);
			aliasesByVersion.set(row.version_created_at, list);
		}
		return rows.map((row) => ({
			createdAt: row.created_at,
			activatedAt: row.activated_at,
			aliases: (aliasesByVersion.get(row.created_at) ?? []).sort(),
		}));
	}

	async getEvalVersion(
		evalId: string,
		createdAt: string,
	): Promise<EvalDefinition | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT definition, created_at
           FROM eval_versions
          WHERE user_id = ? AND eval_id = ? AND created_at = ?`,
			)
			.get(u, evalId, createdAt) as
			| { definition: string; created_at: string }
			| undefined;
		return row ? rowToEvalDefinition(row) : null;
	}

	async activateEvalVersion(evalId: string, createdAt: string): Promise<void> {
		const u = this.requireUser();
		const version = await this.getEvalVersion(evalId, createdAt);
		if (!version)
			throw new Error(`Eval version not found: ${evalId}@${createdAt}`);
		const existing = await this.getEval(evalId);
		const now = this.nextTimestamp();
		const row: EvalDefinition = {
			...version,
			createdAt: existing?.createdAt ?? version.createdAt ?? createdAt,
			version: createdAt,
			updatedAt: now,
		};
		const tx = this.db.transaction(() => {
			this.db
				.prepare(
					`INSERT INTO evals
             (user_id, id, agent_id, name, definition, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET
             agent_id = excluded.agent_id,
             name = excluded.name,
             definition = excluded.definition,
             updated_at = excluded.updated_at`,
				)
				.run(
					u,
					row.id,
					row.agentId,
					row.name,
					JSON.stringify(row),
					row.createdAt,
					now,
				);
			this.db
				.prepare(
					`UPDATE eval_versions
              SET activated_at = ?
            WHERE user_id = ? AND eval_id = ? AND created_at = ?`,
				)
				.run(now, u, evalId, createdAt);
		});
		tx();
	}

	async resolveEvalVersionAlias(
		evalId: string,
		alias: string,
	): Promise<string | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT version_created_at
           FROM eval_aliases
          WHERE user_id = ? AND eval_id = ? AND alias = ?`,
			)
			.get(u, evalId, alias) as { version_created_at: string } | undefined;
		return row?.version_created_at ?? null;
	}

	async setEvalVersionAlias(
		evalId: string,
		createdAt: string,
		alias: string,
	): Promise<void> {
		const u = this.requireUser();
		if (!(await this.getEvalVersion(evalId, createdAt))) {
			throw new Error(`Eval version not found: ${evalId}@${createdAt}`);
		}
		this.db
			.prepare(
				`INSERT INTO eval_aliases
           (user_id, eval_id, alias, version_created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, eval_id, alias) DO UPDATE SET
           version_created_at = excluded.version_created_at`,
			)
			.run(u, evalId, alias, createdAt);
	}

	async removeEvalVersionAlias(evalId: string, alias: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare(
				"DELETE FROM eval_aliases WHERE user_id = ? AND eval_id = ? AND alias = ?",
			)
			.run(u, evalId, alias);
	}

	async listDatasets(
		filters: EvalDatasetListFilters = {},
	): Promise<EvalDataset[]> {
		const u = this.requireUser();
		if (filters.agentId) {
			const rows = this.db
				.prepare(
					`SELECT dataset, agent_id, created_at FROM eval_datasets
         WHERE user_id = ? AND agent_id = ?
         ORDER BY updated_at DESC, id DESC`,
				)
				.all(u, filters.agentId) as Array<{
				dataset: string;
				agent_id: string | null;
			}>;
			return rows.map(rowToEvalDataset);
		}
		const rows = this.db
			.prepare(
				`SELECT dataset, agent_id, created_at FROM eval_datasets
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC`,
			)
			.all(u) as Array<{ dataset: string; agent_id: string | null }>;
		return rows.map(rowToEvalDataset);
	}

	async getDataset(datasetId: string): Promise<EvalDataset | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				"SELECT dataset, agent_id, created_at FROM eval_datasets WHERE user_id = ? AND id = ?",
			)
			.get(u, datasetId) as
			| { dataset: string; agent_id: string | null }
			| undefined;
		return row ? rowToEvalDataset(row) : null;
	}

	async putDataset(dataset: EvalDataset): Promise<void> {
		const u = this.requireUser();
		const existing = await this.getDataset(dataset.id);
		const now = this.nextTimestamp();
		const row: EvalDataset = {
			...dataset,
			createdAt: existing?.createdAt ?? dataset.createdAt ?? now,
			version: now,
			updatedAt: now,
		};
		const insertHead = this.db.prepare(
			`INSERT INTO eval_datasets
           (user_id, id, agent_id, name, dataset, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET
           agent_id = excluded.agent_id,
           name = excluded.name,
           dataset = excluded.dataset,
           updated_at = excluded.updated_at`,
		);
		const insertVersion = this.db.prepare(
			`INSERT INTO eval_dataset_versions
           (user_id, dataset_id, created_at, activated_at, dataset)
         VALUES (?, ?, ?, ?, ?)`,
		);
		const tx = this.db.transaction(() => {
			insertHead.run(
				u,
				row.id,
				row.agentId,
				row.name,
				JSON.stringify(row),
				row.createdAt,
				now,
			);
			insertVersion.run(u, row.id, now, now, JSON.stringify(row));
		});
		tx();
	}

	async deleteDataset(datasetId: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare("DELETE FROM eval_datasets WHERE user_id = ? AND id = ?")
			.run(u, datasetId);
		this.db
			.prepare(
				"DELETE FROM eval_dataset_versions WHERE user_id = ? AND dataset_id = ?",
			)
			.run(u, datasetId);
		this.db
			.prepare(
				"DELETE FROM eval_dataset_aliases WHERE user_id = ? AND dataset_id = ?",
			)
			.run(u, datasetId);
	}

	async listDatasetVersions(
		datasetId: string,
	): Promise<EvalDatasetVersionSummary[]> {
		const u = this.requireUser();
		const rows = this.db
			.prepare(
				`SELECT created_at, activated_at
           FROM eval_dataset_versions
          WHERE user_id = ? AND dataset_id = ?
          ORDER BY created_at DESC`,
			)
			.all(u, datasetId) as Array<{
			created_at: string;
			activated_at: string | null;
		}>;
		const aliases = this.db
			.prepare(
				`SELECT alias, version_created_at
           FROM eval_dataset_aliases
          WHERE user_id = ? AND dataset_id = ?`,
			)
			.all(u, datasetId) as Array<{
			alias: string;
			version_created_at: string;
		}>;
		const aliasesByVersion = new Map<string, string[]>();
		for (const row of aliases) {
			const list = aliasesByVersion.get(row.version_created_at) ?? [];
			list.push(row.alias);
			aliasesByVersion.set(row.version_created_at, list);
		}
		return rows.map((row) => ({
			createdAt: row.created_at,
			activatedAt: row.activated_at,
			aliases: (aliasesByVersion.get(row.created_at) ?? []).sort(),
		}));
	}

	async getDatasetVersion(
		datasetId: string,
		createdAt: string,
	): Promise<EvalDataset | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT dataset, created_at, NULL AS agent_id
           FROM eval_dataset_versions
          WHERE user_id = ? AND dataset_id = ? AND created_at = ?`,
			)
			.get(u, datasetId, createdAt) as
			| { dataset: string; created_at: string; agent_id: string | null }
			| undefined;
		return row ? rowToEvalDataset(row) : null;
	}

	async activateDatasetVersion(
		datasetId: string,
		createdAt: string,
	): Promise<void> {
		const u = this.requireUser();
		const version = await this.getDatasetVersion(datasetId, createdAt);
		if (!version) {
			throw new Error(`Dataset version not found: ${datasetId}@${createdAt}`);
		}
		const existing = await this.getDataset(datasetId);
		const now = this.nextTimestamp();
		const row: EvalDataset = {
			...version,
			createdAt: existing?.createdAt ?? version.createdAt ?? createdAt,
			version: createdAt,
			updatedAt: now,
		};
		const tx = this.db.transaction(() => {
			this.db
				.prepare(
					`INSERT INTO eval_datasets
             (user_id, id, agent_id, name, dataset, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET
             agent_id = excluded.agent_id,
             name = excluded.name,
             dataset = excluded.dataset,
             updated_at = excluded.updated_at`,
				)
				.run(
					u,
					row.id,
					row.agentId,
					row.name,
					JSON.stringify(row),
					row.createdAt,
					now,
				);
			this.db
				.prepare(
					`UPDATE eval_dataset_versions
              SET activated_at = ?
            WHERE user_id = ? AND dataset_id = ? AND created_at = ?`,
				)
				.run(now, u, datasetId, createdAt);
		});
		tx();
	}

	async resolveDatasetVersionAlias(
		datasetId: string,
		alias: string,
	): Promise<string | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT version_created_at
           FROM eval_dataset_aliases
          WHERE user_id = ? AND dataset_id = ? AND alias = ?`,
			)
			.get(u, datasetId, alias) as { version_created_at: string } | undefined;
		return row?.version_created_at ?? null;
	}

	async setDatasetVersionAlias(
		datasetId: string,
		createdAt: string,
		alias: string,
	): Promise<void> {
		const u = this.requireUser();
		if (!(await this.getDatasetVersion(datasetId, createdAt))) {
			throw new Error(`Dataset version not found: ${datasetId}@${createdAt}`);
		}
		this.db
			.prepare(
				`INSERT INTO eval_dataset_aliases
           (user_id, dataset_id, alias, version_created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, dataset_id, alias) DO UPDATE SET
           version_created_at = excluded.version_created_at`,
			)
			.run(u, datasetId, alias, createdAt);
	}

	async removeDatasetVersionAlias(
		datasetId: string,
		alias: string,
	): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare(
				"DELETE FROM eval_dataset_aliases WHERE user_id = ? AND dataset_id = ? AND alias = ?",
			)
			.run(u, datasetId, alias);
	}

	async putEvalRun(run: EvalRun): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare(
				`INSERT INTO eval_runs
           (user_id, id, eval_id, dataset_id, agent_id, agent_version,
            requested_agent_version, status, run, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET
           eval_id = excluded.eval_id,
           dataset_id = excluded.dataset_id,
           agent_id = excluded.agent_id,
           agent_version = excluded.agent_version,
           requested_agent_version = excluded.requested_agent_version,
           status = excluded.status,
           run = excluded.run,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at`,
			)
			.run(
				u,
				run.id,
				run.evalId,
				run.datasetId,
				run.agentId,
				run.agentVersion ?? null,
				run.requestedAgentVersion ?? null,
				run.status,
				JSON.stringify(run),
				run.startedAt,
				run.endedAt ?? null,
			);
	}

	async getEvalRun(runId: string): Promise<EvalRun | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare("SELECT run FROM eval_runs WHERE user_id = ? AND id = ?")
			.get(u, runId) as { run: string } | undefined;
		return row ? (JSON.parse(row.run) as EvalRun) : null;
	}

	async listEvalRuns(
		filters: EvalRunListFilters = {},
	): Promise<EvalRunListResult> {
		const u = this.requireUser();
		const rows = this.db
			.prepare("SELECT run FROM eval_runs WHERE user_id = ?")
			.all(u) as Array<{ run: string }>;
		return listEvalRunsInProcess(
			rows.map((r) => JSON.parse(r.run) as EvalRun),
			filters,
		);
	}

	async getEvalLatestScore(
		key: EvalLatestScoreKey,
	): Promise<EvalLatestScore | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT score FROM eval_latest_scores
         WHERE user_id = ? AND eval_id = ? AND eval_version = ?
           AND dataset_id = ? AND dataset_version = ?
           AND resolved_agent_version = ?`,
			)
			.get(
				u,
				key.evalId,
				key.evalVersion ?? "",
				key.datasetId,
				key.datasetVersion ?? "",
				key.resolvedAgentVersion ?? "",
			) as { score: string } | undefined;
		return row ? (JSON.parse(row.score) as EvalLatestScore) : null;
	}

	async listEvalLatestScores(
		filters: EvalLatestScoreListFilters = {},
	): Promise<EvalLatestScore[]> {
		const u = this.requireUser();
		const clauses = ["user_id = ?"];
		const args: unknown[] = [u];
		if (filters.agentId) {
			clauses.push("agent_id = ?");
			args.push(filters.agentId);
		}
		if (filters.evalId) {
			clauses.push("eval_id = ?");
			args.push(filters.evalId);
		}
		if (filters.evalVersion) {
			clauses.push("eval_version = ?");
			args.push(filters.evalVersion);
		}
		if (filters.datasetId) {
			clauses.push("dataset_id = ?");
			args.push(filters.datasetId);
		}
		if (filters.datasetVersion) {
			clauses.push("dataset_version = ?");
			args.push(filters.datasetVersion);
		}
		if (filters.resolvedAgentVersion !== undefined) {
			clauses.push("resolved_agent_version = ?");
			args.push(filters.resolvedAgentVersion);
		}
		if (filters.status) {
			clauses.push("status = ?");
			args.push(filters.status);
		}
		const rows = this.db
			.prepare(
				`SELECT score FROM eval_latest_scores
         WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC, started_at DESC, run_id DESC`,
			)
			.all(...args) as Array<{ score: string }>;
		return rows.map((r) => JSON.parse(r.score) as EvalLatestScore);
	}

	async putEvalLatestScore(score: EvalLatestScore): Promise<void> {
		const u = this.requireUser();
		const resolvedVersion = score.resolvedAgentVersion ?? "";
		this.db
			.prepare(
				`INSERT INTO eval_latest_scores
           (user_id, eval_id, eval_version, dataset_id, dataset_version,
            agent_id, resolved_agent_version, requested_agent_version,
            run_id, status, overall_score, passed, score, started_at, ended_at,
            updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(
           user_id,
           eval_id,
           eval_version,
           dataset_id,
           dataset_version,
           resolved_agent_version
         )
         DO UPDATE SET
           agent_id = excluded.agent_id,
           requested_agent_version = excluded.requested_agent_version,
           run_id = excluded.run_id,
           status = excluded.status,
           overall_score = excluded.overall_score,
           passed = excluded.passed,
           score = excluded.score,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           updated_at = excluded.updated_at`,
			)
			.run(
				u,
				score.evalId,
				score.evalVersion ?? "",
				score.datasetId,
				score.datasetVersion ?? "",
				score.agentId,
				resolvedVersion,
				score.requestedAgentVersion ?? null,
				score.runId,
				score.status,
				score.overallScore,
				score.passed ? 1 : 0,
				JSON.stringify(score),
				score.startedAt,
				score.endedAt ?? null,
				score.updatedAt,
			);
	}

	// ═══ TraceStore ═══

	async insertSpan(span: Span): Promise<void> {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO ar_spans (
          span_id, trace_id, parent_id, owner_id, run_id, session_id,
          name, kind, started_at, ended_at, duration_ms, status, error,
          attributes, events, scores, cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				span.spanId,
				span.traceId,
				span.parentId,
				span.ownerId,
				span.runId,
				span.sessionId,
				span.name,
				span.kind,
				span.startedAt,
				span.endedAt,
				span.durationMs,
				span.status,
				span.error,
				JSON.stringify(span.attributes),
				JSON.stringify(span.events),
				JSON.stringify(span.scores),
				span.costUsd,
			);
	}

	async insertSpansBatch(spans: Span[]): Promise<void> {
		const stmt = this.db.prepare(
			`INSERT OR REPLACE INTO ar_spans (
        span_id, trace_id, parent_id, owner_id, run_id, session_id,
        name, kind, started_at, ended_at, duration_ms, status, error,
        attributes, events, scores, cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertMany = this.db.transaction((rows: Span[]) => {
			for (const s of rows) {
				stmt.run(
					s.spanId,
					s.traceId,
					s.parentId,
					s.ownerId,
					s.runId,
					s.sessionId,
					s.name,
					s.kind,
					s.startedAt,
					s.endedAt,
					s.durationMs,
					s.status,
					s.error,
					JSON.stringify(s.attributes),
					JSON.stringify(s.events),
					JSON.stringify(s.scores),
					s.costUsd,
				);
			}
		});
		insertMany(spans);
	}

	async updateSpan(
		spanId: string,
		ownerId: string,
		patch: Partial<Span>,
	): Promise<void> {
		// Owner-scoped: read first, ensure match, then re-insert (PK collision REPLACEs).
		const existing = this.db
			.prepare("SELECT * FROM ar_spans WHERE span_id = ? AND owner_id = ?")
			.get(spanId, ownerId) as Record<string, unknown> | undefined;
		if (!existing) return;
		const merged: Span = {
			...sqliteRowToSpan(existing),
			...patch,
			spanId,
			ownerId,
		};
		await this.insertSpan(merged);
	}

	async upsertSummary(summary: TraceSummary): Promise<void> {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO ar_trace_summaries (
          trace_id, owner_id, root_name, agent_id, started_at, ended_at,
          duration_ms, span_count, status, total_tokens, total_cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				summary.traceId,
				summary.ownerId,
				summary.rootName,
				summary.agentId,
				summary.startedAt,
				summary.endedAt,
				summary.durationMs,
				summary.spanCount,
				summary.status,
				summary.totalTokens,
				summary.totalCostUsd,
			);
	}

	async getTrace(traceId: string, ownerId: string): Promise<Span[]> {
		const rows = this.db
			.prepare(
				`SELECT * FROM ar_spans
         WHERE trace_id = ? AND owner_id = ?
         ORDER BY started_at ASC, span_id ASC`,
			)
			.all(traceId, ownerId) as Record<string, unknown>[];
		return rows.map(sqliteRowToSpan);
	}

	async getSummary(
		traceId: string,
		ownerId: string,
	): Promise<TraceSummary | null> {
		const row = this.db
			.prepare(
				`SELECT * FROM ar_trace_summaries
         WHERE trace_id = ? AND owner_id = ?`,
			)
			.get(traceId, ownerId) as Record<string, unknown> | undefined;
		return row ? sqliteRowToSummary(row) : null;
	}

	async listTraces(
		filter: TraceFilter,
	): Promise<{ rows: TraceSummary[]; cursor?: string }> {
		const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
		const clauses = ["owner_id = ?"];
		const args: unknown[] = [filter.ownerId];
		if (filter.agentId) {
			clauses.push("agent_id = ?");
			args.push(filter.agentId);
		}
		if (filter.status) {
			clauses.push("status = ?");
			args.push(filter.status);
		}
		if (filter.startedAfter) {
			clauses.push("started_at >= ?");
			args.push(filter.startedAfter);
		}
		if (filter.startedBefore) {
			clauses.push("started_at <= ?");
			args.push(filter.startedBefore);
		}
		if (filter.cursor) {
			const decoded = decodeSqliteTraceCursor(filter.cursor);
			if (decoded) {
				clauses.push("(started_at < ? OR (started_at = ? AND trace_id < ?))");
				args.push(decoded.startedAt, decoded.startedAt, decoded.traceId);
			}
		}

		const rows = this.db
			.prepare(
				`SELECT * FROM ar_trace_summaries
         WHERE ${clauses.join(" AND ")}
         ORDER BY started_at DESC, trace_id DESC
         LIMIT ?`,
			)
			.all(...args, limit) as Record<string, unknown>[];

		const summaries = rows.map(sqliteRowToSummary);
		const cursor =
			summaries.length === limit
				? encodeSqliteTraceCursor({
						startedAt: summaries[summaries.length - 1].startedAt,
						traceId: summaries[summaries.length - 1].traceId,
					})
				: undefined;
		return { rows: summaries, cursor };
	}

	async deleteTrace(traceId: string, ownerId: string): Promise<void> {
		const tx = this.db.transaction(() => {
			this.db
				.prepare("DELETE FROM ar_spans WHERE trace_id = ? AND owner_id = ?")
				.run(traceId, ownerId);
			this.db
				.prepare(
					"DELETE FROM ar_trace_summaries WHERE trace_id = ? AND owner_id = ?",
				)
				.run(traceId, ownerId);
		});
		tx();
	}

	async deleteOlderThan(ownerId: string, before: Date): Promise<number> {
		const beforeIso = before.toISOString();
		let deletedCount = 0;
		const tx = this.db.transaction(() => {
			const summaryRows = this.db
				.prepare(
					`SELECT trace_id FROM ar_trace_summaries
           WHERE owner_id = ? AND started_at < ?`,
				)
				.all(ownerId, beforeIso) as { trace_id: string }[];
			deletedCount = summaryRows.length;
			for (const r of summaryRows) {
				this.db
					.prepare("DELETE FROM ar_spans WHERE trace_id = ? AND owner_id = ?")
					.run(r.trace_id, ownerId);
			}
			this.db
				.prepare(
					`DELETE FROM ar_trace_summaries
           WHERE owner_id = ? AND started_at < ?`,
				)
				.run(ownerId, beforeIso);
		});
		tx();
		return deletedCount;
	}

	// ═══ SkillStore ═══

	async getSkill(name: string): Promise<SkillDefinition | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT name, description, instructions, tools, metadata, created_at, updated_at
         FROM skills WHERE user_id = ? AND name = ?`,
			)
			.get(u, name) as SkillRow | undefined;
		return row ? rowToSkill(row) : null;
	}

	async listSkills(): Promise<Array<{ name: string; description: string }>> {
		const u = this.requireUser();
		return this.db
			.prepare(
				"SELECT name, description FROM skills WHERE user_id = ? ORDER BY name",
			)
			.all(u) as Array<{ name: string; description: string }>;
	}

	async putSkill(skill: SkillDefinition): Promise<void> {
		// Structural validation before persisting; throws on malformed input.
		const validated = defineSkill(skill);
		const u = this.requireUser();
		const now = this.nextTimestamp();
		const createdAt = validated.createdAt ?? now;
		this.db
			.prepare(
				`INSERT INTO skills (user_id, name, description, instructions, tools, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, name) DO UPDATE SET
           description = excluded.description,
           instructions = excluded.instructions,
           tools = excluded.tools,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
			)
			.run(
				u,
				validated.name,
				validated.description,
				validated.instructions,
				validated.tools ? JSON.stringify(validated.tools) : null,
				validated.metadata ? JSON.stringify(validated.metadata) : null,
				createdAt,
				now,
			);
	}

	async deleteSkill(name: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare("DELETE FROM skills WHERE user_id = ? AND name = ?")
			.run(u, name);
	}

	// ═══ SecretStore ═══

	async listSecrets(): Promise<SecretMetadata[]> {
		const u = this.requireUser();
		const rows = this.db
			.prepare(
				`SELECT name, last_four, description, created_at, updated_at
         FROM secrets WHERE user_id = ? ORDER BY name ASC`,
			)
			.all(u) as Array<{
			name: string;
			last_four: string;
			description: string | null;
			created_at: string;
			updated_at: string;
		}>;
		return rows.map((r) => ({
			name: r.name,
			lastFour: r.last_four,
			description: r.description ?? undefined,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));
	}

	async getSecretMetadata(name: string): Promise<SecretMetadata | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare(
				`SELECT name, last_four, description, created_at, updated_at
         FROM secrets WHERE user_id = ? AND name = ?`,
			)
			.get(u, name) as
			| {
					name: string;
					last_four: string;
					description: string | null;
					created_at: string;
					updated_at: string;
			  }
			| undefined;
		if (!row) return null;
		return {
			name: row.name,
			lastFour: row.last_four,
			description: row.description ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	async getSecretValue(name: string): Promise<string | null> {
		const u = this.requireUser();
		const row = this.db
			.prepare("SELECT value FROM secrets WHERE user_id = ? AND name = ?")
			.get(u, name) as { value: string } | undefined;
		if (!row) return null;
		return decryptSecret(row.value);
	}

	async putSecret(secret: SecretDefinition): Promise<void> {
		const u = this.requireUser();
		if (!secret.name) {
			throw new Error("putSecret: name is required");
		}
		if (secret.value === undefined || secret.value === null) {
			throw new Error("putSecret: value is required");
		}
		const encrypted = encryptSecret(secret.value);
		const lastFour = getLastFour(secret.value);
		const now = this.nextTimestamp();
		const createdAt = secret.createdAt ?? now;
		this.db
			.prepare(
				`INSERT INTO secrets (user_id, name, value, last_four, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, name) DO UPDATE SET
           value = excluded.value,
           last_four = excluded.last_four,
           description = excluded.description,
           updated_at = excluded.updated_at`,
			)
			.run(
				u,
				secret.name,
				encrypted,
				lastFour,
				secret.description ?? null,
				createdAt,
				now,
			);
	}

	async updateSecretDescription(
		name: string,
		description: string | undefined,
	): Promise<boolean> {
		const u = this.requireUser();
		const now = this.nextTimestamp();
		const info = this.db
			.prepare(
				`UPDATE secrets SET description = ?, updated_at = ?
         WHERE user_id = ? AND name = ?`,
			)
			.run(description ?? null, now, u, name);
		return info.changes > 0;
	}

	async deleteSecret(name: string): Promise<void> {
		const u = this.requireUser();
		this.db
			.prepare("DELETE FROM secrets WHERE user_id = ? AND name = ?")
			.run(u, name);
	}

	// ═══ ApiKeyStore (unscoped) ═══

	async createApiKey(params: { userId: string; name: string }): Promise<{
		record: ApiKeyRecord;
		rawKey: string;
	}> {
		const rawKey = `ar_live_${randomBytes(24).toString("base64url")}`;
		const keyPrefix = rawKey.slice(0, 14);
		const keyHash = createHash("sha256").update(rawKey).digest("hex");
		const id = randomUUID();
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(id, params.userId, params.name, keyPrefix, keyHash, now);
		return {
			record: {
				id,
				userId: params.userId,
				name: params.name,
				keyPrefix,
				createdAt: now,
				lastUsedAt: null,
				revokedAt: null,
			},
			rawKey,
		};
	}

	async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
		const rows = this.db
			.prepare(
				`SELECT id, user_id, name, key_prefix, created_at, last_used_at, revoked_at
         FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
			)
			.all(userId) as Array<ApiKeyRow>;
		return rows.map(rowToApiKey);
	}

	async revokeApiKey(params: { userId: string; keyId: string }): Promise<void> {
		const now = new Date().toISOString();
		this.db
			.prepare(
				`UPDATE api_keys SET revoked_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
			)
			.run(now, params.keyId, params.userId);
	}

	async resolveApiKey(
		rawKey: string,
	): Promise<{ userId: string; keyId: string } | null> {
		const keyHash = createHash("sha256").update(rawKey).digest("hex");
		const row = this.db
			.prepare(
				`SELECT id, user_id FROM api_keys
         WHERE key_hash = ? AND revoked_at IS NULL`,
			)
			.get(keyHash) as { id: string; user_id: string } | undefined;
		if (!row) return null;
		this.db
			.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
			.run(new Date().toISOString(), row.id);
		return { userId: row.user_id, keyId: row.id };
	}

	// ═══ WebhookDeliveryStore ═══

	async insert(
		delivery: Omit<WebhookDelivery, "attempts" | "status" | "createdAt"> & {
			payload: Record<string, unknown>;
		},
	): Promise<string> {
		const u = this.requireUser();
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO webhook_deliveries (
            id, user_id, run_id, callback_url, secret_name, payload,
            attempts, status, last_error, last_attempt_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', NULL, NULL, ?)`,
			)
			.run(
				delivery.id,
				u,
				delivery.runId,
				delivery.callbackUrl,
				delivery.secretName,
				JSON.stringify(delivery.payload),
				now,
			);
		return delivery.id;
	}

	async updateStatus(
		id: string,
		status: WebhookDelivery["status"],
		lastError?: string,
	): Promise<void> {
		const u = this.requireUser();
		if (lastError !== undefined) {
			this.db
				.prepare(
					`UPDATE webhook_deliveries SET status = ?, last_error = ?
           WHERE user_id = ? AND id = ?`,
				)
				.run(status, lastError, u, id);
		} else {
			this.db
				.prepare(
					`UPDATE webhook_deliveries SET status = ?
           WHERE user_id = ? AND id = ?`,
				)
				.run(status, u, id);
		}
	}

	async incrementAttempt(id: string, lastError?: string): Promise<void> {
		const u = this.requireUser();
		const now = new Date().toISOString();
		if (lastError !== undefined) {
			this.db
				.prepare(
					`UPDATE webhook_deliveries
           SET attempts = attempts + 1, last_attempt_at = ?, last_error = ?
           WHERE user_id = ? AND id = ?`,
				)
				.run(now, lastError, u, id);
		} else {
			this.db
				.prepare(
					`UPDATE webhook_deliveries
           SET attempts = attempts + 1, last_attempt_at = ?
           WHERE user_id = ? AND id = ?`,
				)
				.run(now, u, id);
		}
	}

	async listPending(filter?: { olderThan?: string; limit?: number }): Promise<
		WebhookDelivery[]
	> {
		const u = this.requireUser();
		const clauses = ["user_id = ?", "status = 'pending'"];
		const args: unknown[] = [u];
		if (filter?.olderThan) {
			clauses.push("created_at < ?");
			args.push(filter.olderThan);
		}
		const limit = filter?.limit ?? 1000;
		args.push(limit);
		const rows = this.db
			.prepare(
				`SELECT id, user_id, run_id, callback_url, secret_name, payload,
                attempts, last_attempt_at, status, last_error, created_at
         FROM webhook_deliveries
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at ASC
         LIMIT ?`,
			)
			.all(...args) as Array<WebhookDeliveryRow>;
		return rows.map(rowToWebhookDelivery);
	}

	// ═══ Lifecycle ═══

	close(): void {
		if (this.ownsDb) {
			this.db.close();
		}
	}

	get database(): DatabaseType {
		return this.db;
	}
}

interface LogRow {
	id: string;
	agent_id: string;
	session_id: string | null;
	input: string;
	output: string;
	tool_calls: string;
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	duration: number;
	model: string;
	error: string | null;
	timestamp: string;
	status: string | null;
}

interface ApiKeyRow {
	id: string;
	user_id: string;
	name: string;
	key_prefix: string;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

interface RunRow {
	id: string;
	user_id: string;
	root_id: string;
	parent_id: string | null;
	agent_id: string;
	session_id: string | null;
	spawn_tool_use_id: string | null;
	status: string;
	input: string;
	output: string | null;
	result_json: string | null;
	error: string | null;
	started_at: number;
	ended_at: number | null;
	depth: number;
}

interface SkillRow {
	name: string;
	description: string;
	instructions: string;
	tools: string | null;
	metadata: string | null;
	created_at: string;
	updated_at: string;
}

interface WebhookDeliveryRow {
	id: string;
	user_id: string;
	run_id: string;
	callback_url: string;
	secret_name: string;
	payload: string;
	attempts: number;
	last_attempt_at: string | null;
	status: WebhookDelivery["status"];
	last_error: string | null;
	created_at: string;
}

function rowToWebhookDelivery(r: WebhookDeliveryRow): WebhookDelivery {
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(r.payload) as Record<string, unknown>;
	} catch {
		payload = {};
	}
	const d: WebhookDelivery = {
		id: r.id,
		runId: r.run_id,
		callbackUrl: r.callback_url,
		secretName: r.secret_name,
		payload,
		attempts: r.attempts,
		status: r.status,
		createdAt: r.created_at,
	};
	if (r.last_attempt_at) d.lastAttemptAt = r.last_attempt_at;
	if (r.last_error) d.lastError = r.last_error;
	return d;
}

/**
 * Serialize a `Message.content` for dual-write. Always returns a flattened
 * text view for the legacy `content` column; the JSON blocks view is set
 * only when the content was a `ContentBlock[]`. Plain-string content writes
 * NULL to content_blocks so old rows look identical.
 */
function serializeContent(content: string | ContentBlock[]): {
	contentText: string;
	contentBlocksJson: string | null;
} {
	if (typeof content === "string") {
		return { contentText: content, contentBlocksJson: null };
	}
	// Flatten for the text column — image blocks render as a `[image]`
	// placeholder so logs/UIs that read content TEXT stay sensible.
	const pieces: string[] = [];
	for (const b of content) {
		if (b.type === "text") pieces.push(b.text);
		else pieces.push("[image]");
	}
	return {
		contentText: pieces.join(" "),
		contentBlocksJson: JSON.stringify(content),
	};
}

function rowToSkill(r: SkillRow): SkillDefinition {
	const skill: SkillDefinition = {
		name: r.name,
		description: r.description,
		instructions: r.instructions,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
	if (r.tools) skill.tools = JSON.parse(r.tools) as SkillDefinition["tools"];
	if (r.metadata)
		skill.metadata = JSON.parse(r.metadata) as Record<string, unknown>;
	return skill;
}

function rowToRun(r: RunRow): Run {
	const run: Run = {
		id: r.id,
		rootId: r.root_id,
		agentId: r.agent_id,
		status: r.status as RunStatus,
		input: r.input,
		startedAt: r.started_at,
		depth: r.depth,
	};
	if (r.user_id) run.userId = r.user_id;
	if (r.parent_id !== null) run.parentId = r.parent_id;
	if (r.session_id !== null) run.sessionId = r.session_id;
	if (r.spawn_tool_use_id !== null) run.spawnToolUseId = r.spawn_tool_use_id;
	if (r.error !== null) run.error = r.error;
	if (r.ended_at !== null) run.endedAt = r.ended_at;
	if (r.result_json !== null)
		run.result = JSON.parse(r.result_json) as InvokeResult;
	return run;
}

/**
 * Sentinel prefix on `invocation_logs.input` that signals "what follows is a
 * JSON-encoded `ContentBlock[]`". The prefix is non-empty and unlikely to
 * appear in user-typed input — chosen to be self-documenting in `sqlite3`
 * shell dumps too.
 */

function rowToLog(r: LogRow): InvocationLog {
	let input: string | ContentBlock[] = r.input;
	if (typeof r.input === "string" && r.input.startsWith(BLOCKS_JSON_PREFIX)) {
		try {
			const parsed = JSON.parse(r.input.slice(BLOCKS_JSON_PREFIX.length));
			if (Array.isArray(parsed)) input = parsed as ContentBlock[];
		} catch {
			// Malformed sentinel — leave the raw text in place.
		}
	}
	const log: InvocationLog = {
		id: r.id,
		agentId: r.agent_id,
		sessionId: r.session_id ?? undefined,
		input,
		output: r.output,
		toolCalls: JSON.parse(r.tool_calls),
		usage: {
			promptTokens: r.prompt_tokens,
			completionTokens: r.completion_tokens,
			totalTokens: r.total_tokens,
		},
		duration: r.duration,
		model: r.model,
		error: r.error ?? undefined,
		timestamp: r.timestamp,
	};
	if (r.status) log.status = r.status as InvocationLog["status"];
	return log;
}

function sqliteRowToConnection(r: {
	id: string;
	kind: string;
	display_name: string;
	description: string | null;
	config: string;
	created_at: string;
	updated_at: string;
}): Connection {
	return {
		id: r.id,
		kind: r.kind as ConnectionKind,
		displayName: r.display_name,
		description: r.description ?? undefined,
		config: JSON.parse(r.config) as ConnectionConfig,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

function rowToEvalDefinition(r: {
	definition: string;
	created_at?: string | null;
}): EvalDefinition {
	const definition = JSON.parse(r.definition) as EvalDefinition;
	if (!definition.version && r.created_at) {
		return { ...definition, version: r.created_at };
	}
	return definition;
}

function rowToEvalDataset(r: {
	dataset: string;
	agent_id: string | null;
	created_at?: string | null;
}): EvalDataset {
	const dataset = JSON.parse(r.dataset) as EvalDataset;
	if ((!dataset.agentId && r.agent_id) || (!dataset.version && r.created_at)) {
		return {
			...dataset,
			agentId: dataset.agentId ?? r.agent_id ?? "",
			version: dataset.version ?? r.created_at ?? undefined,
		};
	}
	return dataset;
}

function rowToApiKey(r: ApiKeyRow): ApiKeyRecord {
	return {
		id: r.id,
		userId: r.user_id,
		name: r.name,
		keyPrefix: r.key_prefix,
		createdAt: r.created_at,
		lastUsedAt: r.last_used_at,
		revokedAt: r.revoked_at,
	};
}

function sqliteRowToSpan(r: Record<string, unknown>): Span {
	return {
		spanId: r.span_id as string,
		traceId: r.trace_id as string,
		parentId: (r.parent_id as string | null) ?? null,
		ownerId: r.owner_id as string,
		runId: (r.run_id as string | null) ?? null,
		sessionId: (r.session_id as string | null) ?? null,
		name: r.name as string,
		kind: r.kind as Span["kind"],
		startedAt: r.started_at as string,
		endedAt: (r.ended_at as string | null) ?? null,
		durationMs: (r.duration_ms as number | null) ?? null,
		status: r.status as Span["status"],
		error: (r.error as string | null) ?? null,
		attributes: JSON.parse((r.attributes as string) ?? "{}"),
		events: JSON.parse((r.events as string) ?? "[]"),
		scores: JSON.parse((r.scores as string) ?? "{}"),
		costUsd: (r.cost_usd as number | null) ?? null,
	};
}

function sqliteRowToSummary(r: Record<string, unknown>): TraceSummary {
	return {
		traceId: r.trace_id as string,
		ownerId: r.owner_id as string,
		rootName: r.root_name as string,
		agentId: (r.agent_id as string | null) ?? null,
		startedAt: r.started_at as string,
		endedAt: (r.ended_at as string | null) ?? null,
		durationMs: (r.duration_ms as number | null) ?? null,
		spanCount: r.span_count as number,
		status: r.status as TraceSummary["status"],
		totalTokens: r.total_tokens as number,
		totalCostUsd: (r.total_cost_usd as number | null) ?? null,
	};
}

function encodeRunCursor(c: { startedAt: number; id: string }): string {
	return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeRunCursor(s: string): { startedAt: number; id: string } | null {
	try {
		const c = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
		if (typeof c.startedAt !== "number" || typeof c.id !== "string")
			return null;
		return c;
	} catch {
		return null;
	}
}

function encodeSqliteTraceCursor(c: {
	startedAt: string;
	traceId: string;
}): string {
	return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeSqliteTraceCursor(
	s: string,
): { startedAt: string; traceId: string } | null {
	try {
		return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}
