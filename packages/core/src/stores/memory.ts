import { createHash, randomBytes, randomUUID } from "node:crypto";
import { listEvalRunsInProcess } from "../evals.js";
import { defineSkill } from "../skill.js";
import type {
	AgentDefinition,
	AgentVersionSummary,
	ApiKeyRecord,
	Connection,
	ConnectionKind,
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
} from "../types.js";
import { decryptSecret, encryptSecret, getLastFour } from "../utils/crypto.js";
import { listRunsInProcess } from "./list-runs.js";

interface AgentVersion {
	agent: AgentDefinition;
	createdAt: string;
	activatedAt: string | null;
}

interface EvalVersion {
	definition: EvalDefinition;
	createdAt: string;
	activatedAt: string | null;
}

interface EvalDatasetVersion {
	dataset: EvalDataset;
	createdAt: string;
	activatedAt: string | null;
}

interface SessionRow {
	userId: string;
	agentId?: string;
	messages: Message[];
	createdAt: string;
	updatedAt: string;
}

interface ApiKeyRow {
	id: string;
	userId: string;
	name: string;
	keyPrefix: string;
	keyHash: string;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
}

interface SecretRow {
	/** Encrypted ciphertext as `base64(iv):base64(tag):base64(ct)`. */
	encrypted: string;
	lastFour: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * Shared backing state across MemoryStore instances created via forUser().
 */
interface MemoryBackend {
	agentVersions: Map<string, Map<string, AgentVersion[]>>; // userId -> agentId -> versions
	agentAliases: Map<string, Map<string, Map<string, string>>>; // userId -> agentId -> alias -> createdAt
	sessions: Map<string, SessionRow>; // sessionId -> row (row carries userId)
	contexts: Map<string, { userId: string; entries: ContextEntry[] }>;
	logs: Array<{ userId: string; log: InvocationLog }>;
	providers: Map<string, Map<string, ProviderConfig>>; // userId -> providerId -> config
	connections: Map<string, Map<string, Connection>>; // userId -> `${kind}:${id}` -> connection
	apiKeys: Map<string, ApiKeyRow>; // id -> row
	apiKeyByHash: Map<string, ApiKeyRow>; // sha256(rawKey) -> row
	runs: Map<string, Run>; // `${userId}:${runId}` -> run
	spans: Map<string, Span>; // spanId -> span
	summaries: Map<string, TraceSummary>; // traceId -> summary
	skills: Map<string, Map<string, SkillDefinition>>; // userId -> name -> skill
	secrets: Map<string, Map<string, SecretRow>>; // userId -> name -> row
	webhookDeliveries: Map<string, WebhookDelivery>; // id -> delivery
	evals: Map<string, Map<string, EvalDefinition>>; // userId -> evalId -> eval
	evalVersions: Map<string, Map<string, EvalVersion[]>>; // userId -> evalId -> versions
	evalAliases: Map<string, Map<string, Map<string, string>>>; // userId -> evalId -> alias -> createdAt
	datasets: Map<string, Map<string, EvalDataset>>; // userId -> datasetId -> dataset
	datasetVersions: Map<string, Map<string, EvalDatasetVersion[]>>; // userId -> datasetId -> versions
	datasetAliases: Map<string, Map<string, Map<string, string>>>; // userId -> datasetId -> alias -> createdAt
	evalRuns: Map<string, EvalRun>; // `${userId}:${runId}` -> run
	evalLatestScores: Map<string, EvalLatestScore>; // `${userId}:${evalId}:${evalVersion}:${datasetId}:${datasetVersion}:${agentVersion}` -> score
}

function createBackend(): MemoryBackend {
	return {
		agentVersions: new Map(),
		agentAliases: new Map(),
		sessions: new Map(),
		contexts: new Map(),
		logs: [],
		providers: new Map(),
		connections: new Map(),
		apiKeys: new Map(),
		apiKeyByHash: new Map(),
		runs: new Map(),
		spans: new Map(),
		summaries: new Map(),
		skills: new Map(),
		secrets: new Map(),
		webhookDeliveries: new Map(),
		evals: new Map(),
		evalVersions: new Map(),
		evalAliases: new Map(),
		datasets: new Map(),
		datasetVersions: new Map(),
		datasetAliases: new Map(),
		evalRuns: new Map(),
		evalLatestScores: new Map(),
	};
}

/**
 * MemoryStore is the default store for quick-start / test usage. Unlike
 * PostgresStore / SqliteStore, it auto-scopes to a "__default__" user when
 * constructed without explicit userId so tests and single-user demos don't
 * need forUser() ceremony. Multi-user callers still use forUser() as normal.
 */
const DEFAULT_USER_ID = "__default__";

export class MemoryStore implements UnifiedStore {
	private backend: MemoryBackend;
	readonly userId: string | null;
	private lastTs = 0;

	constructor(
		opts: { userId?: string; backend?: MemoryBackend; strict?: boolean } = {},
	) {
		this.backend = opts.backend ?? createBackend();
		if (opts.userId !== undefined) {
			this.userId = opts.userId;
		} else if (opts.strict) {
			this.userId = null;
		} else {
			this.userId = DEFAULT_USER_ID;
		}
	}

	forUser(userId: string): MemoryStore {
		return new MemoryStore({ userId, backend: this.backend });
	}

