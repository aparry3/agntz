import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  createRunner,
  InMemoryRunRegistry,
  MemoryStore,
  SpanEmitter,
  type InvokeResult,
  type Run,
  type Runner,
  type RunRegistry,
  type UnifiedStore,
} from "@agntz/core";
import { execute, parseManifest, validateManifestFull } from "@agntz/manifest";
import type { AgentManifest } from "@agntz/manifest";
import { createExecutionContext } from "./bridge.js";
import { InMemoryTraceRegistry } from "./trace-registry.js";
import { workerAuth, internalOnlyAuth, getUserId, getCachedBody } from "./middleware/auth.js";
import { isSystemAgentId, loadSystemAgent, listSystemAgents, getSystemAgent } from "./system-agents.js";
import { LOCAL_TOOLS } from "./tools/registry.js";
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
  app.use("/validate", workerAuth({ store, internalSecret }));
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

      console.log(
        `[run] start agent=${agentId} user=${userId} ` +
        `inputKeys=${input && typeof input === "object" ? Object.keys(input).join(",") : typeof input}`
      );

      const { runner, manifest } = await resolveRunnerAndManifest(store, userId, agentId);
      const runRegistry = new InMemoryRunRegistry();
      const spanEmitter = new SpanEmitter({
        traceSink: (event) => {
          if (event.type === "span-start") traceRegistry.spanStart(event.span);
          else if (event.type === "span-end") traceRegistry.spanEnd(event.spanId, event.patch);
          else if (event.type === "trace-done") traceRegistry.traceDone(event.summary.traceId, event.summary.ownerId, event.summary);
        },
        recordIO: false,
      });
      const ctx = createExecutionContext(runner, { runRegistry, spanEmitter, ownerId: userId });
      const result = await execute(manifest, input ?? "", ctx);

      console.log(
        `[run] done agent=${agentId} ${Date.now() - start}ms kind=${manifest.kind} ` +
        `outputKeys=${result.output && typeof result.output === "object" ? Object.keys(result.output).join(",") : typeof result.output}`
      );

      return c.json({ output: result.output, state: result.state });
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

      const { runner, manifest } = await resolveRunnerAndManifest(store, userId, agentId);
      const runRegistry = new InMemoryRunRegistry();
      const spanEmitter = new SpanEmitter({
        traceSink: (event) => {
          if (event.type === "span-start") traceRegistry.spanStart(event.span);
          else if (event.type === "span-end") traceRegistry.spanEnd(event.spanId, event.patch);
          else if (event.type === "trace-done") traceRegistry.traceDone(event.summary.traceId, event.summary.ownerId, event.summary);
        },
        recordIO: false,
      });
      const ctx = createExecutionContext(runner, { runRegistry, spanEmitter, ownerId: userId });

      return streamSSE(c, async (stream) => {
        try {
          await stream.writeSSE({
            event: "run-start",
            data: JSON.stringify({ agentId, kind: manifest.kind }),
          });

          const result = await execute(manifest, input ?? "", ctx);

          await stream.writeSSE({
            event: "run-complete",
            data: JSON.stringify({ output: result.output, state: result.state }),
          });
        } catch (error) {
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

  app.post("/runs", async (c) => {
    const start = Date.now();
    let agentIdForLog: string | undefined;
    try {
      const userId = getUserId(c);
      const body = (getCachedBody(c) ?? (await c.req.json())) as {
        agentId?: string;
        input?: unknown;
        sessionId?: string;
      };
      const { agentId, input, sessionId } = body;
      agentIdForLog = agentId;

      if (!agentId) {
        return c.json({ error: "Missing required field: agentId" }, 400);
      }

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
        `inputLen=${inputStr.length}`,
      );

      runRegistry.start(run, async (signal) => {
        const runStart = Date.now();
        const { runner, manifest } = await resolveRunnerAndManifest(
          store,
          userId,
          agentId,
        );
        const ctx = createExecutionContext(runner, {
          runRegistry,
          parentRunId: run.id,
          userId,
          sessionId,
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
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          duration: Date.now() - runStart,
          model: "manifest",
        };
        return invokeResult;
      });

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
    const manifest = await loadSystemAgent(agentId);
    // System agents run with an ephemeral store — they don't need persistence
    // and shouldn't see or write the calling user's agents/sessions.
    const ephemeralStore = new MemoryStore();
    const runner = createRunner({ store: ephemeralStore, tools, defaults });
    return { runner, manifest };
  }

  const scoped = store.forUser(userId);
  const runner = createRunner({ store: scoped, tools, defaults });
  const manifest = await resolveStoredManifest(agentId, runner);
  return { runner, manifest };
}

async function resolveStoredManifest(agentId: string, runner: Runner): Promise<AgentManifest> {
  const agentDef = await runner.agents.getAgent(agentId);
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
