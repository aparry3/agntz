import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  createRunner,
  createWebhookDispatcher,
  generateSessionId,
  InMemoryRunRegistry,
  MemoryStore,
  SpanEmitter,
  type InvokeResult,
  type MultiplexedEvent,
  type Reply,
  type Run,
  type RunListFilters,
  type Runner,
  type RunRegistry,
  type TraceFilter,
  type UnifiedStore,
  type WebhookDispatcher,
} from "@agntz/core";
import { execute, parseManifest, validateManifestFull } from "@agntz/manifest";
import type { AgentManifest } from "@agntz/manifest";
import { createExecutionContext } from "./bridge.js";
import { InMemoryTraceRegistry } from "./trace-registry.js";
import { workerAuth, internalOnlyAuth, getUserId, getCachedBody } from "./middleware/auth.js";
import { isSystemAgentId, loadSystemAgent, listSystemAgents, getSystemAgent } from "./system-agents.js";
import { LOCAL_TOOLS } from "./tools/registry.js";
import { wrapWithSkillRedaction } from "./session-redact.js";
import { buildValidationContext } from "./validation.js";

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
  const app = new Hono();

  // Test override for the runner+manifest resolver, falling back to the
  // production lookup against the user store + the system-agent registry.
  const resolveRunnerAndManifestImpl =
    opts.resolveRunnerAndManifest ?? resolveRunnerAndManifest;

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

  app.use("*", cors());

  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "agntz-worker" });
  });

  app.use("/run", workerAuth({ store, internalSecret }));
  app.use("/run/stream", workerAuth({ store, internalSecret }));
  app.use("/runs", workerAuth({ store, internalSecret }));
  app.use("/runs/*", workerAuth({ store, internalSecret }));
  app.use("/traces", workerAuth({ store, internalSecret }));
  app.use("/traces/*", workerAuth({ store, internalSecret }));
  app.use("/validate", workerAuth({ store, internalSecret }));
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
        return c.json({ error: "Missing required field: manifest (string)" }, 400);
      }

      const scoped = store.forUser(userId);
      const ctx = buildValidationContext(scoped, { strict, mcpTimeoutMs });
      const result = await validateManifestFull(manifest, ctx);
      return c.json(result);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

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

  app.post("/run", async (c) => {
    const start = Date.now();
    let agentIdForLog: string | undefined;
    try {
      const userId = getUserId(c);
      const body = (getCachedBody(c) ?? (await c.req.json())) as {
        agentId?: string;
        input?: unknown;
        sessionId?: string;
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
        `inputKeys=${input && typeof input === "object" ? Object.keys(input).join(",") : typeof input}`
      );

      const { runner, manifest } = await resolveRunnerAndManifestImpl(store, userId, agentId);
      const runRegistry = new InMemoryRunRegistry();
      const spanEmitter = new SpanEmitter({
        traceSink: (event) => {
          if (event.type === "span-start") traceRegistry.spanStart(event.span);
          else if (event.type === "span-end") traceRegistry.spanEnd(event.spanId, event.patch);
          else if (event.type === "trace-done") traceRegistry.traceDone(event.summary.traceId, event.summary.ownerId, event.summary);
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
        replyCollector,
      });
      const result = await execute(manifest, input ?? "", ctx);

      console.log(
        `[run] done agent=${agentId} ${Date.now() - start}ms kind=${manifest.kind} ` +
        `outputKeys=${result.output && typeof result.output === "object" ? Object.keys(result.output).join(",") : typeof result.output} ` +
        `replies=${replyCollector.length}`
      );

      const responseBody: Record<string, unknown> = { output: result.output, state: result.state, sessionId };
      if (replyCollector.length > 0) responseBody.replies = replyCollector;
      return c.json(responseBody);
    } catch (error) {
      const status = isNotFound(error) ? 404 : 500;
      console.error(`[run] failed agent=${agentIdForLog} ${Date.now() - start}ms: ${errorMessage(error)}`);
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
      };
      const { agentId, input } = body;

      if (!agentId) {
        return c.json({ error: "Missing required field: agentId" }, 400);
      }

      // Pre-allocate sessionId so the run-start SSE frame is authoritative.
      const sessionId = body.sessionId ?? generateSessionId();

      const { runner, manifest } = await resolveRunnerAndManifestImpl(store, userId, agentId);
      const baseRegistry = new InMemoryRunRegistry();
      const spanEmitter = new SpanEmitter({
        traceSink: (event) => {
          if (event.type === "span-start") traceRegistry.spanStart(event.span);
          else if (event.type === "span-end") traceRegistry.spanEnd(event.spanId, event.patch);
          else if (event.type === "trace-done") traceRegistry.traceDone(event.summary.traceId, event.summary.ownerId, event.summary);
        },
        recordIO: false,
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
            return (rootId: string, event: Parameters<RunRegistry["emit"]>[1]) => {
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
        replyCollector,
      });

      return streamSSE(c, async (stream) => {
        // Drain reply events as they arrive. Runs concurrently with the
        // manifest execution; closes when the main path flips `runComplete`.
        const forwarder = (async () => {
          while (true) {
            while (pendingReplies.length > 0) {
              const ev = pendingReplies.shift()!;
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
            data: JSON.stringify({ agentId, kind: manifest.kind, sessionId }),
          });

          const result = await execute(manifest, input ?? "", ctx);

          const completePayload: Record<string, unknown> = {
            output: result.output,
            state: result.state,
            sessionId,
          };
          if (replyCollector.length > 0) completePayload.replies = replyCollector;

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
    const rootsOnly = rootsOnlyRaw === undefined ? undefined : rootsOnlyRaw !== "false";

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
        if (!webhookSecretName) {
          return c.json({ error: "webhookSecretName required with callbackUrl" }, 400);
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
        `[runs] start run=${run.id} agent=${agentId} user=${userId} ` +
        `inputLen=${inputStr.length}` +
        (callbackUrl ? ` webhook=${webhookSecretName}` : ""),
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
        if (replyCollector.length > 0) invokeResult.replies = [...replyCollector];
        return invokeResult;
      });

      // Webhook forwarder runs detached from the request — it owns subscribe
      // lifetime. We don't await it; the dispatcher inserts to outbox + has
      // its own retry loop. The run continues regardless of webhook failures.
      if (webhookForwarder) {
        webhookForwarder.catch((err) => {
          console.error(`[webhook] forwarder failed run=${run.id}: ${errorMessage(err)}`);
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

async function resolveRunnerAndManifest(
  store: UnifiedStore,
  userId: string,
  agentId: string,
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
    const runner = createRunner({ store: ephemeralStore, tools, defaults });
    return { runner, manifest };
  }

  const scoped = wrapWithSkillRedaction(store.forUser(userId));
  const runner = createRunner({ store: scoped, tools, defaults });
  const manifest = await resolveStoredManifest(agentId, runner);
  return { runner, manifest };
}

async function resolveStoredManifest(agentId: string, runner: Runner): Promise<AgentManifest> {
  // `agentId` may carry an `@<version|latest>` suffix; the runner parses it.
  const agentDef = await runner.resolveAgentRef(agentId);
  if (!agentDef) {
    throw Object.assign(new Error(`Agent "${agentId}" not found`), { code: "NOT_FOUND" });
  }

  const metadata = agentDef.metadata as Record<string, unknown> | undefined;
  if (metadata?.manifest && typeof metadata.manifest === "string") {
    return parseManifest(metadata.manifest);
  }

  throw new Error(
    `Agent "${agentId}" does not have a manifest. Store with metadata.manifest (YAML string).`
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isNotFound(error: unknown): boolean {
  if (error instanceof Error) {
    return (error as Error & { code?: string }).code === "NOT_FOUND" ||
      error.constructor.name === "AgentNotFoundError";
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
    for await (const ev of runRegistry.subscribe(rootId) as AsyncIterable<MultiplexedEvent>) {
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
    console.error(`[webhook] subscribe error run=${runId}: ${errorMessage(err)}`);
  }
}