	private requireUser(): string {
		if (!this.userId) {
			throw new Error("MemoryStore: user not set. Call forUser(id) first.");
		}
		return this.userId;
	}

	private nextTimestamp(): string {
		const now = Date.now();
		const next = now > this.lastTs ? now : this.lastTs + 1;
		this.lastTs = next;
		return new Date(next).toISOString();
	}

	// ═══ AgentStore ═══

	private agentMap(): Map<string, AgentVersion[]> {
		const u = this.requireUser();
		let m = this.backend.agentVersions.get(u);
		if (!m) {
			m = new Map();
			this.backend.agentVersions.set(u, m);
		}
		return m;
	}

	async getAgent(id: string): Promise<AgentDefinition | null> {
		const versions = this.agentMap().get(id);
		if (!versions || versions.length === 0) return null;
		const active = versions
			.filter((v) => v.activatedAt !== null)
			.sort((a, b) => (b.activatedAt ?? "").localeCompare(a.activatedAt ?? ""));
		if (active.length > 0) return active[0].agent;
		return versions[versions.length - 1].agent;
	}

	async listAgents(): Promise<
		Array<{ id: string; name: string; description?: string }>
	> {
		const result: Array<{ id: string; name: string; description?: string }> =
			[];
		for (const [id] of this.agentMap()) {
			const agent = await this.getAgent(id);
			if (agent) {
				result.push({
					id: agent.id,
					name: agent.name,
					description: agent.description,
				});
			}
		}
		return result;
	}

	async putAgent(agent: AgentDefinition): Promise<void> {
		const map = this.agentMap();
		const now = this.nextTimestamp();
		const versions = map.get(agent.id) ?? [];
		versions.push({
			agent: { ...agent, createdAt: now, updatedAt: now },
			createdAt: now,
			activatedAt: now,
		});
		map.set(agent.id, versions);
	}

	async deleteAgent(id: string): Promise<void> {
		this.agentMap().delete(id);
	}

	private aliasMap(): Map<string, Map<string, string>> {
		const u = this.requireUser();
		let m = this.backend.agentAliases.get(u);
		if (!m) {
			m = new Map();
			this.backend.agentAliases.set(u, m);
		}
		return m;
	}

	async listAgentVersions(agentId: string): Promise<AgentVersionSummary[]> {
		const versions = this.agentMap().get(agentId) ?? [];
		const aliasesByVersion = new Map<string, string[]>();
		const aliases = this.aliasMap().get(agentId);
		if (aliases) {
			for (const [alias, createdAt] of aliases) {
				const list = aliasesByVersion.get(createdAt) ?? [];
				list.push(alias);
				aliasesByVersion.set(createdAt, list);
			}
		}
		return versions
			.map((v) => ({
				createdAt: v.createdAt,
				activatedAt: v.activatedAt,
				aliases: (aliasesByVersion.get(v.createdAt) ?? []).sort(),
			}))
			.reverse();
	}

	async getAgentVersion(
		agentId: string,
		createdAt: string,
	): Promise<AgentDefinition | null> {
		const versions = this.agentMap().get(agentId) ?? [];
		const found = versions.find((v) => v.createdAt === createdAt);
		return found?.agent ?? null;
	}

	async activateAgentVersion(
		agentId: string,
		createdAt: string,
	): Promise<void> {
		const versions = this.agentMap().get(agentId) ?? [];
		const found = versions.find((v) => v.createdAt === createdAt);
		if (found) {
			found.activatedAt = this.nextTimestamp();
		}
	}

	async resolveAgentAlias(
		agentId: string,
		alias: string,
	): Promise<string | null> {
		return this.aliasMap().get(agentId)?.get(alias) ?? null;
	}

	async setAgentVersionAlias(
		agentId: string,
		createdAt: string,
		alias: string,
	): Promise<void> {
		const versions = this.agentMap().get(agentId) ?? [];
		if (!versions.some((v) => v.createdAt === createdAt)) {
			throw new Error(`Agent version not found: ${agentId}@${createdAt}`);
		}
		const aliases = this.aliasMap();
		let perAgent = aliases.get(agentId);
		if (!perAgent) {
			perAgent = new Map();
			aliases.set(agentId, perAgent);
		}
		perAgent.set(alias, createdAt);
	}

	async removeAgentVersionAlias(agentId: string, alias: string): Promise<void> {
		this.aliasMap().get(agentId)?.delete(alias);
	}

	// ═══ SessionStore ═══

	async getMessages(sessionId: string): Promise<Message[]> {
		const u = this.requireUser();
		const session = this.backend.sessions.get(sessionId);
		if (!session || session.userId !== u) return [];
		return session.messages;
	}

