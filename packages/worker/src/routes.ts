import { randomBytes } from "node:crypto";
import {
	type EvalCaseResult,
	type EvalCriterion,
	type EvalCriterionResult,
	type EvalDataset,
	type EvalDefinition,
	type EvalRun,
	type EvalRunListFilters,
	InMemoryRunRegistry,
	type InvokeResult,
	MemoryStore,
	type MultiplexedEvent,
	NamespaceGrantError,
	type NamespaceGrantPolicy,
	OutboundUrlPolicyError,
	type OutboundUrlPolicyOptions,
	type Reply,
	type ResourceProvider,
	type Run,
	type RunListFilters,
	type RunRegistry,
	type Runner,
	type SessionSnapshot,
	SpanEmitter,
	type TraceFilter,
	type UnifiedStore,
	type WebhookDispatcher,
	assertOutboundUrlAllowed,
	createEvalJudgeAgent,
	createRunner,
	createWebhookDispatcher,
	criterionGateMinimum,
	criterionRubric,
	evalPassPolicyMinimum,
	generateId,
	generateSessionId,
	latestScoreFromEvalRun,
	normalizeCriterionWeight,
	parseJudgeOutputText,
	scoreCriterionJudgeOutput,
	summarizeEvalRun,
} from "@agntz/core";
import {
	execute,
	parseManifest,
	selectManifestBlock,
	validateManifestFull,
} from "@agntz/manifest";
import type { AgentManifest, ManifestSelection } from "@agntz/manifest";
import {
	MemrezCorrectionError,
	MemrezEntryNotFoundError,
	MemrezScopeError,
} from "@agntz/memrez";
import type { CurateReport, MemoryEntry, Memrez } from "@agntz/memrez";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { stringify as stringifyYAML } from "yaml";
import { createExecutionContext } from "./bridge.js";
import {
	getCachedBody,
	getUserId,
	internalOnlyAuth,
	workerAuth,
} from "./middleware/auth.js";
import { rateLimit } from "./rate-limit.js";
import { wrapWithSkillRedaction } from "./session-redact.js";
import {
	getSystemAgent,
	isSystemAgentId,
	listSystemAgents,
	loadSystemAgent,
} from "./system-agents.js";
import { LOCAL_TOOLS } from "./tools/registry.js";
import { InMemoryTraceRegistry } from "./trace-registry.js";
import { buildValidationContext } from "./validation.js";

/**
 * Hard cap for /build-agent input. The agent-builder pipeline feeds the
 * description into multiple LLM prompts, so a runaway value costs real tokens.
 * 4 KB is plenty for natural-language descriptions and small "current
 * manifest + requested changes" payloads.
 */
const BUILD_AGENT_MAX_DESCRIPTION_LENGTH = 4096;
const EDIT_AGENT_MAX_DESCRIPTION_LENGTH = 4096;
const EDIT_AGENT_MAX_MANIFEST_LENGTH = 64_000;

export interface WorkerAPIOptions {
	store: UnifiedStore;
	internalSecret: string;
	/**
	 * Process-wide RunRegistry used by the /runs/* endpoints. If omitted, the
	 * worker constructs one with persistRun routed to the user-scoped store
	 * and a 5-minute grace period before evicting terminal runs from memory.
	 *
	 * Exposed for tests that need to inspect registry state (e.g. assert
	 * eviction) and for advanced deployments that want a shared registry
	 * across multiple Hono apps.
	 */
	runRegistry?: RunRegistry;
	/**
	 * How long terminal Runs stay resident in memory before eviction. Only
	 * honoured when the worker constructs its own registry (i.e. when
	 * `runRegistry` is not supplied). Default 300_000 (5 min).
	 */
	runGracePeriodMs?: number;
	/**
	 * Test-only override: replaces `resolveRunnerAndManifest` so tests can
	 * inject a runner with a stub model provider plus an inline manifest.
	 * Production code does NOT supply this — the route default builds a
	 * user-scoped runner from `store` and reads the manifest from the user's
	 * agent store. When set, the override is invoked for every request that
	 * reaches `/run`, `/run/stream`, or `/runs`.
	 */
	resolveRunnerAndManifest?: (
		store: UnifiedStore,
		userId: string,
		agentId: string,
	) => Promise<{ runner: Runner; manifest: AgentManifest }>;
	/** Resource providers keyed by resource kind. Production wires memrez here. */
	resources?: Record<string, ResourceProvider>;
	/**
	 * Memrez instance backing the "memory" resource provider. Enables the
	 * deterministic /memory/* read, correct, and curate endpoints — the
	 * observability surface over what agents see through their tools.
	 */
	memrez?: Memrez;
	/** Optional guardrail for runtime namespace grants. */
	namespacePolicy?: NamespaceGrantPolicy;
	/** Override outbound URL policy for tests or trusted local deployments. */
	outboundUrlPolicy?: OutboundUrlPolicyOptions;
}

/**
 * Create the worker API. Auth middleware resolves a per-request userId,
 * then handlers build a user-scoped Runner and execute the agent.
 *
 * System agents (agentId = "system:<name>") are loaded from YAML in the repo
 * and executed via an ephemeral in-memory runner. They don't touch the user's
 * store — they're application-level features that ship with the code.
 */
