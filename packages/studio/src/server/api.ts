import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Runner } from "@agent-runner/core";

/**
 * Create the Studio API routes. Binds to a Runner instance's stores and tools.
 */
export function createStudioAPI(runner: Runner): Hono {
  const app = new Hono();

  // CORS for local development
  app.use("*", cors());

  // ═══════════════════════════════════════════════════════════════════
  // Health
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/health", (c) => {
    return c.json({ status: "ok", version: "0.1.0" });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Agents
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/agents", async (c) => {
    try {
      const agents = await runner.agents.listAgents();
      return c.json(agents);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.get("/api/agents/:id", async (c) => {
    try {
      const agent = await runner.agents.getAgent(c.req.param("id"));
      if (!agent) {
        return c.json({ error: `Agent "${c.req.param("id")}" not found` }, 404);
      }
      return c.json(agent);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.put("/api/agents/:id", async (c) => {
    try {
      const body = await c.req.json();
      const agent = { ...body, id: c.req.param("id") };

      // Validate required fields
      if (!agent.name || !agent.systemPrompt || !agent.model) {
        return c.json(
          { error: "Missing required fields: name, systemPrompt, model" },
          400
        );
      }

      // Set timestamps
      const existing = await runner.agents.getAgent(agent.id);
      const now = new Date().toISOString();
      agent.updatedAt = now;
      if (!existing) {
        agent.createdAt = now;
      } else {
        agent.createdAt = existing.createdAt ?? now;
      }

      await runner.agents.putAgent(agent);
      return c.json(agent, existing ? 200 : 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.delete("/api/agents/:id", async (c) => {
    try {
      const existing = await runner.agents.getAgent(c.req.param("id"));
      if (!existing) {
        return c.json({ error: `Agent "${c.req.param("id")}" not found` }, 404);
      }
      await runner.agents.deleteAgent(c.req.param("id"));
      return c.json({ deleted: true });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Agent Invocation (Playground)
  // ═══════════════════════════════════════════════════════════════════

  app.post("/api/agents/:id/invoke", async (c) => {
    try {
      const agentId = c.req.param("id");
      const body = await c.req.json();
      const { input, sessionId, contextIds, extraContext, toolContext } = body;

      if (!input || typeof input !== "string") {
        return c.json({ error: "Missing required field: input (string)" }, 400);
      }

      const result = await runner.invoke(agentId, input, {
        sessionId,
        contextIds,
        extraContext,
        toolContext,
      });

      return c.json(result);
    } catch (error: unknown) {
      const status =
        error instanceof Error && error.constructor.name === "AgentNotFoundError"
          ? 404
          : 500;
      return c.json({ error: errorMessage(error) }, status);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tools
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/tools", (c) => {
    const tools = runner.tools.list();
    return c.json(tools);
  });

  app.get("/api/tools/:name", (c) => {
    const tool = runner.tools.get(c.req.param("name"));
    if (!tool) {
      return c.json({ error: `Tool "${c.req.param("name")}" not found` }, 404);
    }
    return c.json(tool);
  });

  app.post("/api/tools/:name/test", async (c) => {
    try {
      const toolName = c.req.param("name");
      const tool = runner.tools.get(toolName);
      if (!tool) {
        return c.json({ error: `Tool "${toolName}" not found` }, 404);
      }

      const body = await c.req.json();
      const startTime = Date.now();
      const result = await runner.tools.execute(toolName, body.input ?? {});
      const duration = Date.now() - startTime;

      return c.json({ output: result, duration });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // MCP Servers
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/mcp/servers", (c) => {
    const status = runner.mcp.status();
    return c.json(status);
  });

  app.get("/api/mcp/servers/:name", (c) => {
    const status = runner.mcp.serverStatus(c.req.param("name"));
    if (!status) {
      return c.json(
        { error: `MCP server "${c.req.param("name")}" not found` },
        404
      );
    }
    return c.json(status);
  });

  app.get("/api/mcp/servers/:name/tools", (c) => {
    const serverName = c.req.param("name");
    const allTools = runner.tools.list();
    const mcpTools = allTools.filter(
      (t) => t.source === `mcp:${serverName}`
    );
    return c.json(mcpTools);
  });

  // ═══════════════════════════════════════════════════════════════════
  // Sessions
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/sessions", async (c) => {
    try {
      const agentId = c.req.query("agentId");
      const sessions = await runner.sessions.listSessions(agentId);
      return c.json(sessions);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.get("/api/sessions/:id", async (c) => {
    try {
      const messages = await runner.sessions.getMessages(c.req.param("id"));
      return c.json({ sessionId: c.req.param("id"), messages });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.delete("/api/sessions/:id", async (c) => {
    try {
      await runner.sessions.deleteSession(c.req.param("id"));
      return c.json({ deleted: true });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Context
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/context/:contextId", async (c) => {
    try {
      const entries = await runner.contexts.getContext(c.req.param("contextId"));
      return c.json({
        contextId: c.req.param("contextId"),
        entries,
        size: entries.reduce((sum, e) => sum + e.content.length, 0),
        count: entries.length,
      });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.post("/api/context/:contextId", async (c) => {
    try {
      const contextId = c.req.param("contextId");
      const body = await c.req.json();

      if (!body.content || typeof body.content !== "string") {
        return c.json(
          { error: "Missing required field: content (string)" },
          400
        );
      }

      const entry = {
        contextId,
        agentId: body.agentId ?? "studio",
        invocationId: body.invocationId ?? `studio_${Date.now()}`,
        content: body.content,
        createdAt: new Date().toISOString(),
      };

      await runner.contexts.addContext(contextId, entry);
      return c.json(entry, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.delete("/api/context/:contextId", async (c) => {
    try {
      await runner.contexts.clearContext(c.req.param("contextId"));
      return c.json({ deleted: true });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Evals
  // ═══════════════════════════════════════════════════════════════════

  app.post("/api/evals/:agentId/run", async (c) => {
    try {
      const agentId = c.req.param("agentId");
      const body = await c.req.json().catch(() => ({}));

      const result = await runner.eval(agentId, {
        testCases: body.testCases,
      });

      return c.json(result);
    } catch (error: unknown) {
      const status =
        error instanceof Error && error.constructor.name === "AgentNotFoundError"
          ? 404
          : 500;
      return c.json({ error: errorMessage(error) }, status);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Logs
  // ═══════════════════════════════════════════════════════════════════

  app.get("/api/logs", async (c) => {
    try {
      const filter: Record<string, unknown> = {};
      const agentId = c.req.query("agentId");
      const sessionId = c.req.query("sessionId");
      const since = c.req.query("since");
      const limit = c.req.query("limit");
      const offset = c.req.query("offset");

      if (agentId) filter.agentId = agentId;
      if (sessionId) filter.sessionId = sessionId;
      if (since) filter.since = since;
      if (limit) filter.limit = parseInt(limit, 10);
      if (offset) filter.offset = parseInt(offset, 10);

      const logs = await runner.logs.getLogs(filter);
      return c.json(logs);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  app.get("/api/logs/:id", async (c) => {
    try {
      const log = await runner.logs.getLog(c.req.param("id"));
      if (!log) {
        return c.json({ error: `Log "${c.req.param("id")}" not found` }, 404);
      }
      return c.json(log);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 500);
    }
  });

  return app;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