	async append(sessionId: string, messages: Message[]): Promise<void> {
		const u = this.requireUser();
		const now = new Date().toISOString();
		const session = this.backend.sessions.get(sessionId);
		if (session) {
			if (session.userId !== u) {
				throw new Error(`Session ${sessionId} belongs to a different user`);
			}
			session.messages.push(...messages);
			session.updatedAt = now;
		} else {
			this.backend.sessions.set(sessionId, {
				userId: u,
				messages: [...messages],
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	async putSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
		const u = this.requireUser();
		const existing = this.backend.sessions.get(snapshot.sessionId);
		if (existing && existing.userId !== u) {
			throw new Error(
				`Session ${snapshot.sessionId} belongs to a different user`,
			);
		}
		const now = new Date().toISOString();
		this.backend.sessions.set(snapshot.sessionId, {
			userId: u,
			agentId: snapshot.agentId,
			messages: snapshot.messages.map((message) => ({ ...message })),
			createdAt: snapshot.createdAt ?? existing?.createdAt ?? now,
			updatedAt: snapshot.updatedAt ?? now,
		});
	}

	async deleteSession(sessionId: string): Promise<void> {
		const u = this.requireUser();
		const session = this.backend.sessions.get(sessionId);
		if (session && session.userId === u) {
			this.backend.sessions.delete(sessionId);
		}
	}

	async getOrCreateSession(sessionId: string): Promise<void> {
		const u = this.requireUser();
		const existing = this.backend.sessions.get(sessionId);
		if (existing) {
			if (existing.userId !== u) {
				throw new Error(`Session ${sessionId} belongs to a different user`);
			}
			return;
		}
		const now = new Date().toISOString();
		this.backend.sessions.set(sessionId, {
			userId: u,
			messages: [],
			createdAt: now,
			updatedAt: now,
		});
	}

	async listSessions(agentId?: string): Promise<SessionSummary[]> {
		const u = this.requireUser();
		const result: SessionSummary[] = [];
		for (const [sessionId, session] of this.backend.sessions) {
			if (session.userId !== u) continue;
			if (agentId && session.agentId !== agentId) continue;
			result.push({
				sessionId,
				agentId: session.agentId,
				messageCount: session.messages.length,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
			});
		}
		return result;
	}

	// ═══ ContextStore ═══

	async getContext(contextId: string): Promise<ContextEntry[]> {
		const u = this.requireUser();
		const ctx = this.backend.contexts.get(contextId);
		if (!ctx || ctx.userId !== u) return [];
		return ctx.entries;
	}

	async addContext(contextId: string, entry: ContextEntry): Promise<void> {
		const u = this.requireUser();
		const existing = this.backend.contexts.get(contextId);
		if (existing) {
			if (existing.userId !== u) {
				throw new Error(`Context ${contextId} belongs to a different user`);
			}
			existing.entries.push(entry);
		} else {
			this.backend.contexts.set(contextId, { userId: u, entries: [entry] });
		}
	}

	async clearContext(contextId: string): Promise<void> {
		const u = this.requireUser();
		const existing = this.backend.contexts.get(contextId);
		if (existing && existing.userId === u) {
			this.backend.contexts.delete(contextId);
		}
	}

	// ═══ LogStore ═══

	async log(entry: InvocationLog): Promise<void> {
		const u = this.requireUser();
		this.backend.logs.push({ userId: u, log: entry });
	}

	async getLogs(filter?: LogFilter): Promise<InvocationLog[]> {
		const u = this.requireUser();
		let result = this.backend.logs
			.filter((r) => r.userId === u)
			.map((r) => r.log);

		if (filter?.agentId)
			result = result.filter((l) => l.agentId === filter.agentId);
		if (filter?.sessionId)
			result = result.filter((l) => l.sessionId === filter.sessionId);
		const since = filter?.since;
		if (since) result = result.filter((l) => l.timestamp >= since);

		result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

		if (filter?.offset) result = result.slice(filter.offset);
		if (filter?.limit) result = result.slice(0, filter.limit);

		return result;
	}

	async getLog(id: string): Promise<InvocationLog | null> {
		const u = this.requireUser();
		const found = this.backend.logs.find(
			(r) => r.userId === u && r.log.id === id,
		);
		return found?.log ?? null;
	}

	// ═══ ProviderStore ═══

	private providerMap(): Map<string, ProviderConfig> {
		const u = this.requireUser();
		let m = this.backend.providers.get(u);
		if (!m) {
			m = new Map();
			this.backend.providers.set(u, m);
		}
		return m;
	}

	async getProvider(id: string): Promise<ProviderConfig | null> {
		return this.providerMap().get(id) ?? null;
	}

	async listProviders(): Promise<Array<{ id: string; configured: boolean }>> {
		return Array.from(this.providerMap().values()).map((p) => ({
			id: p.id,
			configured: !!p.apiKey,
		}));
	}

	async putProvider(provider: ProviderConfig): Promise<void> {
		this.providerMap().set(provider.id, {
			...provider,
			updatedAt: new Date().toISOString(),
		});
	}

	async deleteProvider(id: string): Promise<void> {
		this.providerMap().delete(id);
	}

	// ═══ ConnectionStore ═══

	private connectionMap(): Map<string, Connection> {
		const u = this.requireUser();
		let m = this.backend.connections.get(u);
		if (!m) {
			m = new Map();
			this.backend.connections.set(u, m);
		}
		return m;
	}

	async getConnection(
		kind: ConnectionKind,
		id: string,
	): Promise<Connection | null> {
		return this.connectionMap().get(`${kind}:${id}`) ?? null;
	}

	async listConnections(kind?: ConnectionKind): Promise<Connection[]> {
		const all = Array.from(this.connectionMap().values());
		const filtered = kind ? all.filter((c) => c.kind === kind) : all;
		return filtered.sort((a, b) => a.id.localeCompare(b.id));
	}

	async putConnection(connection: Connection): Promise<void> {
		const now = new Date().toISOString();
		const existing = this.connectionMap().get(
			`${connection.kind}:${connection.id}`,
		);
		this.connectionMap().set(`${connection.kind}:${connection.id}`, {
			...connection,
			createdAt: existing?.createdAt ?? connection.createdAt ?? now,
			updatedAt: now,
		});
	}

	async deleteConnection(kind: ConnectionKind, id: string): Promise<void> {
		this.connectionMap().delete(`${kind}:${id}`);
	}

	// ═══ SkillStore ═══

	private skillMap(): Map<string, SkillDefinition> {
		const u = this.requireUser();
		let m = this.backend.skills.get(u);
		if (!m) {
			m = new Map();
			this.backend.skills.set(u, m);
		}
		return m;
	}

	async getSkill(name: string): Promise<SkillDefinition | null> {
		return this.skillMap().get(name) ?? null;
	}

	async listSkills(): Promise<Array<{ name: string; description: string }>> {
		return Array.from(this.skillMap().values())
			.map((s) => ({ name: s.name, description: s.description }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async putSkill(skill: SkillDefinition): Promise<void> {
		const validated = defineSkill(skill);
		const map = this.skillMap();
		const now = this.nextTimestamp();
		const existing = map.get(validated.name);
		map.set(validated.name, {
			...validated,
			createdAt: existing?.createdAt ?? validated.createdAt ?? now,
			updatedAt: now,
		});
	}

	async deleteSkill(name: string): Promise<void> {
		this.skillMap().delete(name);
	}

	// ═══ SecretStore ═══

	private secretMap(): Map<string, SecretRow> {
		const u = this.requireUser();
		let m = this.backend.secrets.get(u);
		if (!m) {
			m = new Map();
			this.backend.secrets.set(u, m);
		}
		return m;
	}

	async listSecrets(): Promise<SecretMetadata[]> {
		const map = this.secretMap();
		return Array.from(map.entries())
			.map(([name, row]) => ({
				name,
				lastFour: row.lastFour,
				description: row.description,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async getSecretMetadata(name: string): Promise<SecretMetadata | null> {
		const row = this.secretMap().get(name);
		if (!row) return null;
		return {
			name,
			lastFour: row.lastFour,
			description: row.description,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	async getSecretValue(name: string): Promise<string | null> {
		const row = this.secretMap().get(name);
		if (!row) return null;
		return decryptSecret(row.encrypted);
	}

	async putSecret(secret: SecretDefinition): Promise<void> {
		if (!secret.name) {
			throw new Error("putSecret: name is required");
		}
		if (secret.value === undefined || secret.value === null) {
			throw new Error("putSecret: value is required");
		}
		const map = this.secretMap();
		const now = this.nextTimestamp();
		const existing = map.get(secret.name);
		map.set(secret.name, {
			encrypted: encryptSecret(secret.value),
			lastFour: getLastFour(secret.value),
			description: secret.description,
			createdAt: existing?.createdAt ?? secret.createdAt ?? now,
			updatedAt: now,
		});
	}

	async updateSecretDescription(
		name: string,
		description: string | undefined,
	): Promise<boolean> {
		const map = this.secretMap();
		const row = map.get(name);
		if (!row) return false;
		const now = this.nextTimestamp();
		map.set(name, {
			...row,
			description,
			updatedAt: now,
		});
		return true;
	}

	async deleteSecret(name: string): Promise<void> {
		this.secretMap().delete(name);
	}

	// ═══ ApiKeyStore (unscoped admin) ═══

	async createApiKey(params: { userId: string; name: string }): Promise<{
		record: ApiKeyRecord;
		rawKey: string;
	}> {
		const rawKey = `ar_live_${randomBytes(24).toString("base64url")}`;
		const keyPrefix = rawKey.slice(0, 14);
		const keyHash = createHash("sha256").update(rawKey).digest("hex");
		const row: ApiKeyRow = {
			id: randomUUID(),
			userId: params.userId,
			name: params.name,
			keyPrefix,
			keyHash,
			createdAt: new Date().toISOString(),
			lastUsedAt: null,
			revokedAt: null,
		};
		this.backend.apiKeys.set(row.id, row);
		this.backend.apiKeyByHash.set(keyHash, row);
		return { record: rowToRecord(row), rawKey };
	}

	async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
		return Array.from(this.backend.apiKeys.values())
			.filter((r) => r.userId === userId)
			.map(rowToRecord)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async revokeApiKey(params: { userId: string; keyId: string }): Promise<void> {
		const row = this.backend.apiKeys.get(params.keyId);
		if (!row || row.userId !== params.userId) return;
		row.revokedAt = new Date().toISOString();
	}

	async resolveApiKey(
		rawKey: string,
	): Promise<{ userId: string; keyId: string } | null> {
		const keyHash = createHash("sha256").update(rawKey).digest("hex");
		const row = this.backend.apiKeyByHash.get(keyHash);
		if (!row || row.revokedAt) return null;
		row.lastUsedAt = new Date().toISOString();
		return { userId: row.userId, keyId: row.id };
	}

	// ═══ RunStore ═══

	private runKey(userId: string, runId: string): string {
		return `${userId}:${runId}`;
	}

	async putRun(run: Run): Promise<void> {
		const u = this.requireUser();
		this.backend.runs.set(this.runKey(u, run.id), { ...run });
	}

	async getRun(runId: string): Promise<Run | null> {
		const u = this.requireUser();
		return this.backend.runs.get(this.runKey(u, runId)) ?? null;
	}

	async listChildren(parentRunId: string): Promise<Run[]> {
		const u = this.requireUser();
		const results: Run[] = [];
		for (const [key, run] of this.backend.runs) {
			if (key.startsWith(`${u}:`) && run.parentId === parentRunId) {
				results.push({ ...run });
			}
		}
		return results.sort(
			(a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
		);
	}

	async listSubtree(rootId: string): Promise<Run[]> {
		const u = this.requireUser();
		// Collect all runs for this user
		const allRuns: Run[] = [];
		for (const [key, run] of this.backend.runs) {
			if (key.startsWith(`${u}:`)) allRuns.push(run);
		}
		// BFS from rootId
		const result: Run[] = [];
		const visited = new Set<string>();
		const queue = [rootId];
		while (queue.length > 0) {
			const id = queue.shift();
			if (id === undefined) continue;
			if (visited.has(id)) continue;
			visited.add(id);
			const run = this.backend.runs.get(this.runKey(u, id));
			if (run) {
				result.push({ ...run });
				for (const r of allRuns) {
					if (r.parentId === id && !visited.has(r.id)) queue.push(r.id);
				}
			}
		}
		return result.sort(
			(a, b) =>
				a.depth - b.depth ||
				a.startedAt - b.startedAt ||
				a.id.localeCompare(b.id),
		);
	}

	private scopedRunsArray(): Run[] {
		const u = this.requireUser();
		const prefix = `${u}:`;
		const results: Run[] = [];
		for (const [key, run] of this.backend.runs) {
			if (key.startsWith(prefix)) results.push({ ...run });
		}
		return results;
	}

	async listRuns(filters: RunListFilters): Promise<RunListResult> {
		return listRunsInProcess(this.scopedRunsArray(), filters);
	}

	// ═══ EvalStore ═══

	private evalMap(): Map<string, EvalDefinition> {
		const u = this.requireUser();
		let m = this.backend.evals.get(u);
		if (!m) {
			m = new Map();
			this.backend.evals.set(u, m);
		}
		return m;
	}

	private evalVersionMap(): Map<string, EvalVersion[]> {
		const u = this.requireUser();
		let m = this.backend.evalVersions.get(u);
		if (!m) {
			m = new Map();
			this.backend.evalVersions.set(u, m);
		}
		return m;
	}

	private evalAliasMap(): Map<string, Map<string, string>> {
		const u = this.requireUser();
		let m = this.backend.evalAliases.get(u);
		if (!m) {
			m = new Map();
			this.backend.evalAliases.set(u, m);
		}
		return m;
	}

	private datasetMap(): Map<string, EvalDataset> {
		const u = this.requireUser();
		let m = this.backend.datasets.get(u);
		if (!m) {
			m = new Map();
			this.backend.datasets.set(u, m);
		}
		return m;
	}

	private datasetVersionMap(): Map<string, EvalDatasetVersion[]> {
		const u = this.requireUser();
		let m = this.backend.datasetVersions.get(u);
		if (!m) {
			m = new Map();
			this.backend.datasetVersions.set(u, m);
		}
		return m;
	}

	private datasetAliasMap(): Map<string, Map<string, string>> {
		const u = this.requireUser();
		let m = this.backend.datasetAliases.get(u);
		if (!m) {
			m = new Map();
			this.backend.datasetAliases.set(u, m);
		}
		return m;
	}

	private evalRunKey(userId: string, runId: string): string {
		return `${userId}:${runId}`;
	}

	async listEvals(filters: EvalListFilters = {}): Promise<EvalDefinition[]> {
		const rows = Array.from(this.evalMap().values()).map(cloneJson);
		return rows
			.filter((row) => !filters.agentId || row.agentId === filters.agentId)
			.sort((a, b) => b.updatedAt?.localeCompare(a.updatedAt ?? "") ?? 0);
	}

	async getEval(evalId: string): Promise<EvalDefinition | null> {
		const row = this.evalMap().get(evalId);
		return row ? cloneJson(row) : null;
	}

	async putEval(definition: EvalDefinition): Promise<void> {
		const map = this.evalMap();
		const existing = map.get(definition.id);
		const now = this.nextTimestamp();
		const row: EvalDefinition = {
			...cloneJson(definition),
			createdAt: existing?.createdAt ?? definition.createdAt ?? now,
			version: now,
			updatedAt: now,
		};
		map.set(definition.id, row);
		const versions = this.evalVersionMap().get(definition.id) ?? [];
		versions.push({
			definition: cloneJson(row),
			createdAt: now,
			activatedAt: now,
		});
		this.evalVersionMap().set(definition.id, versions);
	}

	async deleteEval(evalId: string): Promise<void> {
		this.evalMap().delete(evalId);
		this.evalVersionMap().delete(evalId);
		this.evalAliasMap().delete(evalId);
	}

	async listEvalVersions(evalId: string): Promise<EvalVersionSummary[]> {
		const aliasesByVersion = new Map<string, string[]>();
		const aliases = this.evalAliasMap().get(evalId);
		if (aliases) {
			for (const [alias, createdAt] of aliases) {
				const list = aliasesByVersion.get(createdAt) ?? [];
				list.push(alias);
				aliasesByVersion.set(createdAt, list);
			}
		}
		return (this.evalVersionMap().get(evalId) ?? [])
			.map((version) => ({
				createdAt: version.createdAt,
				activatedAt: version.activatedAt,
				aliases: (aliasesByVersion.get(version.createdAt) ?? []).sort(),
			}))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async getEvalVersion(
		evalId: string,
		createdAt: string,
	): Promise<EvalDefinition | null> {
		const found = (this.evalVersionMap().get(evalId) ?? []).find(
			(version) => version.createdAt === createdAt,
		);
		return found ? cloneJson(found.definition) : null;
	}

	async activateEvalVersion(evalId: string, createdAt: string): Promise<void> {
		const versions = this.evalVersionMap().get(evalId) ?? [];
		const found = versions.find((version) => version.createdAt === createdAt);
		if (!found)
			throw new Error(`Eval version not found: ${evalId}@${createdAt}`);
		const now = this.nextTimestamp();
		found.activatedAt = now;
		const existing = this.evalMap().get(evalId);
		this.evalMap().set(evalId, {
			...cloneJson(found.definition),
			createdAt: existing?.createdAt ?? found.definition.createdAt ?? createdAt,
			version: createdAt,
			updatedAt: now,
		});
	}

	async resolveEvalVersionAlias(
		evalId: string,
		alias: string,
	): Promise<string | null> {
		return this.evalAliasMap().get(evalId)?.get(alias) ?? null;
	}

	async setEvalVersionAlias(
		evalId: string,
		createdAt: string,
		alias: string,
	): Promise<void> {
		if (!(await this.getEvalVersion(evalId, createdAt))) {
			throw new Error(`Eval version not found: ${evalId}@${createdAt}`);
		}
		let perEval = this.evalAliasMap().get(evalId);
		if (!perEval) {
			perEval = new Map();
			this.evalAliasMap().set(evalId, perEval);
		}
		perEval.set(alias, createdAt);
	}

	async removeEvalVersionAlias(evalId: string, alias: string): Promise<void> {
		this.evalAliasMap().get(evalId)?.delete(alias);
	}

	async listDatasets(
		filters: EvalDatasetListFilters = {},
	): Promise<EvalDataset[]> {
		return Array.from(this.datasetMap().values())
			.map(cloneJson)
			.filter((row) => !filters.agentId || row.agentId === filters.agentId)
			.sort((a, b) => b.updatedAt?.localeCompare(a.updatedAt ?? "") ?? 0);
	}

	async getDataset(datasetId: string): Promise<EvalDataset | null> {
		const row = this.datasetMap().get(datasetId);
		return row ? cloneJson(row) : null;
	}

	async putDataset(dataset: EvalDataset): Promise<void> {
		const map = this.datasetMap();
		const existing = map.get(dataset.id);
		const now = this.nextTimestamp();
		const row: EvalDataset = {
			...cloneJson(dataset),
			createdAt: existing?.createdAt ?? dataset.createdAt ?? now,
			version: now,
			updatedAt: now,
		};
		map.set(dataset.id, row);
		const versions = this.datasetVersionMap().get(dataset.id) ?? [];
		versions.push({
			dataset: cloneJson(row),
			createdAt: now,
			activatedAt: now,
		});
		this.datasetVersionMap().set(dataset.id, versions);
	}

	async deleteDataset(datasetId: string): Promise<void> {
		this.datasetMap().delete(datasetId);
		this.datasetVersionMap().delete(datasetId);
		this.datasetAliasMap().delete(datasetId);
	}

	async listDatasetVersions(
		datasetId: string,
	): Promise<EvalDatasetVersionSummary[]> {
		const aliasesByVersion = new Map<string, string[]>();
		const aliases = this.datasetAliasMap().get(datasetId);
		if (aliases) {
			for (const [alias, createdAt] of aliases) {
				const list = aliasesByVersion.get(createdAt) ?? [];
				list.push(alias);
				aliasesByVersion.set(createdAt, list);
			}
		}
		return (this.datasetVersionMap().get(datasetId) ?? [])
			.map((version) => ({
				createdAt: version.createdAt,
				activatedAt: version.activatedAt,
				aliases: (aliasesByVersion.get(version.createdAt) ?? []).sort(),
			}))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async getDatasetVersion(
		datasetId: string,
		createdAt: string,
	): Promise<EvalDataset | null> {
		const found = (this.datasetVersionMap().get(datasetId) ?? []).find(
			(version) => version.createdAt === createdAt,
		);
		return found ? cloneJson(found.dataset) : null;
	}

	async activateDatasetVersion(
		datasetId: string,
		createdAt: string,
	): Promise<void> {
		const versions = this.datasetVersionMap().get(datasetId) ?? [];
		const found = versions.find((version) => version.createdAt === createdAt);
		if (!found) {
			throw new Error(`Dataset version not found: ${datasetId}@${createdAt}`);
		}
		const now = this.nextTimestamp();
		found.activatedAt = now;
		const existing = this.datasetMap().get(datasetId);
		this.datasetMap().set(datasetId, {
			...cloneJson(found.dataset),
			createdAt: existing?.createdAt ?? found.dataset.createdAt ?? createdAt,
			version: createdAt,
			updatedAt: now,
		});
	}

	async resolveDatasetVersionAlias(
		datasetId: string,
		alias: string,
	): Promise<string | null> {
		return this.datasetAliasMap().get(datasetId)?.get(alias) ?? null;
	}

	async setDatasetVersionAlias(
		datasetId: string,
		createdAt: string,
		alias: string,
	): Promise<void> {
		if (!(await this.getDatasetVersion(datasetId, createdAt))) {
			throw new Error(`Dataset version not found: ${datasetId}@${createdAt}`);
		}
		let perDataset = this.datasetAliasMap().get(datasetId);
		if (!perDataset) {
			perDataset = new Map();
			this.datasetAliasMap().set(datasetId, perDataset);
		}
		perDataset.set(alias, createdAt);
	}

	async removeDatasetVersionAlias(
		datasetId: string,
		alias: string,
	): Promise<void> {
		this.datasetAliasMap().get(datasetId)?.delete(alias);
	}

	async putEvalRun(run: EvalRun): Promise<void> {
		const u = this.requireUser();
		this.backend.evalRuns.set(this.evalRunKey(u, run.id), cloneJson(run));
	}

	async getEvalRun(runId: string): Promise<EvalRun | null> {
		const u = this.requireUser();
		const row = this.backend.evalRuns.get(this.evalRunKey(u, runId));
		return row ? cloneJson(row) : null;
	}

	async listEvalRuns(
		filters: EvalRunListFilters = {},
	): Promise<EvalRunListResult> {
		const u = this.requireUser();
		const prefix = `${u}:`;
		const rows: EvalRun[] = [];
		for (const [key, run] of this.backend.evalRuns) {
			if (key.startsWith(prefix)) rows.push(cloneJson(run));
		}
		return listEvalRunsInProcess(rows, filters);
	}

	private evalLatestScoreKey(userId: string, key: EvalLatestScoreKey): string {
		return [
			userId,
			key.evalId,
			key.evalVersion ?? "",
			key.datasetId,
			key.datasetVersion ?? "",
			key.resolvedAgentVersion ?? "",
		].join(":");
	}

	async getEvalLatestScore(
		key: EvalLatestScoreKey,
	): Promise<EvalLatestScore | null> {
		const u = this.requireUser();
		const row = this.backend.evalLatestScores.get(
			this.evalLatestScoreKey(u, key),
		);
		return row ? cloneJson(row) : null;
	}

	async listEvalLatestScores(
		filters: EvalLatestScoreListFilters = {},
	): Promise<EvalLatestScore[]> {
		const u = this.requireUser();
		const prefix = `${u}:`;
		const rows: EvalLatestScore[] = [];
		for (const [key, score] of this.backend.evalLatestScores) {
			if (!key.startsWith(prefix)) continue;
			if (filters.agentId && score.agentId !== filters.agentId) continue;
			if (filters.evalId && score.evalId !== filters.evalId) continue;
			if (filters.evalVersion && score.evalVersion !== filters.evalVersion)
				continue;
			if (filters.datasetId && score.datasetId !== filters.datasetId) continue;
			if (
				filters.datasetVersion &&
				score.datasetVersion !== filters.datasetVersion
			) {
				continue;
			}
			if (
				filters.resolvedAgentVersion !== undefined &&
				score.resolvedAgentVersion !== filters.resolvedAgentVersion
			) {
				continue;
			}
			if (filters.status && score.status !== filters.status) continue;
			rows.push(cloneJson(score));
		}
		return rows.sort(
			(a, b) =>
				b.updatedAt.localeCompare(a.updatedAt) ||
				b.startedAt.localeCompare(a.startedAt) ||
				b.runId.localeCompare(a.runId),
		);
	}

	async putEvalLatestScore(score: EvalLatestScore): Promise<void> {
		const u = this.requireUser();
		this.backend.evalLatestScores.set(
			this.evalLatestScoreKey(u, score),
			cloneJson(score),
		);
	}

	// ═══ TraceStore ═══
	// Note: spans are shallow-copied on insert and read. Callers must not
	// mutate `attributes`, `events`, or `scores` on a span after it crosses
	// the store boundary. Production backends with serialization (SQLite,
	// Postgres) get this for free; the in-memory backend trades correctness
	// for speed and assumes well-behaved callers.

	async insertSpan(span: Span): Promise<void> {
		this.backend.spans.set(span.spanId, { ...span });
	}

	async insertSpansBatch(spans: Span[]): Promise<void> {
		for (const s of spans) this.backend.spans.set(s.spanId, { ...s });
	}

	async updateSpan(
		spanId: string,
		ownerId: string,
		patch: Partial<Span>,
	): Promise<void> {
		const existing = this.backend.spans.get(spanId);
		if (!existing || existing.ownerId !== ownerId) return; // owner-scoped silent no-op
		this.backend.spans.set(spanId, { ...existing, ...patch, spanId, ownerId });
	}

	async upsertSummary(summary: TraceSummary): Promise<void> {
		this.backend.summaries.set(summary.traceId, { ...summary });
	}

	async getTrace(traceId: string, ownerId: string): Promise<Span[]> {
		const out: Span[] = [];
		for (const s of this.backend.spans.values()) {
			if (s.traceId === traceId && s.ownerId === ownerId) out.push({ ...s });
		}
		// Order by startedAt then spanId so callers get deterministic tree assembly.
		return out.sort(
			(a, b) =>
				a.startedAt.localeCompare(b.startedAt) ||
				a.spanId.localeCompare(b.spanId),
		);
	}

	async getSummary(
		traceId: string,
		ownerId: string,
	): Promise<TraceSummary | null> {
		const s = this.backend.summaries.get(traceId);
		if (!s || s.ownerId !== ownerId) return null;
		return { ...s };
	}

	async listTraces(
		filter: TraceFilter,
	): Promise<{ rows: TraceSummary[]; cursor?: string }> {
		const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
		const all: TraceSummary[] = [];
		for (const s of this.backend.summaries.values()) {
			if (s.ownerId !== filter.ownerId) continue;
			if (filter.agentId && s.agentId !== filter.agentId) continue;
			if (filter.status && s.status !== filter.status) continue;
			if (filter.startedAfter && s.startedAt < filter.startedAfter) continue;
			if (filter.startedBefore && s.startedAt > filter.startedBefore) continue;
			all.push({ ...s });
		}
		all.sort(
			(a, b) =>
				b.startedAt.localeCompare(a.startedAt) ||
				b.traceId.localeCompare(a.traceId),
		);

		let startIdx = 0;
		if (filter.cursor) {
			const decoded = decodeTraceCursor(filter.cursor);
			if (decoded) {
				startIdx = all.findIndex(
					(r) =>
						r.startedAt < decoded.startedAt ||
						(r.startedAt === decoded.startedAt && r.traceId < decoded.traceId),
				);
				if (startIdx === -1) startIdx = all.length;
			}
		}

		const rows = all.slice(startIdx, startIdx + limit);
		const cursor =
			rows.length === limit && startIdx + limit < all.length
				? encodeTraceCursor({
						startedAt: rows[rows.length - 1].startedAt,
						traceId: rows[rows.length - 1].traceId,
					})
				: undefined;
		return { rows, cursor };
	}

	async deleteTrace(traceId: string, ownerId: string): Promise<void> {
		const summary = this.backend.summaries.get(traceId);
		if (summary && summary.ownerId !== ownerId) return;
		this.backend.summaries.delete(traceId);
		// Spans are filtered independently by ownerId — a trace can have spans
		// without a summary if it never finalized, and we don't want to leak
		// across owners even if the summary disagreed.
		for (const [spanId, span] of this.backend.spans) {
			if (span.traceId === traceId && span.ownerId === ownerId) {
				this.backend.spans.delete(spanId);
			}
		}
	}

	async deleteOlderThan(ownerId: string, before: Date): Promise<number> {
		const beforeIso = before.toISOString();
		const traceIdsToDelete: string[] = [];
		for (const s of this.backend.summaries.values()) {
			if (s.ownerId === ownerId && s.startedAt < beforeIso)
				traceIdsToDelete.push(s.traceId);
		}
		for (const tid of traceIdsToDelete) {
			this.backend.summaries.delete(tid);
			for (const [spanId, span] of this.backend.spans) {
				if (span.traceId === tid && span.ownerId === ownerId) {
					this.backend.spans.delete(spanId);
				}
			}
		}
		return traceIdsToDelete.length;
	}

	// ═══ WebhookDeliveryStore ═══

	async insert(
		delivery: Omit<WebhookDelivery, "attempts" | "status" | "createdAt"> & {
			payload: Record<string, unknown>;
		},
	): Promise<string> {
		this.requireUser();
		const now = new Date().toISOString();
		const row: WebhookDelivery = {
			id: delivery.id,
			runId: delivery.runId,
			callbackUrl: delivery.callbackUrl,
			secretName: delivery.secretName,
			payload: delivery.payload,
			attempts: 0,
			status: "pending",
			createdAt: now,
		};
		this.backend.webhookDeliveries.set(delivery.id, row);
		return delivery.id;
	}

	async updateStatus(
		id: string,
		status: WebhookDelivery["status"],
		lastError?: string,
	): Promise<void> {
		const row = this.backend.webhookDeliveries.get(id);
		if (!row) return;
		row.status = status;
		if (lastError !== undefined) row.lastError = lastError;
	}

	async incrementAttempt(id: string, lastError?: string): Promise<void> {
		const row = this.backend.webhookDeliveries.get(id);
		if (!row) return;
		row.attempts += 1;
		row.lastAttemptAt = new Date().toISOString();
		if (lastError !== undefined) row.lastError = lastError;
	}

	async listPending(filter?: { olderThan?: string; limit?: number }): Promise<
		WebhookDelivery[]
	> {
		const rows: WebhookDelivery[] = [];
		for (const r of this.backend.webhookDeliveries.values()) {
			if (r.status !== "pending") continue;
			if (filter?.olderThan && r.createdAt >= filter.olderThan) continue;
			rows.push({ ...r });
		}
		rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		return filter?.limit ? rows.slice(0, filter.limit) : rows;
	}
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		keyPrefix: row.keyPrefix,
		createdAt: row.createdAt,
		lastUsedAt: row.lastUsedAt,
		revokedAt: row.revokedAt,
	};
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function encodeTraceCursor(c: {
	startedAt: string;
	traceId: string;
}): string {
	return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeTraceCursor(
	s: string,
): { startedAt: string; traceId: string } | null {
	try {
		return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}
