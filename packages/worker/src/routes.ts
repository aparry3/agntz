import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createRunner, type UnifiedStore } from "@agent-runner/core";
import { execute, parseManifest } from "@agent-runner/manifest";
import type { AgentManifest } from "@agent-runner/manifest";
import { createExecutionContext } from "./bridge.js";
import { workerAuth, getWorkspaceId, getCachedBody } from "./middleware/auth.js";
import { seedDefaultsForWorkspace } from "./seed.js";
import { readFileTool } from "./tools/read-file.js";
import { validateManifestTool } from "./tools/validate-manifest.js";

export interface WorkerAPIOptions {
  store: UnifiedStore;
  internalSecret: string;
}

/**
 * Create the worker API. Auth middleware resolves a per-request workspaceId,
 * then handlers build a workspace-scoped Runner and execute the agent.
 */
export function createWorkerAPI({ store, internalSecret }: WorkerAPIOptions): Hono {
  const app = new Hono();

  app.use("*", cors());

  // ─── Health (public) ──────────────────────────────────────────────

  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "agent-runner-worker" });
  });

  // Auth gate for everything else.
  app.use("/run", workerAuth({ store, internalSecret }));
  app.use("/run/stream", workerAuth({ store, internalSecret }));

  // ─── Run (request-response) ───────────────────────────────────────

  app.post("/run", async (c) => {
    try {
      const workspaceId = getWorkspaceId(c);
      const body = (getCachedBody(c) ?? (await c.req.json())) as {
        agentId?: string;
        input?: unknown;
        sessionId?: string;
      };
      const { agentId, input } = body;

      if (!agentId) {
        return c.json({ error: "Missing required field: agentId" }, 400);
      }

      const runner = await getRunnerForWorkspace(store, workspaceId);
      const manifest = await resolveManifest(agentId, runner);
      const ctx = createExecutionContext(runner);
      const result = await execute(manifest, input ?? "", ctx);

      return c.json({
        output: result.output,
        state: result.state,
      });
    } catch (error) {
      const status = isNotFound(error) ? 404 : 500;
      return c.json({ error: errorMessage(error) }, status);
    }
  });

  // ─── Run with streaming (SSE) ─────────────────────────────────────

  app.post("/run/stream", async (c) => {
    try {
      const workspaceId = getWorkspaceId(c);
      const body = (getCachedBody(c) ?? (await c.req.json())) as {
        agentId?: string;
        input?: unknown;
        sessionId?: string;
      };
      const { agentId, input } = body;

      if (!agentId) {
        return c.json({ error: "Missing required field: agentId" }, 400);
      }

      const runner = await getRunnerForWorkspace(store, workspaceId);
      const manifest = await resolveManifest(agentId, runner);
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
            data: JSON.stringify({
              output: result.output,
              state: result.state,
            }),
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

async function getRunnerForWorkspace(store: UnifiedStore, workspaceId: string) {
  const scoped = store.forWorkspace(workspaceId);
  const runner = createRunner({
    store: scoped,
    tools: [readFileTool, validateManifestTool],
    defaults: {
      model: {
        provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
        name: process.env.DEFAULT_MODEL_NAME ?? "gpt-4o",
      },
    },
  });
  await seedDefaultsForWorkspace(runner, workspaceId);
  return runner;
}

async function resolveManifest(agentId: string, runner: ReturnType<typeof createRunner>): Promise<AgentManifest> {
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
