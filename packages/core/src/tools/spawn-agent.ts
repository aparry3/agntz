import { z } from "zod";
import type {
  AgentDefinition,
  AgentRef,
  RunHandle,
  RunRegistry,
  ToolContext,
  ToolDefinition,
} from "../types.js";

/**
 * Limits applied per parent Run when spawning children.
 */
export interface SpawnLimits {
  /** Maximum simultaneously-running children of any single parent (default 8). */
  maxConcurrentChildren: number;
  /** Maximum depth in the Run tree (default 5; 0 = root only). */
  maxDepth: number;
  /** Maximum total Runs in the entire subtree rooted at this Run (default 50). */
  maxDescendants: number;
}

export const DEFAULT_SPAWN_LIMITS: SpawnLimits = {
  maxConcurrentChildren: 8,
  maxDepth: 5,
  maxDescendants: 50,
};

/**
 * Resolves an `AgentRef[]` (the agent's `spawnable` field) into a concrete
 * map of `agent_id` → human-readable description. Inline definitions are
 * registered into the `registerInline` callback so the host runner can
 * resolve them later. Refs are validated against the store.
 */
export interface SpawnableEntry {
  /** The id the LLM passes to spawn_agent. */
  agentId: string;
  /** Human-readable description for the tool's enum description. */
  summary: string;
}

export async function resolveSpawnable(
  spawnable: AgentRef[],
  helpers: {
    /** Resolves a stored agent by id. */
    resolveStored: (id: string) => Promise<AgentDefinition | null>;
    /** Registers an inline definition with the host runner. */
    registerInline: (def: AgentDefinition) => void;
  },
): Promise<SpawnableEntry[]> {
  const out: SpawnableEntry[] = [];
  for (const ref of spawnable) {
    if (ref.kind === "ref") {
      const stored = await helpers.resolveStored(ref.agentId);
      const summary = stored
        ? stored.description ?? stored.systemPrompt.slice(0, 120)
        : `(unresolved) ${ref.agentId}`;
      out.push({ agentId: ref.agentId, summary });
    } else {
      const def = ref.definition;
      helpers.registerInline(def);
      const summary =
        def.description ?? def.systemPrompt.slice(0, 120);
      out.push({ agentId: def.id, summary });
    }
  }
  return out;
}

/**
 * Build the `spawn_agent` tool. Returns null if `entries` is empty.
 *
 * `agent_id` is constrained at runtime to the parent's allowlist via the
 * Zod enum. The model sees a description that enumerates each child by
 * id + summary, so it can pick intelligently.
 */
