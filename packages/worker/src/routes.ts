import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createRunner, MemoryStore, type Runner, type UnifiedStore } from "@agntz/core";
import { execute, parseManifest, validateManifestFull } from "@agntz/manifest";
import type { AgentManifest } from "@agntz/manifest";
import { createExecutionContext } from "./bridge.js";
import { workerAuth, internalOnlyAuth, getUserId, getCachedBody } from "./middleware/auth.js";
import { isSystemAgentId, loadSystemAgent, listSystemAgents, getSystemAgent } from "./system-agents.js";
import { LOCAL_TOOLS } from "./tools/registry.js";
import { buildValidationContext } from "./validation.js";

export interface WorkerAPIOptions {
  store: UnifiedStore;
  internalSecret: string;
}

/**
 * Create the worker API. Auth middleware resolves a per-request userId,
 * then handlers build a user-scoped Runner and execute the agent.
 *
 * System agents (agentId = "system:<name>") are loaded from YAML in the repo
 * and executed via an ephemeral in-memory runner. They don't touch the user's
 * store — they're application-level features that ship with the code.
 */
export function createWorkerAPI({ store, internalSecret }: WorkerAPIOptions): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "agntz-worker" });
  });

  app.use("/run", workerAuth({ store, internalSecret }));
  app.use("/run/stream", workerAuth({ store, internalSecret }));
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
      const ctx = createExecutionContext(runner);
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
      const ctx = createExecutionContext(runner);

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

  return app;
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