export function createWorkerAPI(opts: WorkerAPIOptions): Hono {
	const { store, internalSecret } = opts;
	const resourceProviders = opts.resources ?? {};
	const app = new Hono();

	// Test override for the runner+manifest resolver, falling back to the
	// production lookup against the user store + the system-agent registry.
	const resolveRunnerAndManifestImpl =
		opts.resolveRunnerAndManifest ??
		((store: UnifiedStore, userId: string, agentId: string) =>
			resolveRunnerAndManifest(
				store,
				userId,
				agentId,
				opts.outboundUrlPolicy,
				resourceProviders,
				opts.namespacePolicy,
			));

	// Process-wide trace registry — one per worker instance, shared across requests.
	// Receives span events from per-request SpanEmitters and batches them to the store.
	const traceRegistry = new InMemoryTraceRegistry({ store });

	// Process-wide registry for /runs/*. Runs from all users share this
	// instance; routes filter on ownership before exposing anything.
	const runRegistry: RunRegistry =
		opts.runRegistry ??
		new InMemoryRunRegistry({
			gracePeriodMs: opts.runGracePeriodMs,
			persistRun: async (run) => {
				if (!run.userId) return;
				try {
					await store.forUser(run.userId).putRun(run);
				} catch (err) {
					console.error(
						`[run-store] persist failed run=${run.id} user=${run.userId}: ${(err as Error).message}`,
					);
				}
			},
		});
	const evalRunControllers = new Map<string, AbortController>();

	app.use("*", cors());

	app.get("/health", (c) => {
		return c.json({ status: "ok", service: "agntz-worker" });
	});

	// /build-agent is intentionally UNAUTHENTICATED so the public CLI can run
	// the agent-builder without an account. Per-IP rate limit caps abuse; the
	// route uses an ephemeral runner (no user-scoped data touched).
	app.use("/build-agent", rateLimit({ windowMs: 60 * 60_000, max: 10 }));
	app.post("/build-agent", async (c) => {
		const start = Date.now();
		try {
			const body = (await c.req.json().catch(() => ({}))) as {
				description?: string;
				currentManifest?: string;
			};
			const { description, currentManifest } = body;

			if (!description || typeof description !== "string") {
				return c.json(
					{ error: "Missing required field: description (string)" },
					400,
				);
			}
			if (description.length > BUILD_AGENT_MAX_DESCRIPTION_LENGTH) {
				return c.json(
					{
						error: `description exceeds max length of ${BUILD_AGENT_MAX_DESCRIPTION_LENGTH} characters`,
					},
					413,
				);
			}
			if (currentManifest != null && typeof currentManifest !== "string") {
				return c.json(
					{ error: "currentManifest must be a string when provided" },
					400,
				);
			}
			if (
				typeof currentManifest === "string" &&
				currentManifest.length > BUILD_AGENT_MAX_DESCRIPTION_LENGTH * 4
			) {
				return c.json({ error: "currentManifest exceeds max length" }, 413);
			}

			// Match the in-app builder route's input shape: when currentManifest is
			// provided we treat it as an iterative refinement.
			const fullDescription = currentManifest
				? `Current manifest:\n\`\`\`yaml\n${currentManifest}\n\`\`\`\n\nRequested changes: ${description}`
				: description;

			const manifest = await loadSystemAgent("system:agent-builder");
			const ephemeralStore = new MemoryStore();
			const ephemeralRunner = createRunner({
				store: ephemeralStore,
				tools: [...LOCAL_TOOLS],
				resources: resourceProviders,
				namespacePolicy: opts.namespacePolicy,
				defaults: {
					model: {
						provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
						name: process.env.DEFAULT_MODEL_NAME ?? "gpt-5.4-mini",
					},
				},
				outboundUrlPolicy: opts.outboundUrlPolicy,
			});
			const sessionId = generateSessionId();
			const localRegistry = new InMemoryRunRegistry();
			const spanEmitter = new SpanEmitter({
				traceSink: (event) => {
					if (event.type === "span-start") traceRegistry.spanStart(event.span);
					else if (event.type === "span-end")
						traceRegistry.spanEnd(event.spanId, event.patch);
					else if (event.type === "trace-done")
						traceRegistry.traceDone(
							event.summary.traceId,
							event.summary.ownerId,
							event.summary,
						);
				},
				recordIO: false,
			});
			const ctx = createExecutionContext(ephemeralRunner, {
				runRegistry: localRegistry,
				spanEmitter,
				ownerId: "public:build-agent",
				userId: "public:build-agent",
				sessionId,
			});

			const result = await execute(
				manifest,
				{ description: fullDescription },
				ctx,
			);
			const output = (result.output ?? {}) as Record<string, unknown>;

			console.log(
				`[build-agent] ok ${Date.now() - start}ms descLen=${description.length}`,
			);

			return c.json({
				yaml: output.yaml ?? null,
				explanation: output.explanation ?? null,
				validation: output.validation ?? null,
			});
		} catch (error) {
			console.error(
				`[build-agent] failed ${Date.now() - start}ms: ${errorMessage(error)}`,
			);
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.use("/edit-agent", rateLimit({ windowMs: 60 * 60_000, max: 10 }));
	app.post("/edit-agent", async (c) => {
		const start = Date.now();
		try {
			const body = (await c.req.json().catch(() => ({}))) as {
				currentManifest?: string;
				changeDescription?: string;
				selection?: unknown;
			};
			const { currentManifest, changeDescription } = body;

			if (!currentManifest || typeof currentManifest !== "string") {
				return c.json(
					{ error: "Missing required field: currentManifest (string)" },
					400,
				);
			}
			if (!changeDescription || typeof changeDescription !== "string") {
				return c.json(
					{ error: "Missing required field: changeDescription (string)" },
					400,
				);
			}
			if (currentManifest.length > EDIT_AGENT_MAX_MANIFEST_LENGTH) {
				return c.json({ error: "currentManifest exceeds max length" }, 413);
			}
			if (changeDescription.length > EDIT_AGENT_MAX_DESCRIPTION_LENGTH) {
				return c.json(
					{
						error: `changeDescription exceeds max length of ${EDIT_AGENT_MAX_DESCRIPTION_LENGTH} characters`,
					},
					413,
				);
			}

			const selection = normalizeManifestSelection(body.selection);
			const selectedContext = buildSelectedContext(currentManifest, selection);
			const manifest = await loadSystemAgent("system:agent-editor");
			const ephemeralStore = new MemoryStore();
			const ephemeralRunner = createRunner({
				store: ephemeralStore,
				tools: [...LOCAL_TOOLS],
				resources: resourceProviders,
				namespacePolicy: opts.namespacePolicy,
				defaults: {
					model: {
						provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
						name: process.env.DEFAULT_MODEL_NAME ?? "gpt-5.4-mini",
					},
				},
				outboundUrlPolicy: opts.outboundUrlPolicy,
			});
			const sessionId = generateSessionId();
			const localRegistry = new InMemoryRunRegistry();
			const spanEmitter = new SpanEmitter({
				traceSink: (event) => {
					if (event.type === "span-start") traceRegistry.spanStart(event.span);
					else if (event.type === "span-end")
						traceRegistry.spanEnd(event.spanId, event.patch);
					else if (event.type === "trace-done")
						traceRegistry.traceDone(
							event.summary.traceId,
							event.summary.ownerId,
							event.summary,
						);
				},
				recordIO: false,
			});
			const ctx = createExecutionContext(ephemeralRunner, {
				runRegistry: localRegistry,
				spanEmitter,
				ownerId: "public:edit-agent",
				userId: "public:edit-agent",
				sessionId,
			});

			const result = await execute(
				manifest,
				{
					currentManifest,
					selectedContext,
					changeDescription,
				},
				ctx,
			);
			const output = (result.output ?? {}) as Record<string, unknown>;

			console.log(
				`[edit-agent] ok ${Date.now() - start}ms yamlLen=${currentManifest.length} descLen=${changeDescription.length}`,
			);

			return c.json({
				yaml: output.yaml ?? null,
				explanation: output.explanation ?? null,
				validation: output.validation ?? null,
			});
		} catch (error) {
			console.error(
				`[edit-agent] failed ${Date.now() - start}ms: ${errorMessage(error)}`,
			);
			return c.json(
				{ error: errorMessage(error) },
				isBadRequest(error) ? 400 : 500,
			);
		}
	});

	app.use("/run", workerAuth({ store, internalSecret }));
	app.use("/run/stream", workerAuth({ store, internalSecret }));
	app.use("/run/block", workerAuth({ store, internalSecret }));
	app.use("/run/block/stream", workerAuth({ store, internalSecret }));
	app.use("/runs", workerAuth({ store, internalSecret }));
	app.use("/runs/*", workerAuth({ store, internalSecret }));
	app.use("/evals", workerAuth({ store, internalSecret }));
	app.use("/evals/*", workerAuth({ store, internalSecret }));
	app.use("/datasets", workerAuth({ store, internalSecret }));
	app.use("/datasets/*", workerAuth({ store, internalSecret }));
	app.use("/eval-runs", workerAuth({ store, internalSecret }));
	app.use("/eval-runs/*", workerAuth({ store, internalSecret }));
	app.use("/eval-scores", workerAuth({ store, internalSecret }));
	app.use("/eval-scores/*", workerAuth({ store, internalSecret }));
	app.use("/traces", workerAuth({ store, internalSecret }));
	app.use("/traces/*", workerAuth({ store, internalSecret }));
	app.use("/validate", workerAuth({ store, internalSecret }));
	app.use("/agents", workerAuth({ store, internalSecret }));
	app.use("/agents/*", workerAuth({ store, internalSecret }));
	app.use("/sessions/import", workerAuth({ store, internalSecret }));
	app.use("/memory/import", workerAuth({ store, internalSecret }));
	app.use("/webhook-secrets", workerAuth({ store, internalSecret }));
	app.use("/webhook-secrets/*", workerAuth({ store, internalSecret }));
	app.use("/system/agents", internalOnlyAuth({ internalSecret }));
	app.use("/system/agents/*", internalOnlyAuth({ internalSecret }));

	app.post("/validate", async (c) => {
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				manifest?: string;
				strict?: boolean;
				mcpTimeoutMs?: number;
			};
			const { manifest, strict, mcpTimeoutMs } = body;

			if (!manifest || typeof manifest !== "string") {
				return c.json(
					{ error: "Missing required field: manifest (string)" },
					400,
				);
			}

			const scoped = store.forUser(userId);
			const ctx = buildValidationContext(scoped, {
				strict,
				mcpTimeoutMs,
				outboundUrlPolicy: opts.outboundUrlPolicy,
			});
			const result = await validateManifestFull(manifest, ctx);
			return c.json(result);
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.get("/agents", async (c) => {
		try {
			const userId = getUserId(c);
			const agents = await store.forUser(userId).listAgents();
			return c.json(agents);
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.get("/agents/:id", async (c) => {
		try {
			const userId = getUserId(c);
			const id = decodeURIComponent(c.req.param("id"));
			if (id.includes("@")) {
				return c.json(
					{ error: "Agent CRUD ids must not include a version suffix" },
					400,
				);
			}
			const agent = await store.forUser(userId).getAgent(id);
			if (!agent) return c.json({ error: `Agent "${id}" not found` }, 404);
			return c.json(agent);
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.post("/agents/import", async (c) => {
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				agents?: unknown;
				onConflict?: unknown;
				dryRun?: unknown;
				strict?: unknown;
			};
			const items = normalizeAgentImportItems(body.agents);
			const onConflict = normalizeAgentConflict(body.onConflict);
			const dryRun = body.dryRun === true;
			const scoped = store.forUser(userId);
			const incomingIds = items.map((item) => item.id);
			const validationCtx = buildValidationContext(scoped, {
				strict: body.strict !== false,
				outboundUrlPolicy: opts.outboundUrlPolicy,
				extraAgentIds: incomingIds,
			});

			const validationResults = await Promise.all(
				items.map((item) => validateManifestFull(item.manifest, validationCtx)),
			);
			const invalid = validationResults
				.map((validation, index) => ({ validation, item: items[index] }))
				.filter(({ validation }) => validation.errors.length > 0);
			if (invalid.length > 0) {
				return c.json(
					{
						error: "Invalid manifest",
						results: invalid.map(({ item, validation }) => ({
							id: item.id,
							sourcePath: item.sourcePath,
							errors: validation.errors,
							warnings: validation.warnings,
						})),
					},
					400,
				);
			}

			const results: AgentImportResult[] = [];
			for (const [index, item] of items.entries()) {
				const existing = await scoped.getAgent(item.id);
				if (existing && onConflict === "fail") {
					return c.json(
						{ error: `Agent "${item.id}" already exists`, id: item.id },
						409,
					);
				}
				const action = existing
					? onConflict === "skip"
						? "skip"
						: "version"
					: "create";
				if (!dryRun && action !== "skip") {
					await scoped.putAgent({
						id: item.id,
						name: item.manifestName ?? item.id,
						description: item.description,
						systemPrompt: "",
						model: defaultModelConfig(),
						metadata: {
							manifest: item.manifest,
							sourcePath: item.sourcePath,
							publishedFrom: "cli",
							publishedAt: new Date().toISOString(),
						},
					});
				}
				results.push({
					id: item.id,
					sourcePath: item.sourcePath,
					action,
					warnings: validationResults[index].warnings,
				});
			}

			return c.json({
				dryRun,
				results,
				counts: countActions(results),
			});
		} catch (error) {
			return c.json(
				{ error: errorMessage(error) },
				isBadRequest(error) ? 400 : 500,
			);
		}
	});

	app.post("/sessions/import", async (c) => {
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				sessions?: unknown;
				onConflict?: unknown;
				dryRun?: unknown;
			};
			const sessions = normalizeSessionSnapshots(body.sessions);
			const onConflict = normalizeSnapshotConflict(body.onConflict);
			const dryRun = body.dryRun === true;
			const scoped = store.forUser(userId);
			if (!scoped.putSessionSnapshot) {
				return c.json(
					{
						error:
							"The configured store does not support session snapshot imports.",
					},
					501,
				);
			}
			const existing = new Map(
				(await scoped.listSessions()).map((session) => [
					session.sessionId,
					session,
				]),
			);
			const results: SessionImportResult[] = [];

			for (const snapshot of sessions) {
				const current = existing.get(snapshot.sessionId);
				if (current) {
					if (onConflict === "fail") {
						return c.json(
							{
								error: `Session "${snapshot.sessionId}" already exists`,
								sessionId: snapshot.sessionId,
							},
							409,
						);
					}
					results.push({
						sessionId: snapshot.sessionId,
						agentId: snapshot.agentId,
						action: "skip",
						messageCount: snapshot.messages.length,
					});
					continue;
				}
				if (!dryRun) await scoped.putSessionSnapshot(snapshot);
				results.push({
					sessionId: snapshot.sessionId,
					agentId: snapshot.agentId,
					action: "create",
					messageCount: snapshot.messages.length,
				});
			}

			return c.json({ dryRun, results, counts: countActions(results) });
		} catch (error) {
			return c.json(
				{ error: errorMessage(error) },
				isBadRequest(error) ? 400 : 500,
			);
		}
	});

	app.post("/memory/import", async (c) => {
		try {
			const memrez = opts.memrez;
			if (!memrez) return memoryNotConfigured(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				entries?: unknown;
				dryRun?: unknown;
			};
			const entries = normalizeMemoryEntries(body.entries);
			const dryRun = body.dryRun === true;
			const results: MemoryImportResult[] = [];

			for (const entry of entries) {
				const existing = await memrez.store.getEntry(entry.id);
				if (!dryRun) await memrez.store.putEntry(entry);
				results.push({
					id: entry.id,
					scope: entry.scope,
					action: existing ? "update" : "create",
					status: entry.status,
				});
			}

			return c.json({ dryRun, results, counts: countActions(results) });
		} catch (error) {
			return c.json(
				{ error: errorMessage(error) },
				isBadRequest(error) ? 400 : 500,
			);
		}
	});

	// Memory observability endpoints are app→worker only for now. The import
	// route above is explicitly user-scoped through workerAuth for CLI migration.
	app.use("/memory", internalOnlyAuth({ internalSecret }));
	app.use("/memory/*", internalOnlyAuth({ internalSecret }));

	app.get("/system/agents", async (c) => {
		const agents = await listSystemAgents();
		return c.json(
			agents.map((a) => ({
				id: a.id,
				name: a.name,
				displayName: a.displayName,
				description: a.description,
			})),
		);
	});

	app.get("/system/agents/:id", async (c) => {
		const id = decodeURIComponent(c.req.param("id"));
		const info = await getSystemAgent(id);
		if (!info) {
			return c.json({ error: `System agent not found: ${id}` }, 404);
		}
		return c.json({
			id: info.id,
			name: info.name,
			displayName: info.displayName,
			description: info.description,
			yaml: info.yaml,
			manifest: info.manifest,
		});
	});

	// ── Memory observability ────────────────────────────────────────────────
	// Deterministic read surface over the memrez instance agents use. Takes
	// grants and expands them through the same normalizeGrants→visibleScopes
	// pipeline as agent tools, so "view what the agent sees" holds by
	// construction.

	app.get("/memory/topics", async (c) => {
		const memrez = opts.memrez;
		if (!memrez) return memoryNotConfigured(c);
		try {
			const grants = parseGrantsParam(c.req.queries("grants"));
			const scan = await memrez.scan(grants);
			return c.json(scan);
		} catch (error) {
			return memoryErrorResponse(c, error);
		}
	});

	app.get("/memory/entries", async (c) => {
		const memrez = opts.memrez;
		if (!memrez) return memoryNotConfigured(c);
		try {
			const grants = parseGrantsParam(c.req.queries("grants"));
			const topics = parseListParam(c.req.queries("topics"));
			const includeSuperseded = isTruthyParam(c.req.query("includeSuperseded"));
			const limit = clampInt(c.req.query("limit"), 200, 1, 1000);
			const offset = clampInt(c.req.query("offset"), 0, 0);

			const entries = await memrez.list(grants, {
				topics: topics.length > 0 ? topics : undefined,
				includeSuperseded,
			});
			return c.json({
				entries: entries.slice(offset, offset + limit),
				total: entries.length,
				limit,
				offset,
			});
		} catch (error) {
			return memoryErrorResponse(c, error);
		}
	});

	app.post("/memory/entries/:id/correct", async (c) => {
		const memrez = opts.memrez;
		if (!memrez) return memoryNotConfigured(c);
		try {
			const id = decodeURIComponent(c.req.param("id"));
			const body = (await c.req.json().catch(() => ({}))) as {
				grants?: unknown;
				content?: unknown;
			};
			if (!Array.isArray(body.grants) || body.grants.length === 0) {
				return c.json(
					{ error: "Missing required field: grants (string array)" },
					400,
				);
			}
			if (typeof body.content !== "string" || body.content.trim() === "") {
				return c.json(
					{ error: "Missing required field: content (non-empty string)" },
					400,
				);
			}
			const result = await memrez.correct(
				body.grants as string[],
				id,
				body.content,
			);
			return c.json(result);
		} catch (error) {
			return memoryErrorResponse(c, error);
		}
	});

	app.post("/memory/curate", async (c) => {
		const memrez = opts.memrez;
		if (!memrez) return memoryNotConfigured(c);
		try {
			const body = (await c.req.json().catch(() => ({}))) as {
				grants?: unknown;
				topics?: unknown;
			};
			if (body.grants !== undefined) {
				if (!Array.isArray(body.grants) || body.grants.length === 0) {
					return c.json(
						{ error: "grants must be a non-empty string array" },
						400,
					);
				}
				const report = await memrez.curate(body.grants as string[], {
					topics: Array.isArray(body.topics)
						? (body.topics as string[])
						: undefined,
				});
				return c.json({ curateEnabled: true, report });
			}
			return c.json(await runCurationSweep(memrez));
		} catch (error) {
			return memoryErrorResponse(c, error);
		}
	});

	app.post("/run", async (c) => {
		const start = Date.now();
		let agentIdForLog: string | undefined;
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				agentId?: string;
				input?: unknown;
				sessionId?: string;
				context?: string[];
			};
			const { agentId, input } = body;
			agentIdForLog = agentId;

			if (!agentId) {
				return c.json({ error: "Missing required field: agentId" }, 400);
			}

			// Always work with a concrete sessionId. If the caller didn't provide
			// one we mint it here so the response carries the id even when the
			// manifest doesn't surface it back. The runner will also do this
			// independently for safety, but pre-allocating keeps the wire response
			// authoritative.
			const sessionId = body.sessionId ?? generateSessionId();

			console.log(
				`[run] start agent=${agentId} user=${userId} session=${sessionId} ` +
					`inputKeys=${input && typeof input === "object" ? Object.keys(input).join(",") : typeof input}`,
			);

			const { runner, manifest } = await resolveRunnerAndManifestImpl(
				store,
				userId,
				agentId,
			);
			const runRegistry = new InMemoryRunRegistry();
			const spanEmitter = new SpanEmitter({
				traceSink: (event) => {
					if (event.type === "span-start") traceRegistry.spanStart(event.span);
					else if (event.type === "span-end")
						traceRegistry.spanEnd(event.spanId, event.patch);
					else if (event.type === "trace-done")
						traceRegistry.traceDone(
							event.summary.traceId,
							event.summary.ownerId,
							event.summary,
						);
				},
				recordIO: false,
			});
			// Aggregate replies across all LLM invokes inside the manifest so the
			// response can surface them. The runner persists each reply to the
			// session at the moment of the call; this is purely for the HTTP body.
			const replyCollector: Reply[] = [];
			const ctx = createExecutionContext(runner, {
				runRegistry,
				spanEmitter,
				ownerId: userId,
				userId,
				sessionId,
				context: body.context,
				replyCollector,
			});
			const result = await execute(manifest, input ?? "", ctx);

			console.log(
				`[run] done agent=${agentId} ${Date.now() - start}ms kind=${manifest.kind} ` +
					`outputKeys=${result.output && typeof result.output === "object" ? Object.keys(result.output).join(",") : typeof result.output} ` +
					`replies=${replyCollector.length}`,
			);

			const responseBody: Record<string, unknown> = {
				output: result.output,
				state: result.state,
				sessionId,
			};
			if (replyCollector.length > 0) responseBody.replies = replyCollector;
			return c.json(responseBody);
		} catch (error) {
			const status = isNotFound(error) ? 404 : 500;
			console.error(
				`[run] failed agent=${agentIdForLog} ${Date.now() - start}ms: ${errorMessage(error)}`,
			);
			return c.json({ error: errorMessage(error) }, status);
		}
	});

	app.post("/run/block", async (c) => {
		const start = Date.now();
		let agentIdForLog: string | undefined;
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				agentId?: string;
				input?: unknown;
				sessionId?: string;
				context?: string[];
				selection?: unknown;
			};
			const { agentId, input } = body;
			agentIdForLog = agentId;

			if (!agentId) {
				return c.json({ error: "Missing required field: agentId" }, 400);
			}

			const selection = normalizeManifestSelection(body.selection);
			const sessionId = body.sessionId ?? generateSessionId();

			const { runner, manifest } = await resolveRunnerAndManifestImpl(
				store,
				userId,
				agentId,
			);
			const selectedManifest = await resolveSelectedBlockManifest(
				manifest,
				selection,
				runner,
			);
			const runRegistry = new InMemoryRunRegistry();
			const spanEmitter = new SpanEmitter({
				traceSink: (event) => {
					if (event.type === "span-start") traceRegistry.spanStart(event.span);
					else if (event.type === "span-end")
						traceRegistry.spanEnd(event.spanId, event.patch);
					else if (event.type === "trace-done")
						traceRegistry.traceDone(
							event.summary.traceId,
							event.summary.ownerId,
							event.summary,
						);
				},
				recordIO: false,
			});
			const replyCollector: Reply[] = [];
			const ctx = createExecutionContext(runner, {
				runRegistry,
				spanEmitter,
				ownerId: userId,
				userId,
				sessionId,
				context: body.context,
				replyCollector,
			});
			const result = await execute(selectedManifest, input ?? "", ctx);

			console.log(
				`[run:block] done agent=${agentId} block=${selectedManifest.id} ${Date.now() - start}ms kind=${selectedManifest.kind} ` +
					`outputKeys=${result.output && typeof result.output === "object" ? Object.keys(result.output).join(",") : typeof result.output} ` +
					`replies=${replyCollector.length}`,
			);

			const responseBody: Record<string, unknown> = {
				output: result.output,
				state: result.state,
				sessionId,
				target: "block",
				blockId: selectedManifest.id,
				blockKind: selectedManifest.kind,
			};
			if (replyCollector.length > 0) responseBody.replies = replyCollector;
			return c.json(responseBody);
		} catch (error) {
			const status = isBadRequest(error) ? 400 : isNotFound(error) ? 404 : 500;
			console.error(
				`[run:block] failed agent=${agentIdForLog} ${Date.now() - start}ms: ${errorMessage(error)}`,
			);
			return c.json({ error: errorMessage(error) }, status);
		}
	});

	app.post("/run/stream", async (c) => {
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				agentId?: string;
				input?: unknown;
				sessionId?: string;
				context?: string[];
			};
			const { agentId, input } = body;

			if (!agentId) {
				return c.json({ error: "Missing required field: agentId" }, 400);
			}

			// Pre-allocate sessionId and traceId so the run-start SSE frame is
			// authoritative — clients use the traceId to subscribe to the live
			// trace stream before the first span has fired.
			const sessionId = body.sessionId ?? generateSessionId();
			const traceId = `tr_${randomBytes(8).toString("hex")}`;

			const { runner, manifest } = await resolveRunnerAndManifestImpl(
				store,
				userId,
				agentId,
			);
			// Reserve the trace as in-progress so /traces/:id/stream subscribers
			// attaching the moment after run-start don't race the first spanStart.
			traceRegistry.register(traceId, userId);
			const baseRegistry = new InMemoryRunRegistry();
			const spanEmitter = new SpanEmitter({
				traceSink: (event) => {
					if (event.type === "span-start") traceRegistry.spanStart(event.span);
					else if (event.type === "span-end")
						traceRegistry.spanEnd(event.spanId, event.patch);
					else if (event.type === "trace-done")
						traceRegistry.traceDone(
							event.summary.traceId,
							event.summary.ownerId,
							event.summary,
						);
				},
				recordIO: false,
				traceId,
			});
			// Replies are aggregated into a per-request collector AND, when
			// `agent.reply` is set, broadcast as `reply` multiplexed events on the
			// per-request registry. We tap the registry's `emit` so reply events
			// flow onto the SSE wire as they happen; the same replies are still
			// included on the final `run-complete` payload for batch readers.
			const replyCollector: Reply[] = [];
			type QueuedReply = {
				runId: string;
				sessionId: string;
				text: string;
				ts: string;
				seq: number;
			};
			const pendingReplies: QueuedReply[] = [];
			let replyResolver: (() => void) | null = null;
			let runComplete = false;

			// Wrap the per-request registry's `emit` so we can intercept reply
			// events without polling for the rootId. The wrapper preserves all
			// other registry behavior (replay buffers, subscribers, seq stamping,
			// terminal eviction) — we only fork on `reply`. We read the canonical
			// seq from the seq counter map BEFORE stamping happens; since emit()
			// is the only writer and we wrap it, the order matches.
			const seqForChannel = new Map<string, number>();
			const runRegistry: RunRegistry = new Proxy(baseRegistry, {
				get(target, prop, receiver) {
					if (prop === "emit") {
						return (
							rootId: string,
							event: Parameters<RunRegistry["emit"]>[1],
						) => {
							const next = (seqForChannel.get(rootId) ?? 0) + 1;
							seqForChannel.set(rootId, next);
							target.emit(rootId, event);
							if (event.type === "reply") {
								pendingReplies.push({
									runId: event.runId,
									sessionId: event.sessionId,
									text: event.text,
									ts: event.ts,
									seq: next,
								});
								const r = replyResolver;
								replyResolver = null;
								r?.();
							}
						};
					}
					return Reflect.get(target, prop, receiver);
				},
			}) as unknown as RunRegistry;

			const ctx = createExecutionContext(runner, {
				runRegistry,
				spanEmitter,
				ownerId: userId,
				userId,
				sessionId,
				context: body.context,
				replyCollector,
			});

			return streamSSE(c, async (stream) => {
				// Drain reply events as they arrive. Runs concurrently with the
				// manifest execution; closes when the main path flips `runComplete`.
				const forwarder = (async () => {
					while (true) {
						while (pendingReplies.length > 0) {
							const ev = pendingReplies.shift();
							if (!ev) continue;
							await stream.writeSSE({
								event: "reply",
								data: JSON.stringify({
									type: "reply",
									runId: ev.runId,
									sessionId: ev.sessionId,
									text: ev.text,
									ts: ev.ts,
									seq: ev.seq,
								}),
								id: String(ev.seq),
							});
						}
						if (runComplete) return;
						await new Promise<void>((r) => {
							replyResolver = r;
						});
					}
				})();

				try {
					await stream.writeSSE({
						event: "run-start",
						data: JSON.stringify({
							agentId,
							kind: manifest.kind,
							sessionId,
							traceId,
						}),
					});

					const result = await execute(manifest, input ?? "", ctx);

					const completePayload: Record<string, unknown> = {
						output: result.output,
						state: result.state,
						sessionId,
					};
					if (replyCollector.length > 0)
						completePayload.replies = replyCollector;

					// Drain any tail reply events emitted in the same tick as the
					// final tool execution before we close with run-complete.
					runComplete = true;
					const r = replyResolver;
					replyResolver = null;
					r?.();
					await forwarder;

					await stream.writeSSE({
						event: "run-complete",
						data: JSON.stringify(completePayload),
					});
				} catch (error) {
					runComplete = true;
					const r = replyResolver;
					replyResolver = null;
					r?.();
					await forwarder.catch(() => {});
					await stream.writeSSE({
						event: "run-error",
						data: JSON.stringify({ error: errorMessage(error) }),
					});
				}
			});
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.post("/run/block/stream", async (c) => {
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				agentId?: string;
				input?: unknown;
				sessionId?: string;
				context?: string[];
				selection?: unknown;
			};
			const { agentId, input } = body;

			if (!agentId) {
				return c.json({ error: "Missing required field: agentId" }, 400);
			}

			const selection = normalizeManifestSelection(body.selection);
			const sessionId = body.sessionId ?? generateSessionId();
			const traceId = `tr_${randomBytes(8).toString("hex")}`;

			const { runner, manifest } = await resolveRunnerAndManifestImpl(
				store,
				userId,
				agentId,
			);
			const selectedManifest = await resolveSelectedBlockManifest(
				manifest,
				selection,
				runner,
			);
			traceRegistry.register(traceId, userId);
			const baseRegistry = new InMemoryRunRegistry();
			const spanEmitter = new SpanEmitter({
				traceSink: (event) => {
					if (event.type === "span-start") traceRegistry.spanStart(event.span);
					else if (event.type === "span-end")
						traceRegistry.spanEnd(event.spanId, event.patch);
					else if (event.type === "trace-done")
						traceRegistry.traceDone(
							event.summary.traceId,
							event.summary.ownerId,
							event.summary,
						);
				},
				recordIO: false,
				traceId,
			});
			const replyCollector: Reply[] = [];
			type QueuedReply = {
				runId: string;
				sessionId: string;
				text: string;
				ts: string;
				seq: number;
			};
			const pendingReplies: QueuedReply[] = [];
			let replyResolver: (() => void) | null = null;
			let runComplete = false;

			const seqForChannel = new Map<string, number>();
			const runRegistry: RunRegistry = new Proxy(baseRegistry, {
				get(target, prop, receiver) {
					if (prop === "emit") {
						return (
							rootId: string,
							event: Parameters<RunRegistry["emit"]>[1],
						) => {
							const next = (seqForChannel.get(rootId) ?? 0) + 1;
							seqForChannel.set(rootId, next);
							target.emit(rootId, event);
							if (event.type === "reply") {
								pendingReplies.push({
									runId: event.runId,
									sessionId: event.sessionId,
									text: event.text,
									ts: event.ts,
									seq: next,
								});
								const r = replyResolver;
								replyResolver = null;
								r?.();
							}
						};
					}
					return Reflect.get(target, prop, receiver);
				},
			}) as unknown as RunRegistry;

			const ctx = createExecutionContext(runner, {
				runRegistry,
				spanEmitter,
				ownerId: userId,
				userId,
				sessionId,
				context: body.context,
				replyCollector,
			});

			return streamSSE(c, async (stream) => {
				const forwarder = (async () => {
					while (true) {
						while (pendingReplies.length > 0) {
							const ev = pendingReplies.shift();
							if (!ev) continue;
							await stream.writeSSE({
								event: "reply",
								data: JSON.stringify({
									type: "reply",
									runId: ev.runId,
									sessionId: ev.sessionId,
									text: ev.text,
									ts: ev.ts,
									seq: ev.seq,
								}),
								id: String(ev.seq),
							});
						}
						if (runComplete) return;
						await new Promise<void>((r) => {
							replyResolver = r;
						});
					}
				})();

				try {
					await stream.writeSSE({
						event: "run-start",
						data: JSON.stringify({
							agentId,
							kind: selectedManifest.kind,
							sessionId,
							traceId,
							target: "block",
							blockId: selectedManifest.id,
						}),
					});

					const result = await execute(selectedManifest, input ?? "", ctx);

					const completePayload: Record<string, unknown> = {
						output: result.output,
						state: result.state,
						sessionId,
						target: "block",
						blockId: selectedManifest.id,
						blockKind: selectedManifest.kind,
					};
					if (replyCollector.length > 0)
						completePayload.replies = replyCollector;

					runComplete = true;
					const r = replyResolver;
					replyResolver = null;
					r?.();
					await forwarder;

					await stream.writeSSE({
						event: "run-complete",
						data: JSON.stringify(completePayload),
					});
				} catch (error) {
					runComplete = true;
					const r = replyResolver;
					replyResolver = null;
					r?.();
					await forwarder.catch(() => {});
					await stream.writeSSE({
						event: "run-error",
						data: JSON.stringify({ error: errorMessage(error) }),
					});
				}
			});
		} catch (error) {
			const status = isBadRequest(error) ? 400 : isNotFound(error) ? 404 : 500;
			return c.json({ error: errorMessage(error) }, status);
		}
	});

	// ───────────────────────────────────────────────────────────────────────
	// /runs/* — long-lived, observable Runs backed by the process-wide registry
	// ───────────────────────────────────────────────────────────────────────

	app.get("/runs", async (c) => {
		const userId = getUserId(c);

		let limit: number | undefined;
		const limitRaw = c.req.query("limit");
		if (limitRaw !== undefined) {
			const n = Number(limitRaw);
			if (!Number.isFinite(n) || n < 1) {
				return c.json({ error: "Invalid `limit` query param" }, 400);
			}
			limit = n;
		}

		const rootsOnlyRaw = c.req.query("rootsOnly");
		const rootsOnly =
			rootsOnlyRaw === undefined ? undefined : rootsOnlyRaw !== "false";

		const filters: RunListFilters = {
			rootsOnly,
			agentId: c.req.query("agentId"),
			status: c.req.query("status") as RunListFilters["status"],
			startedAfter: c.req.query("startedAfter"),
			startedBefore: c.req.query("startedBefore"),
			cursor: c.req.query("cursor"),
			limit,
		};

		try {
			const result = await store.forUser(userId).listRuns(filters);
			return c.json(result);
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.post("/runs", async (c) => {
		const start = Date.now();
		let agentIdForLog: string | undefined;
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				agentId?: string;
				input?: unknown;
				sessionId?: string;
				context?: string[];
				callbackUrl?: string;
				webhookSecretName?: string;
			};
			const { agentId, input, callbackUrl, webhookSecretName } = body;
			agentIdForLog = agentId;

			if (!agentId) {
				return c.json({ error: "Missing required field: agentId" }, 400);
			}

			// Webhook validation: callbackUrl + webhookSecretName pair must be coherent.
			// We resolve the secret metadata here (sync with the request) so a
			// missing or typo'd name returns 400 before we register a Run we'd
			// otherwise have to cancel.
			let resolvedSecretName: string | undefined;
			if (callbackUrl) {
				try {
					await assertOutboundUrlAllowed(callbackUrl, opts.outboundUrlPolicy);
				} catch (err) {
					const message =
						err instanceof OutboundUrlPolicyError
							? err.message
							: "invalid callbackUrl";
					return c.json(
						{ error: `callbackUrl is not allowed: ${message}` },
						400,
					);
				}
				if (!webhookSecretName) {
					return c.json(
						{ error: "webhookSecretName required with callbackUrl" },
						400,
					);
				}
				const meta = await store
					.forUser(userId)
					.getSecretMetadata(webhookSecretName);
				if (!meta) {
					return c.json({ error: "webhook secret not found" }, 400);
				}
				// Pass the name through to the dispatcher; it resolves the live
				// plaintext at each delivery attempt so an out-of-band rotation
				// flows through without any pinning machinery.
				resolvedSecretName = webhookSecretName;
			}

			// Always work with a concrete sessionId. Top-level Runs are indexed in
			// the registry by sessionId to power cancel-and-replace, so an absent
			// id must not mean "no session" — it means "fresh session".
			const sessionId = body.sessionId ?? generateSessionId();

			const inputStr =
				typeof input === "string"
					? input
					: input == null
						? ""
						: JSON.stringify(input);

			const run = runRegistry.create({
				agentId,
				input: inputStr,
				userId,
				sessionId,
			});

			console.log(
				`[runs] start run=${run.id} agent=${agentId} user=${userId} inputLen=${inputStr.length}${callbackUrl ? ` webhook=${webhookSecretName}` : ""}`,
			);

			// Wire the dispatcher BEFORE starting the executor so the registry's
			// first emitted reply (and the eventual run-complete) are seen by our
			// subscriber. We subscribe via `runRegistry.subscribe(run.rootId)` —
			// the multiplexed feed is the canonical place to observe reply +
			// run-complete events for a Run.
			const replyCollector: Reply[] = [];
			let dispatcher: WebhookDispatcher | undefined;
			let webhookForwarder: Promise<void> | undefined;
			if (resolvedSecretName && callbackUrl) {
				dispatcher = createWebhookDispatcher({
					deliveryStore: store.forUser(userId),
					secretStore: store.forUser(userId),
					secretName: resolvedSecretName,
					callbackUrl,
					runId: run.id,
					ownerId: userId,
					outboundUrlPolicy: opts.outboundUrlPolicy,
				});
				webhookForwarder = forwardEventsToDispatcher({
					runRegistry,
					rootId: run.rootId,
					runId: run.id,
					dispatcher,
					replyCollector,
				});
			}

			runRegistry.start(run, async (signal) => {
				const runStart = Date.now();
				const { runner, manifest } = await resolveRunnerAndManifestImpl(
					store,
					userId,
					agentId,
				);
				const ctx = createExecutionContext(runner, {
					runRegistry,
					parentRunId: run.id,
					userId,
					sessionId,
					context: body.context,
					replyCollector,
				});
				const result = await execute(manifest, input ?? "", ctx);
				if (signal.aborted) {
					throw signal.reason instanceof Error
						? signal.reason
						: new Error(String(signal.reason ?? "aborted"));
				}
				const outputStr =
					typeof result.output === "string"
						? result.output
						: JSON.stringify(result.output);
				const invokeResult: InvokeResult = {
					output: outputStr,
					invocationId: run.id,
					sessionId,
					toolCalls: [],
					usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
					duration: Date.now() - runStart,
					model: "manifest",
				};
				if (replyCollector.length > 0)
					invokeResult.replies = [...replyCollector];
				return invokeResult;
			});

			// Webhook forwarder runs detached from the request — it owns subscribe
			// lifetime. We don't await it; the dispatcher inserts to outbox + has
			// its own retry loop. The run continues regardless of webhook failures.
			if (webhookForwarder) {
				webhookForwarder.catch((err) => {
					console.error(
						`[webhook] forwarder failed run=${run.id}: ${errorMessage(err)}`,
					);
				});
			}

			const created = runRegistry.get(run.id) ?? run;
			return c.json(runToJSON(created), 201, {
				Location: `/runs/${run.id}`,
			});
		} catch (error) {
			console.error(
				`[runs] start failed agent=${agentIdForLog} ${Date.now() - start}ms: ${errorMessage(error)}`,
			);
			const status = isNotFound(error) ? 404 : 500;
			return c.json({ error: errorMessage(error) }, status);
		}
	});

	app.get("/runs/:id", async (c) => {
		const runId = c.req.param("id");
		const userId = getUserId(c);
		const run = await loadOwnedRun(runRegistry, store, userId, runId);
		if (!run) return c.json({ error: "Run not found" }, 404);
		return c.json(runToJSON(run));
	});

	app.get("/runs/:id/stream", async (c) => {
		const runId = c.req.param("id");
		const userId = getUserId(c);
		const sinceParam = c.req.query("since");
		const sinceSeq = sinceParam ? Number(sinceParam) : undefined;
		if (sinceParam && !Number.isFinite(sinceSeq)) {
			return c.json({ error: "Invalid `since` query param" }, 400);
		}

		const live = runRegistry.get(runId);
		if (live) {
			if (live.userId !== userId) {
				return c.json({ error: "Run not found" }, 404);
			}
			// rootId may not equal id for spawned children; use root for subtree feed.
			const rootId = live.rootId;
			return streamSSE(c, async (stream) => {
				try {
					for await (const ev of runRegistry.subscribe(rootId, sinceSeq)) {
						await stream.writeSSE({
							event: ev.type,
							data: JSON.stringify(ev),
							id: String(ev.seq),
						});
					}
				} catch (err) {
					await stream
						.writeSSE({
							event: "stream-error",
							data: JSON.stringify({ error: errorMessage(err) }),
						})
						.catch(() => {});
				}
			});
		}

		// Not in memory — fall back to RunStore for a one-shot snapshot.
		const stored = await store
			.forUser(userId)
			.getRun(runId)
			.catch(() => null);
		if (!stored) return c.json({ error: "Run not found" }, 404);
		return streamSSE(c, async (stream) => {
			await stream.writeSSE({
				event: "snapshot",
				data: JSON.stringify(stored),
			});
		});
	});

	app.post("/runs/:id/cancel", async (c) => {
		const runId = c.req.param("id");
		const userId = getUserId(c);
		const run = runRegistry.get(runId);
		if (!run || run.userId !== userId) {
			return c.json({ error: "Run not found" }, 404);
		}
		runRegistry.cancel(runId, "cancelled by user");
		// Status flips asynchronously when the executor's promise rejects.
		// Return the current view so the client can poll for terminal.
		const after = runRegistry.get(runId) ?? run;
		return c.json(runToJSON(after));
	});

	// /evals, /datasets, /eval-runs — hosted eval management

	app.get("/evals", async (c) => {
		const userId = getUserId(c);
		const rows = await store
			.forUser(userId)
			.listEvals({ agentId: c.req.query("agentId") });
		return c.json(rows);
	});

	app.post("/evals", async (c) => {
		const userId = getUserId(c);
		const body = (getCachedBody(c) ?? (await c.req.json())) as Partial<
			EvalDefinition & { id?: string }
		>;
		const definition = normalizeEvalDefinition(body);
		const scoped = store.forUser(userId);
		await assertEvalDatasetScope(scoped, definition);
		await scoped.putEval(definition);
		return c.json(definition, 201);
	});

	app.get("/evals/:id", async (c) => {
		const userId = getUserId(c);
		const evalId = decodeURIComponent(c.req.param("id"));
		const row = await store.forUser(userId).getEval(evalId);
		if (!row) return c.json({ error: "Eval not found" }, 404);
		return c.json(row);
	});

	app.put("/evals/:id", async (c) => {
		const userId = getUserId(c);
		const evalId = decodeURIComponent(c.req.param("id"));
		const body = (getCachedBody(c) ??
			(await c.req.json())) as Partial<EvalDefinition>;
		const scoped = store.forUser(userId);
		const existing = await scoped.getEval(evalId);
		if (!existing) return c.json({ error: "Eval not found" }, 404);
		const definition = normalizeEvalDefinition({
			...existing,
			...body,
			id: evalId,
		});
		await assertEvalDatasetScope(scoped, definition);
		await scoped.putEval(definition);
		return c.json(definition);
	});

	app.delete("/evals/:id", async (c) => {
		const userId = getUserId(c);
		const evalId = decodeURIComponent(c.req.param("id"));
		await store.forUser(userId).deleteEval(evalId);
		return c.body(null, 204);
	});

	app.get("/evals/:id/versions", async (c) => {
		const userId = getUserId(c);
		const evalId = decodeURIComponent(c.req.param("id"));
		return c.json(await store.forUser(userId).listEvalVersions(evalId));
	});

	app.get("/evals/:id/versions/:version", async (c) => {
		const userId = getUserId(c);
		const evalId = decodeURIComponent(c.req.param("id"));
		const version = decodeURIComponent(c.req.param("version"));
		const scoped = store.forUser(userId);
		const resolvedVersion = await resolveHostedEvalVersionRef(
			scoped,
			evalId,
			version,
		);
		const row = await scoped.getEvalVersion(evalId, resolvedVersion);
		if (!row) return c.json({ error: "Eval version not found" }, 404);
		return c.json(row);
	});

	app.post("/evals/:id/versions/:version/activate", async (c) => {
		const userId = getUserId(c);
		const evalId = decodeURIComponent(c.req.param("id"));
		const version = decodeURIComponent(c.req.param("version"));
		const scoped = store.forUser(userId);
		const resolvedVersion = await resolveHostedEvalVersionRef(
			scoped,
			evalId,
			version,
		);
		await scoped.activateEvalVersion(evalId, resolvedVersion);
		return c.json(await scoped.getEval(evalId));
	});

	app.put("/evals/:id/aliases/:alias", async (c) => {
		const userId = getUserId(c);
		const evalId = decodeURIComponent(c.req.param("id"));
		const alias = decodeURIComponent(c.req.param("alias"));
		const body = (getCachedBody(c) ?? (await c.req.json())) as {
			version?: string;
			createdAt?: string;
		};
		const version = body.version ?? body.createdAt;
		if (!version)
			return c.json({ error: "Missing required field: version" }, 400);
		await store.forUser(userId).setEvalVersionAlias(evalId, version, alias);
		return c.json({ alias, version });
	});

	app.delete("/evals/:id/aliases/:alias", async (c) => {
		const userId = getUserId(c);
		const evalId = decodeURIComponent(c.req.param("id"));
		const alias = decodeURIComponent(c.req.param("alias"));
		await store.forUser(userId).removeEvalVersionAlias(evalId, alias);
		return c.json({ alias, deleted: true });
	});

	app.get("/datasets", async (c) => {
		const userId = getUserId(c);
		return c.json(
			await store
				.forUser(userId)
				.listDatasets({ agentId: c.req.query("agentId") }),
		);
	});

	app.post("/datasets", async (c) => {
		const userId = getUserId(c);
		const body = (getCachedBody(c) ?? (await c.req.json())) as Partial<
			EvalDataset & { id?: string }
		>;
		const dataset = normalizeEvalDataset(body);
		await store.forUser(userId).putDataset(dataset);
		return c.json(dataset, 201);
	});

	app.get("/datasets/:id", async (c) => {
		const userId = getUserId(c);
		const datasetId = decodeURIComponent(c.req.param("id"));
		const row = await store.forUser(userId).getDataset(datasetId);
		if (!row) return c.json({ error: "Dataset not found" }, 404);
		return c.json(row);
	});

	app.put("/datasets/:id", async (c) => {
		const userId = getUserId(c);
		const datasetId = decodeURIComponent(c.req.param("id"));
		const body = (getCachedBody(c) ??
			(await c.req.json())) as Partial<EvalDataset>;
		const scoped = store.forUser(userId);
		const existing = await scoped.getDataset(datasetId);
		if (!existing) return c.json({ error: "Dataset not found" }, 404);
		const dataset = normalizeEvalDataset({
			...existing,
			...body,
			id: datasetId,
		});
		await scoped.putDataset(dataset);
		return c.json(dataset);
	});

	app.delete("/datasets/:id", async (c) => {
		const userId = getUserId(c);
		const datasetId = decodeURIComponent(c.req.param("id"));
		await store.forUser(userId).deleteDataset(datasetId);
		return c.body(null, 204);
	});

	app.get("/datasets/:id/versions", async (c) => {
		const userId = getUserId(c);
		const datasetId = decodeURIComponent(c.req.param("id"));
		return c.json(await store.forUser(userId).listDatasetVersions(datasetId));
	});

	app.get("/datasets/:id/versions/:version", async (c) => {
		const userId = getUserId(c);
		const datasetId = decodeURIComponent(c.req.param("id"));
		const version = decodeURIComponent(c.req.param("version"));
		const scoped = store.forUser(userId);
		const resolvedVersion = await resolveHostedDatasetVersionRef(
			scoped,
			datasetId,
			version,
		);
		const row = await scoped.getDatasetVersion(datasetId, resolvedVersion);
		if (!row) return c.json({ error: "Dataset version not found" }, 404);
		return c.json(row);
	});

	app.post("/datasets/:id/versions/:version/activate", async (c) => {
		const userId = getUserId(c);
		const datasetId = decodeURIComponent(c.req.param("id"));
		const version = decodeURIComponent(c.req.param("version"));
		const scoped = store.forUser(userId);
		const resolvedVersion = await resolveHostedDatasetVersionRef(
			scoped,
			datasetId,
			version,
		);
		await scoped.activateDatasetVersion(datasetId, resolvedVersion);
		return c.json(await scoped.getDataset(datasetId));
	});

	app.put("/datasets/:id/aliases/:alias", async (c) => {
		const userId = getUserId(c);
		const datasetId = decodeURIComponent(c.req.param("id"));
		const alias = decodeURIComponent(c.req.param("alias"));
		const body = (getCachedBody(c) ?? (await c.req.json())) as {
			version?: string;
			createdAt?: string;
		};
		const version = body.version ?? body.createdAt;
		if (!version)
			return c.json({ error: "Missing required field: version" }, 400);
		await store
			.forUser(userId)
			.setDatasetVersionAlias(datasetId, version, alias);
		return c.json({ alias, version });
	});

	app.delete("/datasets/:id/aliases/:alias", async (c) => {
		const userId = getUserId(c);
		const datasetId = decodeURIComponent(c.req.param("id"));
		const alias = decodeURIComponent(c.req.param("alias"));
		await store.forUser(userId).removeDatasetVersionAlias(datasetId, alias);
		return c.json({ alias, deleted: true });
	});

	app.get("/eval-runs", async (c) => {
		const userId = getUserId(c);
		const limitRaw = c.req.query("limit");
		const limit = limitRaw ? Number(limitRaw) : undefined;
		if (limitRaw && !Number.isFinite(limit)) {
			return c.json({ error: "Invalid `limit` query param" }, 400);
		}
		const filters: EvalRunListFilters = {
			agentId: c.req.query("agentId"),
			evalId: c.req.query("evalId"),
			datasetId: c.req.query("datasetId"),
			status: c.req.query("status") as EvalRunListFilters["status"],
			startedAfter: c.req.query("startedAfter"),
			startedBefore: c.req.query("startedBefore"),
			cursor: c.req.query("cursor"),
			limit,
		};
		return c.json(await store.forUser(userId).listEvalRuns(filters));
	});

	app.post("/eval-runs", async (c) => {
		const userId = getUserId(c);
		const body = (getCachedBody(c) ?? (await c.req.json())) as {
			evalId?: string;
			evalVersion?: string;
			datasetId?: string;
			datasetVersion?: string;
			agentVersion?: string;
			criterionIds?: string[];
		};
		if (!body.evalId) {
			return c.json({ error: "Missing required field: evalId" }, 400);
		}
		try {
			const started = await startHostedEval({
				store,
				userId,
				evalId: body.evalId,
				evalVersion: body.evalVersion,
				datasetId: body.datasetId,
				datasetVersion: body.datasetVersion,
				agentVersion: body.agentVersion,
				criterionIds: body.criterionIds,
				resolveRunnerAndManifest: resolveRunnerAndManifestImpl,
				traceRegistry,
				controllers: evalRunControllers,
			});
			return c.json(started, 201);
		} catch (error) {
			const status = isNotFound(error) ? 404 : 500;
			return c.json({ error: errorMessage(error) }, status);
		}
	});

	app.get("/eval-runs/:id", async (c) => {
		const userId = getUserId(c);
		const runId = decodeURIComponent(c.req.param("id"));
		const row = await store.forUser(userId).getEvalRun(runId);
		if (!row) return c.json({ error: "Eval run not found" }, 404);
		return c.json(row);
	});

	app.post("/eval-runs/:id/cancel", async (c) => {
		const userId = getUserId(c);
		const runId = decodeURIComponent(c.req.param("id"));
		const scoped = store.forUser(userId);
		const row = await scoped.getEvalRun(runId);
		if (!row) return c.json({ error: "Eval run not found" }, 404);
		const controller = evalRunControllers.get(runId);
		controller?.abort("cancelled by user");
		const cancelled = await cancelStoredEvalRun(scoped, row);
		return c.json(cancelled);
	});

	app.get("/eval-scores", async (c) => {
		const userId = getUserId(c);
		return c.json(
			await store.forUser(userId).listEvalLatestScores({
				agentId: c.req.query("agentId"),
				evalId: c.req.query("evalId"),
				evalVersion: c.req.query("evalVersion"),
				datasetId: c.req.query("datasetId"),
				datasetVersion: c.req.query("datasetVersion"),
				resolvedAgentVersion: c.req.query("resolvedAgentVersion"),
				status: c.req.query("status") as never,
			}),
		);
	});

	app.get("/eval-scores/latest", async (c) => {
		const userId = getUserId(c);
		const evalId = c.req.query("evalId");
		const datasetId = c.req.query("datasetId");
		if (!evalId || !datasetId) {
			return c.json(
				{ error: "Missing required query params: evalId, datasetId" },
				400,
			);
		}
		return c.json(
			await store.forUser(userId).getEvalLatestScore({
				evalId,
				evalVersion: c.req.query("evalVersion"),
				datasetId,
				datasetVersion: c.req.query("datasetVersion"),
				resolvedAgentVersion: c.req.query("resolvedAgentVersion"),
			}),
		);
	});

	// ───────────────────────────────────────────────────────────────────────
	// /webhook-secrets/* — server-generates HMAC signing keys and stores them
	// in the unified SecretStore (AES-256-GCM at rest). The raw `value` field
	// is returned ONLY at create/regenerate time so the caller can copy it to
	// their consumer's env. Subsequent `GET` responses never include it.
	// Regeneration is in-place upsert: the old value stops working immediately;
	// the consumer must redeploy with the new value to verify new signatures.
	// ───────────────────────────────────────────────────────────────────────

	app.post("/webhook-secrets", async (c) => {
		try {
			const userId = getUserId(c);
			const body = (getCachedBody(c) ?? (await c.req.json())) as {
				name?: string;
				description?: string;
			};
			const name = body?.name;
			if (!name || typeof name !== "string") {
				return c.json({ error: "Missing required field: name" }, 400);
			}
			const scopedStore = store.forUser(userId);
			const existing = await scopedStore.getSecretMetadata(name);
			if (existing) {
				return c.json({ error: `Secret "${name}" already exists` }, 409);
			}
			const value = `whsec_${randomBytes(32).toString("hex")}`;
			const createdAt = new Date().toISOString();
			await scopedStore.putSecret({
				name,
				value,
				description: body?.description,
				createdAt,
				updatedAt: createdAt,
			});
			return c.json({ name, value, createdAt }, 201);
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.get("/webhook-secrets", async (c) => {
		try {
			const userId = getUserId(c);
			const rows = await store.forUser(userId).listSecrets();
			// Returns metadata only (lastFour for masked display); raw values are
			// only available at create/regenerate time. Note: this lists the
			// user's full secret pool, including secrets used as HTTP-tool auth.
			// The unified store has no `kind` discriminator.
			return c.json(rows);
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.post("/webhook-secrets/:name/regenerate", async (c) => {
		try {
			const userId = getUserId(c);
			const name = c.req.param("name");
			const scopedStore = store.forUser(userId);
			const existing = await scopedStore.getSecretMetadata(name);
			if (!existing) {
				return c.json({ error: "webhook secret not found" }, 404);
			}
			const value = `whsec_${randomBytes(32).toString("hex")}`;
			const updatedAt = new Date().toISOString();
			await scopedStore.putSecret({
				name,
				value,
				description: existing.description,
				createdAt: existing.createdAt,
				updatedAt,
			});
			return c.json({ name, value, createdAt: existing.createdAt, updatedAt });
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	app.delete("/webhook-secrets/:name", async (c) => {
		try {
			const userId = getUserId(c);
			const name = c.req.param("name");
			await store.forUser(userId).deleteSecret(name);
			return c.body(null, 204);
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	// ───────────────────────────────────────────────────────────────────────
	// /traces/* — observability read surface
	// ───────────────────────────────────────────────────────────────────────

	app.get("/traces/:id", async (c) => {
		const traceId = c.req.param("id");
		const userId = getUserId(c);
		const scoped = store.forUser(userId);
		const summary = await scoped.getSummary(traceId, userId);
		if (!summary) return c.json({ error: "Trace not found" }, 404);
		const spans = await scoped.getTrace(traceId, userId);
		return c.json({ summary, spans });
	});

	app.get("/traces/:id/stream", async (c) => {
		const traceId = c.req.param("id");
		const userId = getUserId(c);

		// Live path: registry has active spans for this trace.
		const inProgress = traceRegistry.getInProgress(traceId, userId);
		if (inProgress !== null) {
			return streamSSE(c, async (stream) => {
				try {
					for await (const ev of traceRegistry.subscribe(traceId, userId)) {
						await stream.writeSSE({
							event: ev.type,
							data: JSON.stringify(ev),
						});
					}
				} catch (err) {
					await stream
						.writeSSE({
							event: "stream-error",
							data: JSON.stringify({ error: errorMessage(err) }),
						})
						.catch(() => {});
				}
			});
		}

		// Terminal path: replay one snapshot from the store.
		const scoped = store.forUser(userId);
		const summary = await scoped.getSummary(traceId, userId);
		if (!summary) return c.json({ error: "Trace not found" }, 404);
		const spans = await scoped.getTrace(traceId, userId);
		return streamSSE(c, async (stream) => {
			await stream.writeSSE({
				event: "snapshot",
				data: JSON.stringify({ summary, spans }),
			});
		});
	});

	app.delete("/traces/:id", async (c) => {
		const traceId = c.req.param("id");
		const userId = getUserId(c);
		const scoped = store.forUser(userId);
		// Owner-scoped check first so we can 404 instead of silently no-op'ing.
		const summary = await scoped.getSummary(traceId, userId);
		if (!summary) return c.json({ error: "Trace not found" }, 404);
		await scoped.deleteTrace(traceId, userId);
		return c.body(null, 204);
	});

	app.get("/traces", async (c) => {
		const userId = getUserId(c);

		let limit: number | undefined;
		const limitRaw = c.req.query("limit");
		if (limitRaw !== undefined) {
			const n = Number(limitRaw);
			if (!Number.isFinite(n) || n < 1) {
				return c.json({ error: "Invalid `limit` query param" }, 400);
			}
			limit = n;
		}

		const filter: TraceFilter = {
			ownerId: userId,
			agentId: c.req.query("agentId"),
			status: c.req.query("status") as TraceFilter["status"],
			startedAfter: c.req.query("startedAfter"),
			startedBefore: c.req.query("startedBefore"),
			cursor: c.req.query("cursor"),
			limit,
		};

		try {
			const result = await store.forUser(userId).listTraces(filter);
			return c.json(result);
		} catch (error) {
			return c.json({ error: errorMessage(error) }, 500);
		}
	});

	return app;
}

async function startHostedEval(opts: {
	store: UnifiedStore;
	userId: string;
	evalId: string;
	evalVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	agentVersion?: string;
	criterionIds?: string[];
	resolveRunnerAndManifest: (
		store: UnifiedStore,
		userId: string,
		agentId: string,
	) => Promise<{ runner: Runner; manifest: AgentManifest }>;
	traceRegistry: InMemoryTraceRegistry;
	controllers: Map<string, AbortController>;
}): Promise<EvalRun> {
	const scoped = opts.store.forUser(opts.userId);
	const resolvedEval = await resolveHostedEvalDefinition(
		scoped,
		opts.evalId,
		opts.evalVersion,
	);
	const definition = resolvedEval.definition;
	if (definition.criteria.length === 0) {
		throw new Error(
			`Eval "${definition.id}" must define at least one criterion`,
		);
	}
	const criteria = selectEvalCriteria(definition.criteria, opts.criterionIds);
	if (criteria.length === 0) {
		throw new Error(`Eval "${definition.id}" did not match any criterionIds`);
	}
	const datasetId =
		opts.datasetId ??
		definition.defaultDataset?.id ??
		definition.defaultDatasetId;
	if (!datasetId) {
		throw new Error(
			`Eval "${definition.id}" does not specify a default dataset; pass datasetId`,
		);
	}
	const resolvedDataset = await resolveHostedDataset(
		scoped,
		datasetId,
		opts.datasetVersion ??
			(opts.datasetId ? undefined : definition.defaultDataset?.version),
	);
	const dataset = resolvedDataset.dataset;
	if (dataset.agentId !== definition.agentId) {
		throw new Error(
			`Dataset "${dataset.id}" belongs to agent "${dataset.agentId}", not "${definition.agentId}"`,
		);
	}

	const agentRef = opts.agentVersion
		? `${definition.agentId}@${opts.agentVersion}`
		: definition.agentId;
	const { runner, manifest } = await opts.resolveRunnerAndManifest(
		opts.store,
		opts.userId,
		agentRef,
	);
	const agent = await runner.resolveAgentRef(agentRef);
	if (!agent) {
		throw Object.assign(new Error(`Agent "${agentRef}" not found`), {
			code: "NOT_FOUND",
		});
	}
	const criterionIds = criteria.map((criterion) => criterion.id);
	const partial =
		Boolean(opts.criterionIds?.length) &&
		criterionIds.length !== definition.criteria.length;

	const run: EvalRun = {
		id: generateId("evalrun"),
		evalId: definition.id,
		requestedEvalVersion: resolvedEval.requestedVersion,
		evalVersion: resolvedEval.resolvedVersion,
		datasetId: dataset.id,
		requestedDatasetVersion: resolvedDataset.requestedVersion,
		datasetVersion: resolvedDataset.resolvedVersion,
		agentId: definition.agentId,
		agentVersion: agent.createdAt,
		requestedAgentVersion: opts.agentVersion,
		criterionIds,
		partial,
		status: "running",
		startedAt: new Date().toISOString(),
		snapshots: {
			eval: cloneJson(definition),
			dataset: cloneJson(dataset),
			agent: cloneJson(agent),
			evalVersion: resolvedEval.resolvedVersion,
			requestedEvalVersion: resolvedEval.requestedVersion,
			datasetVersion: resolvedDataset.resolvedVersion,
			requestedDatasetVersion: resolvedDataset.requestedVersion,
			agentVersion: agent.createdAt,
			requestedAgentVersion: opts.agentVersion,
		},
		caseResults: [],
	};
	await scoped.putEvalRun(run);

	const controller = new AbortController();
	opts.controllers.set(run.id, controller);
	void executeHostedEval({
		scoped,
		run,
		runner,
		manifest,
		definition,
		dataset,
		criteria,
		traceRegistry: opts.traceRegistry,
		userId: opts.userId,
		signal: controller.signal,
	})
		.catch(async (error) => {
			run.status = "failed";
			run.error = errorMessage(error);
			run.summary = summarizeEvalRun(definition, run.caseResults, {
				criterionIds,
			});
			run.endedAt = new Date().toISOString();
			await scoped.putEvalRun(run);
			if (!run.partial) {
				await scoped.putEvalLatestScore(latestScoreFromEvalRun(run));
			}
		})
		.finally(() => {
			opts.controllers.delete(run.id);
		});

	return run;
}

async function executeHostedEval(opts: {
	scoped: UnifiedStore;
	run: EvalRun;
	runner: Runner;
	manifest: AgentManifest;
	definition: EvalDefinition;
	dataset: EvalDataset;
	criteria: EvalCriterion[];
	traceRegistry: InMemoryTraceRegistry;
	userId: string;
	signal: AbortSignal;
}): Promise<void> {
	const {
		scoped,
		run,
		runner,
		manifest,
		definition,
		dataset,
		criteria,
		traceRegistry,
		userId,
		signal,
	} = opts;
	const judgeId = `__agntz_eval_judge_${run.id}`;
	runner.registerAgent(createEvalJudgeAgent(judgeId, definition));
	try {
		for (const item of dataset.items) {
			const latest = await scoped.getEvalRun(run.id);
			if (signal.aborted || latest?.status === "cancelled") {
				if (latest?.status === "cancelled") {
					run.caseResults = mergeEvalCaseResults(
						run.caseResults,
						latest.caseResults,
					);
				}
				if (!run.caseResults.some((result) => result.itemId === item.id)) {
					run.caseResults.push(cancelledEvalCase(item));
				}
				run.status = "cancelled";
				await scoped.putEvalRun({ ...run, caseResults: [...run.caseResults] });
				continue;
			}
			const started = Date.now();
			let output: unknown;
			try {
				const sessionId = generateSessionId();
				const spanEmitter = new SpanEmitter({
					traceSink: (event) => {
						if (event.type === "span-start")
							traceRegistry.spanStart(event.span);
						else if (event.type === "span-end")
							traceRegistry.spanEnd(event.spanId, event.patch);
						else if (event.type === "trace-done")
							traceRegistry.traceDone(
								event.summary.traceId,
								event.summary.ownerId,
								event.summary,
							);
					},
					recordIO: false,
				});
				const ctx = createExecutionContext(runner, {
					runRegistry: new InMemoryRunRegistry(),
					spanEmitter,
					ownerId: userId,
					userId,
					sessionId,
				});
				const result = await execute(manifest, item.input ?? "", ctx);
				output = result.output;
				if (signal.aborted) {
					if (!run.caseResults.some((result) => result.itemId === item.id)) {
						run.caseResults.push(cancelledEvalCase(item));
					}
					run.status = "cancelled";
					await scoped.putEvalRun({
						...run,
						caseResults: [...run.caseResults],
					});
					continue;
				}
			} catch (error) {
				if (signal.aborted) {
					if (!run.caseResults.some((result) => result.itemId === item.id)) {
						run.caseResults.push(cancelledEvalCase(item));
					}
					run.status = "cancelled";
					await scoped.putEvalRun({
						...run,
						caseResults: [...run.caseResults],
					});
					continue;
				}
				run.caseResults.push(
					failedEvalCase(item, {
						error: `Target agent failed: ${errorMessage(error)}`,
						duration: Date.now() - started,
					}),
				);
				await scoped.putEvalRun({ ...run, caseResults: [...run.caseResults] });
				continue;
			}

			try {
				const pairs = await Promise.all(
					criteria.map(async (criterion) => {
						try {
							const judged = await runner.invoke(
								judgeId,
								judgeCriterionPrompt({
									definition,
									dataset,
									item,
									criterion,
									actual: output,
								}),
								{ signal },
							);
							return [
								criterion.id,
								scoreCriterionJudgeOutput(
									criterion,
									parseJudgeOutputText(judged.output),
								),
							] as const;
						} catch (error) {
							if (signal.aborted) throw error;
							return [
								criterion.id,
								failedCriterionResult(
									criterion,
									`Judge failed: ${errorMessage(error)}`,
								),
							] as const;
						}
					}),
				);
				const criteriaResults = Object.fromEntries(pairs) as Record<
					string,
					EvalCriterionResult
				>;
				const score = weightedAverage(
					criteria,
					(criterion) => criteriaResults[criterion.id]?.score ?? 0,
				);
				const derived = deriveEvalCaseOutcome(
					definition,
					criteria,
					criteriaResults,
					score,
				);
				run.caseResults.push({
					itemId: item.id,
					status: "completed",
					input: item.input,
					output: outputToString(output),
					duration: Date.now() - started,
					criteria: criteriaResults,
					score,
					passed: derived.passed,
					outcome: derived.outcome,
					gateFailures: derived.gateFailures,
				});
			} catch (error) {
				if (signal.aborted) {
					if (!run.caseResults.some((result) => result.itemId === item.id)) {
						run.caseResults.push(cancelledEvalCase(item));
					}
					run.status = "cancelled";
					await scoped.putEvalRun({
						...run,
						caseResults: [...run.caseResults],
					});
					continue;
				}
				run.caseResults.push(
					failedEvalCase(item, {
						output: outputToString(output),
						error: `Judge failed: ${errorMessage(error)}`,
						duration: Date.now() - started,
					}),
				);
			}
			await scoped.putEvalRun({ ...run, caseResults: [...run.caseResults] });
		}
	} finally {
		runner.deregisterAgent(judgeId);
	}

	run.summary = summarizeEvalRun(definition, run.caseResults, {
		criterionIds: run.criterionIds,
	});
	run.status = signal.aborted ? "cancelled" : "completed";
	run.endedAt = new Date().toISOString();
	await scoped.putEvalRun(run);
	if (!run.partial)
		await scoped.putEvalLatestScore(latestScoreFromEvalRun(run));
}

async function resolveHostedEvalDefinition(
	store: UnifiedStore,
	evalId: string,
	version: string | undefined,
): Promise<{
	definition: EvalDefinition;
	requestedVersion?: string;
	resolvedVersion?: string;
}> {
	if (!version) {
		const definition = await store.getEval(evalId);
		if (!definition) {
			throw Object.assign(new Error(`Eval "${evalId}" not found`), {
				code: "NOT_FOUND",
			});
		}
		return {
			definition,
			resolvedVersion:
				definition.version ?? definition.updatedAt ?? definition.createdAt,
		};
	}
	const resolvedVersion = await resolveHostedEvalVersionRef(
		store,
		evalId,
		version,
	);
	const definition = await store.getEvalVersion(evalId, resolvedVersion);
	if (!definition) {
		throw Object.assign(new Error(`Eval "${evalId}@${version}" not found`), {
			code: "NOT_FOUND",
		});
	}
	return { definition, requestedVersion: version, resolvedVersion };
}

async function resolveHostedDataset(
	store: UnifiedStore,
	datasetId: string,
	version: string | undefined,
): Promise<{
	dataset: EvalDataset;
	requestedVersion?: string;
	resolvedVersion?: string;
}> {
	if (!version) {
		const dataset = await store.getDataset(datasetId);
		if (!dataset) {
			throw Object.assign(new Error(`Dataset "${datasetId}" not found`), {
				code: "NOT_FOUND",
			});
		}
		return {
			dataset,
			resolvedVersion:
				dataset.version ?? dataset.updatedAt ?? dataset.createdAt,
		};
	}
	const resolvedVersion = await resolveHostedDatasetVersionRef(
		store,
		datasetId,
		version,
	);
	const dataset = await store.getDatasetVersion(datasetId, resolvedVersion);
	if (!dataset) {
		throw Object.assign(
			new Error(`Dataset "${datasetId}@${version}" not found`),
			{
				code: "NOT_FOUND",
			},
		);
	}
	return { dataset, requestedVersion: version, resolvedVersion };
}

async function resolveHostedEvalVersionRef(
	store: UnifiedStore,
	evalId: string,
	version: string,
): Promise<string> {
	if (version === "latest") {
		const latest = (await store.listEvalVersions(evalId))[0]?.createdAt;
		if (!latest) throw new Error(`Eval "${evalId}@latest" not found`);
		return latest;
	}
	const alias = await store.resolveEvalVersionAlias(evalId, version);
	if (alias) return alias;
	return version;
}

async function resolveHostedDatasetVersionRef(
	store: UnifiedStore,
	datasetId: string,
	version: string,
): Promise<string> {
	if (version === "latest") {
		const latest = (await store.listDatasetVersions(datasetId))[0]?.createdAt;
		if (!latest) throw new Error(`Dataset "${datasetId}@latest" not found`);
		return latest;
	}
	const alias = await store.resolveDatasetVersionAlias(datasetId, version);
	if (alias) return alias;
	return version;
}

function selectEvalCriteria(
	criteria: EvalCriterion[],
	criterionIds: string[] | undefined,
): EvalCriterion[] {
	if (!criterionIds?.length) return criteria;
	const requested = new Set(criterionIds);
	return criteria.filter((criterion) => requested.has(criterion.id));
}

function judgeCriterionPrompt(args: {
	definition: EvalDefinition;
	dataset: EvalDataset;
	item: EvalDataset["items"][number];
	criterion: EvalCriterion;
	actual: unknown;
}): string {
	return JSON.stringify(
		{
			instruction:
				"Score the target agent output for this one criterion. Return JSON with score and reason only.",
			input: args.item.input,
			actual: args.actual,
			itemMetadata: args.item.metadata ?? {},
			datasetMetadata: args.dataset.metadata ?? {},
			criterion: {
				id: args.criterion.id,
				name: args.criterion.name,
				rubric: criterionRubric(args.criterion),
				weight: normalizeCriterionWeight(args.criterion),
				gate: args.criterion.gate ?? undefined,
			},
			eval: {
				id: args.definition.id,
				name: args.definition.name,
			},
		},
		null,
		2,
	);
}

function failedCriterionResult(
	criterion: EvalCriterion,
	reason: string,
): EvalCriterionResult {
	const minimumScore = criterionGateMinimum(criterion);
	const gate =
		minimumScore === undefined
			? undefined
			: { minimumScore, passed: 0 >= minimumScore };
	return {
		score: 0,
		passed: gate ? gate.passed : true,
		reason,
		gate,
		error: reason,
	};
}

function deriveEvalCaseOutcome(
	definition: EvalDefinition,
	criteria: EvalCriterion[],
	results: Record<string, EvalCriterionResult>,
	score: number,
): {
	passed: boolean;
	outcome: "passed" | "failed" | "score_only";
	gateFailures: string[];
} {
	const gateFailures: string[] = [];
	const minimum = evalPassPolicyMinimum(definition);
	if (minimum !== undefined && score < minimum) {
		gateFailures.push(
			`overall score ${formatEvalScore(score)} below pass policy ${formatEvalScore(minimum)}`,
		);
	}
	for (const criterion of criteria) {
		const criterionMinimum = criterionGateMinimum(criterion);
		if (criterionMinimum === undefined) continue;
		const criterionScore = results[criterion.id]?.score ?? 0;
		if (criterionScore < criterionMinimum) {
			gateFailures.push(
				`${criterion.id} score ${formatEvalScore(criterionScore)} below gate ${formatEvalScore(criterionMinimum)}`,
			);
		}
	}
	const hasChecks =
		minimum !== undefined ||
		criteria.some((criterion) => criterionGateMinimum(criterion) !== undefined);
	const outcome =
		gateFailures.length > 0 ? "failed" : hasChecks ? "passed" : "score_only";
	return { passed: outcome !== "failed", outcome, gateFailures };
}

function weightedAverage(
	criteria: EvalCriterion[],
	readScore: (criterion: EvalCriterion) => number,
): number {
	let weighted = 0;
	let totalWeight = 0;
	for (const criterion of criteria) {
		const weight = normalizeCriterionWeight(criterion);
		weighted += clampScore(readScore(criterion)) * weight;
		totalWeight += weight;
	}
	return totalWeight > 0 ? weighted / totalWeight : 0;
}

function clampScore(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function formatEvalScore(score: number): string {
	return clampScore(score).toFixed(2);
}

function normalizeEvalDefinition(
	body: Partial<EvalDefinition>,
): EvalDefinition {
	const id = stringOrUndefined(body.id) ?? generateId("eval");
	const agentId = stringOrUndefined(body.agentId);
	if (!agentId) throw new Error("Missing required field: agentId");
	const name = stringOrUndefined(body.name) ?? id;
	const criteria = Array.isArray(body.criteria)
		? body.criteria.map((criterion, index) => ({
				id:
					stringOrUndefined(criterion?.id) ??
					`criterion_${String(index + 1).padStart(2, "0")}`,
				name: stringOrUndefined(criterion?.name) ?? `Criterion ${index + 1}`,
				rubric:
					stringOrUndefined(criterion?.rubric) ??
					stringOrUndefined(criterion?.description),
				description: stringOrUndefined(criterion?.description),
				weight:
					typeof criterion?.weight === "number" ? criterion.weight : undefined,
				gate: normalizeGate(criterion?.gate, criterion?.threshold),
				threshold:
					typeof criterion?.threshold === "number"
						? criterion.threshold
						: undefined,
			}))
		: [];
	return {
		id,
		agentId,
		name,
		description: stringOrUndefined(body.description),
		criteria,
		defaultDataset: normalizeDefaultDataset(body),
		defaultDatasetId:
			normalizeDefaultDataset(body)?.id ??
			stringOrUndefined(body.defaultDatasetId),
		passPolicy: normalizePassPolicy(body),
		passThreshold:
			typeof body.passThreshold === "number" ? body.passThreshold : undefined,
		judge: normalizeJudge(body),
		judgeModel: body.judgeModel,
		metadata: isRecord(body.metadata) ? body.metadata : undefined,
		version: body.version,
		createdAt: body.createdAt,
		updatedAt: body.updatedAt,
	};
}

function normalizeEvalDataset(body: Partial<EvalDataset>): EvalDataset {
	const id = stringOrUndefined(body.id) ?? generateId("dataset");
	const agentId = stringOrUndefined(body.agentId);
	if (!agentId) throw new Error("Missing required field: agentId");
	const name = stringOrUndefined(body.name) ?? id;
	const items = Array.isArray(body.items)
		? body.items.map((item, index) => ({
				id:
					stringOrUndefined(item?.id) ??
					`case_${String(index + 1).padStart(3, "0")}`,
				name: stringOrUndefined(item?.name),
				input:
					typeof item?.input === "string" ||
					Array.isArray(item?.input) ||
					isRecord(item?.input)
						? item.input
						: JSON.stringify(item?.input ?? ""),
				metadata: isRecord(item?.metadata) ? item.metadata : undefined,
			}))
		: [];
	return {
		id,
		agentId,
		name,
		description: stringOrUndefined(body.description),
		items,
		metadata: isRecord(body.metadata) ? body.metadata : undefined,
		version: body.version,
		createdAt: body.createdAt,
		updatedAt: body.updatedAt,
	};
}

async function assertEvalDatasetScope(
	store: UnifiedStore,
	definition: EvalDefinition,
): Promise<void> {
	const datasetId =
		definition.defaultDataset?.id ?? definition.defaultDatasetId;
	if (!datasetId) return;
	const dataset = await store.getDataset(datasetId);
	if (!dataset) {
		throw Object.assign(new Error(`Dataset "${datasetId}" not found`), {
			code: "NOT_FOUND",
		});
	}
	if (dataset.agentId !== definition.agentId) {
		throw new Error(
			`Dataset "${dataset.id}" belongs to agent "${dataset.agentId}", not "${definition.agentId}"`,
		);
	}
}

function failedEvalCase(
	item: EvalDataset["items"][number],
	opts: { output?: string; duration: number; error: string },
): EvalCaseResult {
	return {
		itemId: item.id,
		status: "failed",
		input: item.input,
		output: opts.output,
		duration: opts.duration,
		criteria: {},
		score: 0,
		passed: false,
		outcome: "failed",
		gateFailures: ["case failed before scoring"],
		error: opts.error,
	};
}

function cancelledEvalCase(item: EvalDataset["items"][number]): EvalCaseResult {
	return {
		itemId: item.id,
		status: "cancelled",
		input: item.input,
		criteria: {},
		score: 0,
		passed: false,
		outcome: "failed",
		gateFailures: ["case cancelled before scoring"],
		error: "Eval run cancelled.",
	};
}

async function cancelStoredEvalRun(
	store: UnifiedStore,
	run: EvalRun,
): Promise<EvalRun> {
	if (run.status !== "pending" && run.status !== "running") return run;
	const seen = new Set(run.caseResults.map((result) => result.itemId));
	const caseResults = [
		...run.caseResults,
		...run.snapshots.dataset.items
			.filter((item) => !seen.has(item.id))
			.map(cancelledEvalCase),
	];
	const next: EvalRun = {
		...run,
		status: "cancelled",
		endedAt: run.endedAt ?? new Date().toISOString(),
		caseResults,
		summary: summarizeEvalRun(run.snapshots.eval, caseResults, {
			criterionIds: run.criterionIds,
		}),
	};
	await store.putEvalRun(next);
	if (!next.partial)
		await store.putEvalLatestScore(latestScoreFromEvalRun(next));
	return next;
}

function mergeEvalCaseResults(
	local: EvalCaseResult[],
	stored: EvalCaseResult[],
): EvalCaseResult[] {
	const byId = new Map(local.map((result) => [result.itemId, result]));
	for (const result of stored) {
		if (!byId.has(result.itemId)) byId.set(result.itemId, result);
	}
	return Array.from(byId.values());
}

function outputToString(output: unknown): string {
	return typeof output === "string" ? output : JSON.stringify(output);
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AgentConflictMode = "version" | "skip" | "fail";
type SnapshotConflictMode = "skip" | "fail";
type ImportAction = "create" | "version" | "skip" | "update";

interface AgentImportItem {
	id: string;
	manifest: string;
	manifestName?: string;
	description?: string;
	sourcePath?: string;
}

interface AgentImportResult {
	id: string;
	sourcePath?: string;
	action: ImportAction;
	warnings?: unknown[];
}

interface SessionImportResult {
	sessionId: string;
	agentId?: string;
	action: ImportAction;
	messageCount: number;
}

interface MemoryImportResult {
	id: string;
	scope: string;
	action: ImportAction;
	status: MemoryEntry["status"];
}

function normalizeAgentImportItems(value: unknown): AgentImportItem[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw badRequest("Body must include a non-empty agents array.");
	}
	const seen = new Set<string>();
	return value.map((raw, index) => {
		if (!isRecord(raw)) {
			throw badRequest(`agents[${index}] must be an object.`);
		}
		const manifestSource = raw.manifest;
		if (typeof manifestSource !== "string" || !manifestSource.trim()) {
			throw badRequest(`agents[${index}].manifest must be a non-empty string.`);
		}
		let manifest: AgentManifest;
		try {
			manifest = parseManifest(manifestSource);
		} catch (error) {
			throw badRequest(
				`agents[${index}].manifest could not be parsed: ${errorMessage(error)}`,
			);
		}
		const requestedId =
			typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : manifest.id;
		if (requestedId !== manifest.id) {
			throw badRequest(
				`agents[${index}].id "${requestedId}" does not match manifest id "${manifest.id}".`,
			);
		}
		if (seen.has(requestedId)) {
			throw badRequest(`Duplicate agent id in import batch: ${requestedId}`);
		}
		seen.add(requestedId);
		return {
			id: requestedId,
			manifest: manifestSource,
			manifestName: manifest.name,
			description: manifest.description,
			sourcePath:
				typeof raw.sourcePath === "string" && raw.sourcePath.trim()
					? raw.sourcePath
					: undefined,
		};
	});
}

function normalizeAgentConflict(value: unknown): AgentConflictMode {
	if (value === undefined || value === null) return "version";
	if (value === "version" || value === "skip" || value === "fail") {
		return value;
	}
	throw badRequest("onConflict must be one of: version, skip, fail.");
}

function normalizeSnapshotConflict(value: unknown): SnapshotConflictMode {
	if (value === undefined || value === null) return "skip";
	if (value === "skip" || value === "fail") return value;
	throw badRequest("onConflict must be one of: skip, fail.");
}

function normalizeSessionSnapshots(value: unknown): SessionSnapshot[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw badRequest("Body must include a non-empty sessions array.");
	}
	const seen = new Set<string>();
	return value.map((raw, index) => {
		if (!isRecord(raw)) {
			throw badRequest(`sessions[${index}] must be an object.`);
		}
		const sessionId = raw.sessionId;
		if (typeof sessionId !== "string" || !sessionId.trim()) {
			throw badRequest(
				`sessions[${index}].sessionId must be a non-empty string.`,
			);
		}
		if (seen.has(sessionId)) {
			throw badRequest(`Duplicate session id in import batch: ${sessionId}`);
		}
		seen.add(sessionId);
		if (!Array.isArray(raw.messages)) {
			throw badRequest(`sessions[${index}].messages must be an array.`);
		}
		return {
			sessionId,
			agentId: stringOrUndefined(raw.agentId),
			createdAt: stringOrUndefined(raw.createdAt),
			updatedAt: stringOrUndefined(raw.updatedAt),
			messages: raw.messages.map((message, msgIndex) =>
				normalizeMessage(message, `sessions[${index}].messages[${msgIndex}]`),
			),
		};
	});
}

function normalizeMessage(
	value: unknown,
	path: string,
): SessionSnapshot["messages"][number] {
	if (!isRecord(value)) throw badRequest(`${path} must be an object.`);
	const role = value.role;
	if (
		role !== "system" &&
		role !== "user" &&
		role !== "assistant" &&
		role !== "tool"
	) {
		throw badRequest(`${path}.role must be system, user, assistant, or tool.`);
	}
	const content = value.content;
	if (typeof content !== "string" && !Array.isArray(content)) {
		throw badRequest(
			`${path}.content must be a string or content block array.`,
		);
	}
	const timestamp = value.timestamp;
	if (typeof timestamp !== "string" || !timestamp.trim()) {
		throw badRequest(`${path}.timestamp must be a non-empty string.`);
	}
	return {
		role,
		content: content as SessionSnapshot["messages"][number]["content"],
		timestamp,
		toolCalls: Array.isArray(value.toolCalls)
			? (value.toolCalls as SessionSnapshot["messages"][number]["toolCalls"])
			: undefined,
		toolCallId: stringOrUndefined(value.toolCallId),
	};
}

function normalizeMemoryEntries(value: unknown): MemoryEntry[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw badRequest("Body must include a non-empty entries array.");
	}
	const seen = new Set<string>();
	return value.map((raw, index) => {
		if (!isRecord(raw)) {
			throw badRequest(`entries[${index}] must be an object.`);
		}
		const id = raw.id;
		const scope = raw.scope;
		const content = raw.content;
		if (typeof id !== "string" || !id.trim()) {
			throw badRequest(`entries[${index}].id must be a non-empty string.`);
		}
		if (seen.has(id)) throw badRequest(`Duplicate memory entry id: ${id}`);
		seen.add(id);
		if (typeof scope !== "string" || !scope.trim()) {
			throw badRequest(`entries[${index}].scope must be a non-empty string.`);
		}
		if (typeof content !== "string" || !content.trim()) {
			throw badRequest(`entries[${index}].content must be a non-empty string.`);
		}
		const topics = raw.topics;
		if (
			!Array.isArray(topics) ||
			topics.some((topic) => typeof topic !== "string")
		) {
			throw badRequest(`entries[${index}].topics must be a string array.`);
		}
		const type = raw.type;
		if (
			type !== "fact" &&
			type !== "preference" &&
			type !== "event" &&
			type !== "summary"
		) {
			throw badRequest(
				`entries[${index}].type must be fact, preference, event, or summary.`,
			);
		}
		const status = raw.status;
		if (status !== "active" && status !== "superseded") {
			throw badRequest(
				`entries[${index}].status must be active or superseded.`,
			);
		}
		const createdAt = raw.createdAt;
		const updatedAt = raw.updatedAt;
		if (typeof createdAt !== "string" || !createdAt.trim()) {
			throw badRequest(
				`entries[${index}].createdAt must be a non-empty string.`,
			);
		}
		if (typeof updatedAt !== "string" || !updatedAt.trim()) {
			throw badRequest(
				`entries[${index}].updatedAt must be a non-empty string.`,
			);
		}
		return {
			id,
			scope,
			content,
			topics: [...new Set(topics as string[])],
			type,
			status,
			source: isRecord(raw.source)
				? {
						agentId: stringOrUndefined(raw.source.agentId),
						sessionId: stringOrUndefined(raw.source.sessionId),
						runId: stringOrUndefined(raw.source.runId),
					}
				: undefined,
			supersededBy: stringOrUndefined(raw.supersededBy),
			createdAt,
			updatedAt,
		};
	});
}

function defaultModelConfig(): { provider: string; name: string } {
	return {
		provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
		name: process.env.DEFAULT_MODEL_NAME ?? "gpt-5.4-mini",
	};
}

function countActions<T extends { action: string }>(
	results: T[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const result of results) {
		counts[result.action] = (counts[result.action] ?? 0) + 1;
	}
	return counts;
}

function normalizeGate(
	gate: unknown,
	threshold: unknown,
): { minimumScore: number } | undefined {
	if (isRecord(gate) && typeof gate.minimumScore === "number") {
		return { minimumScore: gate.minimumScore };
	}
	if (typeof threshold === "number") return { minimumScore: threshold };
	return undefined;
}

function normalizePassPolicy(
	body: Partial<EvalDefinition>,
): { minimumScore?: number } | undefined {
	if (
		isRecord(body.passPolicy) &&
		typeof body.passPolicy.minimumScore === "number"
	) {
		return { minimumScore: body.passPolicy.minimumScore };
	}
	if (typeof body.passThreshold === "number") {
		return { minimumScore: body.passThreshold };
	}
	return undefined;
}

function normalizeJudge(
	body: Partial<EvalDefinition>,
): EvalDefinition["judge"] {
	if (isRecord(body.judge) && isRecord(body.judge.model)) {
		return {
			model: body.judge.model as unknown as EvalDefinition["judgeModel"],
		};
	}
	if (body.judgeModel) return { model: body.judgeModel };
	return undefined;
}

function normalizeDefaultDataset(
	body: Partial<EvalDefinition>,
): EvalDefinition["defaultDataset"] {
	if (isRecord(body.defaultDataset)) {
		const id = stringOrUndefined(body.defaultDataset.id);
		if (id) {
			return {
				id,
				version: stringOrUndefined(body.defaultDataset.version),
			};
		}
	}
	const id = stringOrUndefined(body.defaultDatasetId);
	return id ? { id } : undefined;
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Load a Run owned by the given user. Checks the in-memory registry first;
 * falls back to the durable RunStore for evicted/historical runs. Returns
 * null if the run doesn't exist or isn't owned by the user (caller should
 * 404 in both cases — no distinguishing).
 */
async function loadOwnedRun(
	registry: RunRegistry,
	store: UnifiedStore,
	userId: string,
	runId: string,
): Promise<Run | null> {
	const live = registry.get(runId);
	if (live) return live.userId === userId ? live : null;
	return store
		.forUser(userId)
		.getRun(runId)
		.catch(() => null);
}

/**
 * Wire-format projection of a Run. Drops nothing currently, but keeps the
 * route handler out of the business of shaping Run records.
 */
function runToJSON(run: Run): Run {
	return run;
}

function normalizeManifestSelection(
	selection: unknown,
): ManifestSelection | undefined {
	if (selection == null) return undefined;
	if (!isRecord(selection)) {
		throw badRequest("selection must be an object when provided");
	}
	if (!Array.isArray(selection.agentPath)) {
		throw badRequest("selection.agentPath must be an array");
	}
	const agentPath = normalizePath(selection.agentPath, "selection.agentPath");
	const stepPath =
		selection.stepPath == null
			? undefined
			: Array.isArray(selection.stepPath)
				? normalizePath(selection.stepPath, "selection.stepPath")
				: undefined;
	if (selection.stepPath != null && stepPath === undefined) {
		throw badRequest("selection.stepPath must be an array when provided");
	}
	return stepPath ? { agentPath, stepPath } : { agentPath };
}

function normalizePath(
	value: unknown[],
	fieldName: string,
): Array<string | number> {
	return value.map((segment, index) => {
		if (typeof segment === "string") return segment;
		if (
			typeof segment === "number" &&
			Number.isInteger(segment) &&
			segment >= 0
		) {
			return segment;
		}
		throw badRequest(
			`${fieldName}[${index}] must be a string or non-negative integer`,
		);
	});
}

function buildSelectedContext(
	currentManifest: string,
	selection: ManifestSelection | undefined,
): string {
	const parsed = parseManifest(currentManifest);
	if (!selection) {
		return [
			"Selection: whole manifest",
			"Focus: no specific block was selected; edit the manifest as a whole.",
		].join("\n");
	}

	const block = selectManifestBlock(parsed, selection);
	if (!block.agent && !block.step) {
		throw badRequest("selected block path was not found in currentManifest");
	}

	const selectedYaml = stringifyYAML(block.agent ?? block.step, {
		lineWidth: 0,
	}).trimEnd();
	const lines = [
		"Selection:",
		`agentPath: ${JSON.stringify(block.selection.agentPath)}`,
	];
	if (block.selection.stepPath) {
		lines.push(`stepPath: ${JSON.stringify(block.selection.stepPath)}`);
	}
	if (block.agent) {
		lines.push(`id: ${block.agent.id}`, `kind: ${block.agent.kind}`);
		if (block.agent.name) lines.push(`name: ${block.agent.name}`);
	} else if (block.step?.ref) {
		lines.push(`ref: ${block.step.ref}`);
	}
	lines.push(
		"",
		"Selected YAML focus:",
		"```yaml",
		selectedYaml,
		"```",
		"",
		"The selected YAML is focus context, not an edit boundary. Update any related upstream or downstream YAML needed to keep the whole manifest valid.",
	);
	return lines.join("\n");
}

async function resolveSelectedBlockManifest(
	root: AgentManifest,
	selection: ManifestSelection | undefined,
	runner: Runner,
): Promise<AgentManifest> {
	if (!selection) return root;
	const block = selectManifestBlock(root, selection);
	if (block.agent) return block.agent;
	if (block.step?.agent) return block.step.agent;
	if (block.step?.ref) return resolveStoredManifest(block.step.ref, runner);
	throw badRequest("selected block path was not found in the agent manifest");
}

async function resolveRunnerAndManifest(
	store: UnifiedStore,
	userId: string,
	agentId: string,
	outboundUrlPolicy?: OutboundUrlPolicyOptions,
	resources: Record<string, ResourceProvider> = {},
	namespacePolicy?: NamespaceGrantPolicy,
): Promise<{ runner: Runner; manifest: AgentManifest }> {
	const tools = [...LOCAL_TOOLS];
	const defaults = {
		model: {
			provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
			name: process.env.DEFAULT_MODEL_NAME ?? "gpt-5.4-mini",
		},
	};

	if (isSystemAgentId(agentId)) {
		// System agents are repo-bundled YAML; they have no version history.
		// Reject `@version` suffixes explicitly so callers don't silently get
		// the activated/latest behavior that doesn't apply here.
		if (agentId.includes("@")) {
			throw Object.assign(
				new Error(`System agent "${agentId}" cannot be version-pinned`),
				{ code: "INVALID_AGENT_REF" },
			);
		}
		const manifest = await loadSystemAgent(agentId);
		// System agents run with an ephemeral store — they don't need persistence
		// and shouldn't see or write the calling user's agents/sessions.
		const ephemeralStore = new MemoryStore();
		const runner = createRunner({
			store: ephemeralStore,
			tools,
			resources,
			namespacePolicy,
			defaults,
			outboundUrlPolicy,
		});
		return { runner, manifest };
	}

	const scoped = wrapWithSkillRedaction(store.forUser(userId));
	const runner = createRunner({
		store: scoped,
		tools,
		resources,
		namespacePolicy,
		defaults,
		outboundUrlPolicy,
	});
	const manifest = await resolveStoredManifest(agentId, runner);
	return { runner, manifest };
}

async function resolveStoredManifest(
	agentId: string,
	runner: Runner,
): Promise<AgentManifest> {
	// `agentId` may carry an `@<version|latest>` suffix; the runner parses it.
	const agentDef = await runner.resolveAgentRef(agentId);
	if (!agentDef) {
		throw Object.assign(new Error(`Agent "${agentId}" not found`), {
			code: "NOT_FOUND",
		});
	}

	const metadata = agentDef.metadata as Record<string, unknown> | undefined;
	if (metadata?.manifest && typeof metadata.manifest === "string") {
		return parseManifest(metadata.manifest);
	}

	throw new Error(
		`Agent "${agentId}" does not have a manifest. Store with metadata.manifest (YAML string).`,
	);
}

export interface CurationSweepResult {
	curateEnabled: boolean;
	/** Total dirty (scope, topic) pairs discovered before the sweep. */
	dirty: number;
	scopes: Array<{
		scope: string;
		topics: string[];
		report?: CurateReport;
		error?: string;
	}>;
}

/**
 * Discover every (scope, topic) pair with uncurated writes and curate each
 * scope with grants = [scope] — one scope at a time, so a future encryption
 * decorator only ever needs one scope's key unwrapped at once. Shared by
 * POST /memory/curate (no-grants form) and the MEMREZ_CURATE_INTERVAL loop.
 */
export async function runCurationSweep(
	memrez: Memrez,
): Promise<CurationSweepResult> {
	if (!memrez.reasoner.curate) {
		return { curateEnabled: false, dirty: 0, scopes: [] };
	}
	const dirty = await memrez.store.listDirtyTopics();
	const byScope = new Map<string, string[]>();
	for (const { scope, topic } of dirty) {
		const topics = byScope.get(scope);
		if (topics) topics.push(topic);
		else byScope.set(scope, [topic]);
	}
	const scopes: CurationSweepResult["scopes"] = [];
	for (const [scope, topics] of byScope) {
		try {
			const report = await memrez.curate([scope], {
				topics,
				// The sweep unit is the exact dirty scope. Do not expand to
				// ancestors here; future encrypted stores should only need this one
				// scope's key unwrapped for the pass.
				includeDescendants: true,
			});
			scopes.push({ scope, topics, report });
		} catch (error) {
			scopes.push({ scope, topics, error: errorMessage(error) });
		}
	}
	return { curateEnabled: true, dirty: dirty.length, scopes };
}

function memoryNotConfigured(c: Context) {
	return c.json({ error: "memory resource is not configured" }, 503);
}

/**
 * Map memrez errors onto HTTP statuses: unknown entry → 404, correction
 * conflicts → 409, bad grants/scopes → 400.
 */
function memoryErrorResponse(c: Context, error: unknown) {
	if (error instanceof MemrezEntryNotFoundError) {
		return c.json({ error: error.message }, 404);
	}
	if (error instanceof MemrezCorrectionError) {
		return c.json({ error: error.message }, 409);
	}
	if (
		error instanceof MemrezScopeError ||
		error instanceof NamespaceGrantError ||
		isBadRequest(error)
	) {
		return c.json({ error: errorMessage(error) }, 400);
	}
	return c.json({ error: errorMessage(error) }, 500);
}

/** Parse repeated and/or comma-separated `grants` query params. */
function parseGrantsParam(values: string[] | undefined): string[] {
	const grants = parseListParam(values);
	if (grants.length === 0) {
		throw badRequest("Missing required query param: grants");
	}
	return grants;
}

function parseListParam(values: string[] | undefined): string[] {
	if (!values) return [];
	return values
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function isTruthyParam(value: string | undefined): boolean {
	if (!value) return false;
	return ["1", "true", "yes"].includes(value.toLowerCase());
}

function clampInt(
	value: string | undefined,
	fallback: number,
	min: number,
	max?: number,
): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (Number.isNaN(parsed)) return fallback;
	const floored = Math.max(min, parsed);
	return max !== undefined ? Math.min(max, floored) : floored;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function badRequest(message: string): Error {
	return Object.assign(new Error(message), { code: "BAD_REQUEST" });
}

function isBadRequest(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error as Error & { code?: string }).code === "BAD_REQUEST"
	);
}

function isNotFound(error: unknown): boolean {
	if (error instanceof Error) {
		return (
			(error as Error & { code?: string }).code === "NOT_FOUND" ||
			error.constructor.name === "AgentNotFoundError"
		);
	}
	return false;
}

/**
 * Subscribe to the run's multiplexed event feed and forward `reply` and
 * terminal (`run-complete` | `run-error` | `run-cancelled`) events to the
 * webhook dispatcher. The subscriber exits when the registry closes the feed
 * after the root run terminates.
 *
 * The dispatcher.dispatch() call returns when the delivery loop settles, but
 * each event is dispatched independently — slow consumers don't block
 * subsequent events from being POSTed.
 */
async function forwardEventsToDispatcher(opts: {
	runRegistry: RunRegistry;
	rootId: string;
	runId: string;
	dispatcher: WebhookDispatcher;
	replyCollector: Reply[];
}): Promise<void> {
	const { runRegistry, rootId, runId, dispatcher, replyCollector } = opts;
	try {
		for await (const ev of runRegistry.subscribe(
			rootId,
		) as AsyncIterable<MultiplexedEvent>) {
			// Only forward events for our root run. Subtree spawn events belong to
			// children — we deliberately do NOT forward those to webhooks; consumers
			// care about the top-level run's intermediate replies + final outcome.
			if (ev.runId !== runId && ev.type !== "reply") continue;
			if (ev.type === "reply") {
				// Reply events from any run in the subtree are routed up to the same
				// session, so we forward them too. (The reply tool tags `runId` =
				// emitting run, not the root.)
				await dispatcher.dispatch({
					type: "reply",
					runId: ev.runId,
					sessionId: ev.sessionId,
					text: ev.text,
					ts: ev.ts,
				});
			} else if (ev.type === "run-complete") {
				const result = ev.result;
				await dispatcher.dispatch({
					type: "complete",
					runId,
					sessionId: result.sessionId,
					status: "completed",
					output: result.output,
					replies: replyCollector.length > 0 ? [...replyCollector] : undefined,
					result,
				});
				// Drain in-flight dispatches before exiting so caller observes
				// all deliveries reach a terminal state.
				await dispatcher.drain();
				return;
			} else if (ev.type === "run-error") {
				await dispatcher.dispatch({
					type: "complete",
					runId,
					// sessionId may not be on the error event; fall back to "" (the
					// payload still includes runId for correlation).
					sessionId: "",
					status: "failed",
					output: null,
					replies: replyCollector.length > 0 ? [...replyCollector] : undefined,
					error: ev.error,
				});
				await dispatcher.drain();
				return;
			} else if (ev.type === "run-cancelled") {
				await dispatcher.dispatch({
					type: "complete",
					runId,
					sessionId: "",
					status: "cancelled",
					output: null,
					replies: replyCollector.length > 0 ? [...replyCollector] : undefined,
				});
				await dispatcher.drain();
				return;
			}
		}
	} catch (err) {
		// Subscribe iteration errors are non-fatal — the webhook just stops.
		console.error(
			`[webhook] subscribe error run=${runId}: ${errorMessage(err)}`,
		);
	}
}