export function createSpawnAgentTool(
  entries: SpawnableEntry[],
  limits: SpawnLimits = DEFAULT_SPAWN_LIMITS,
): ToolDefinition | null {
  if (entries.length === 0) return null;

  const ids = entries.map((e) => e.agentId);
  const idEnum = ids as [string, ...string[]];

  const description = [
    "Spawn a sub-agent that will run concurrently with you.",
    "Returns a handle immediately — the sub-agent's output arrives later as a notification.",
    "You can continue thinking or spawning more agents while it runs. You will be forced to wait for outstanding children before finishing.",
    "Available agents:",
    ...entries.map((e) => `  - ${e.agentId}: ${oneLine(e.summary)}`),
  ].join("\n");

  return {
    name: "spawn_agent",
    description,
    input: z.object({
      agent_id: z.enum(idEnum).describe("Which sub-agent to invoke (must be from the allowlist)."),
      input: z.string().describe("The task / question / input to send to the sub-agent."),
    }),
    async execute(input, ctx) {
      const { agent_id, input: childInput } = input as {
        agent_id: string;
        input: string;
      };

      const registry = (ctx as ToolContext).runRegistry;
      const parentRunId = (ctx as ToolContext).runId;
      if (!registry || !parentRunId) {
        return {
          ok: false,
          error: "spawn_agent requires the runner to be wired with a runRegistry; parent has no runId.",
        };
      }

      // Permission re-check (defense in depth).
      if (!ids.includes(agent_id)) {
        return { ok: false, error: `agent_id "${agent_id}" is not in this agent's spawnable allowlist.` };
      }

      // Depth check
      const parentRun = registry.get(parentRunId);
      if (parentRun && parentRun.depth >= limits.maxDepth) {
        return {
          ok: false,
          error: `maxDepth (${limits.maxDepth}) reached at depth ${parentRun.depth}. Cannot spawn deeper.`,
        };
      }

      // Concurrent-children check
      const outstanding = registry.outstandingChildrenCount(parentRunId);
      if (outstanding >= limits.maxConcurrentChildren) {
        return {
          ok: false,
          error: `maxConcurrentChildren (${limits.maxConcurrentChildren}) reached. Wait for at least one child to settle before spawning more.`,
        };
      }

      // Subtree size check
      if (parentRun) {
        const rootId = parentRun.rootId;
        const subtreeSize = countSubtree(registry, rootId);
        if (subtreeSize >= limits.maxDescendants) {
          return {
            ok: false,
            error: `maxDescendants (${limits.maxDescendants}) reached for this Run subtree.`,
          };
        }
      }

      const child = registry.create({
        agentId: agent_id,
        input: childInput,
        parentRunId,
        userId: (ctx as ToolContext).userId,
        // spawnToolUseId omitted: the existing runner doesn't thread tool_use_id
        // through ToolContext yet. Future change.
      });

      // Fire-and-forget execution. The registry handles completion bookkeeping.
      registry.start(child, async (signal) => {
        return ctx.invoke(agent_id, childInput, {
          runRegistry: registry,
          runId: child.id,
          parentRunId,
          userId: (ctx as ToolContext).userId,
          sessionId: child.sessionId,
          signal,
        });
      });

      const handle: RunHandle = {
        run_id: child.id,
        agent_id,
        status: "running",
      };
      return handle;
    },
  };
}

/**
 * Build the `check_agents` tool. Returns null if `entries` is empty (i.e.
 * spawn_agent isn't registered either, so check_agents is meaningless).
 */
export function createCheckAgentsTool(
  entries: SpawnableEntry[],
): ToolDefinition | null {
  if (entries.length === 0) return null;

  return {
    name: "check_agents",
    description:
      "Check the status of previously-spawned sub-agents. " +
      "Returns each requested run's current status and (for completed/failed/cancelled) output or error. " +
      "If `run_ids` is omitted, returns status for all of this agent's children. " +
      "Note: completed children are also delivered automatically as notifications between turns — " +
      "you only need to call this if you want to poll mid-thought.",
    input: z.object({
      run_ids: z
        .array(z.string())
        .optional()
        .describe("Specific run_ids to query. If omitted, returns all your spawned children."),
    }),
    async execute(input, ctx) {
      const { run_ids } = input as { run_ids?: string[] };
      const registry = (ctx as ToolContext).runRegistry;
      const parentRunId = (ctx as ToolContext).runId;
      if (!registry || !parentRunId) {
        return { ok: false, error: "check_agents requires a runRegistry on the parent Run." };
      }

      const candidates = run_ids
        ? (run_ids.map((id) => registry.get(id)).filter(Boolean) as Array<NonNullable<ReturnType<typeof registry.get>>>)
        : registry.children(parentRunId);

      // Filter to only this parent's direct children (security: agents shouldn't see
      // other Runs).
      const allowed = candidates.filter((r) => r.parentId === parentRunId);

      return allowed.map((r) => ({
        run_id: r.id,
        agent_id: r.agentId,
        status: r.status,
        output: r.result?.output,
        error: r.error,
      }));
    },
  };
}

function countSubtree(registry: RunRegistry, rootId: string): number {
  // Walk the tree starting at rootId.
  const root = registry.get(rootId);
  if (!root) return 0;
  let total = 1;
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    const kids = registry.children(id);
    total += kids.length;
    for (const k of kids) stack.push(k.id);
  }
  return total;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 200);
}
