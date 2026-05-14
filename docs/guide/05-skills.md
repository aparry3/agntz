# Skills

A **skill** is a reusable bundle of `(name, description, instructions, tools)` that an agent can load mid-run on demand. Skills decouple "how to do X" from "this agent does X" — the same skill can be referenced by many agents, and an agent only pays the token cost of a skill's instructions if and when the LLM decides to load it.

Skills are the agntz answer to the prompt-bloat problem: an agent that *might* need to do five different tasks can declare five skills, but each model turn only sees the skills it has already loaded plus a compact list of names it could load.

## At a glance

```
┌─ AgentDefinition ──────────────────────────┐
│ id: "support"                              │
│ systemPrompt: "..."                        │
│ skills: ["refund-policy", "tier-routing"]  │  ← skills the agent may load
│ tools: [{ type: "inline", name: "db_q" }]  │
└────────────────────────────────────────────┘

   At runtime, the runner registers a synthetic tool:
   ┌─ use_skill ──────────────────────────────┐
   │ input: { skill: "refund-policy" | "tier-routing" }
   │ on call:
   │   • fetch SkillDefinition from SkillStore
   │   • register skill.tools into the live registry
   │   • return { name, description, instructions }
   └──────────────────────────────────────────┘
```

The agent never sees the full instructions of an unloaded skill — only its `name` and `description` in the system prompt's "Available skills" section. The skill stays dormant until the model decides to call `use_skill("name")`.

## The SkillDefinition

`SkillDefinition` is the persisted data structure (`packages/core/src/types.ts:438-450`):

```typescript
interface SkillDefinition {
  /** lowercase-kebab-case, unique per user */
  name: string;
  /** Surfaced to the LLM in the "Available skills" section */
  description: string;
  /** Returned as the use_skill tool result when the LLM loads the skill */
  instructions: string;
  /** Tools registered into the live tool registry when the skill is loaded */
  tools?: ToolReference[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Must match `^[a-z][a-z0-9-]*$` — lowercase kebab-case. Validated by `defineSkill()` |
| `description` | yes | Shown to the LLM before it loads the skill. Make this the "would I want to load this?" pitch |
| `instructions` | yes | The full playbook. Surfaced to the LLM only when `use_skill` resolves |
| `tools` | no | `ToolReference[]` — inline, MCP, or agent refs. Registered into the live registry on load |

## Defining a skill

```typescript
import { defineSkill } from "agntz";

export const refundPolicy = defineSkill({
  name: "refund-policy",
  description: "Handles refund eligibility and processing per Acme's 30-day policy.",
  instructions: `When the user asks about a refund:
1. Look up the order with lookup_order.
2. If the order is < 30 days old AND not a final-sale item, eligible.
3. Otherwise, escalate to a human agent.`,
  tools: [
    { type: "inline", name: "lookup_order" },
    { type: "inline", name: "issue_refund" },
  ],
});
```

`defineSkill()` (`packages/core/src/skill.ts:9-30`) is a validator — it throws if `name` doesn't match the regex, if `description` or `instructions` are empty, or if any `ToolReference` is malformed. It does not persist; you push to the store separately.

## Storing skills

Skills live in the `SkillStore` (`packages/core/src/types.ts:452-457`):

```typescript
interface SkillStore {
  getSkill(name: string): Promise<SkillDefinition | null>;
  listSkills(): Promise<Array<{ name: string; description: string }>>;
  putSkill(skill: SkillDefinition): Promise<void>;
  deleteSkill(name: string): Promise<void>;
}
```

`UnifiedStore` includes `SkillStore`, so the same store backing your agents and sessions also backs skills. Per-user scoping applies — `store.forUser(userId).putSkill(...)` writes a skill owned by that user.

```typescript
await runner.store.forUser(userId).putSkill(refundPolicy);
```

## Declaring skills on an agent

Add a `skills: string[]` field to `AgentDefinition` listing the names the agent is allowed to load:

```typescript
defineAgent({
  id: "support",
  name: "Support Agent",
  systemPrompt: "You handle customer support for Acme. Use available skills.",
  model: { provider: "openai", name: "gpt-5.4" },
  skills: ["refund-policy", "tier-routing"],
  tools: [{ type: "inline", name: "lookup_order" }],
});
```

Names that don't exist in the store will fail at validation time when the agent is registered — never silently at run time.

## What the LLM sees

When the agent starts, the runner injects an "Available skills" section into the system prompt:

```
Available skills (call use_skill to load):
  - refund-policy: Handles refund eligibility and processing per Acme's 30-day policy.
  - tier-routing: Decides which support tier should own an inbound ticket.
```

And it registers the synthetic `use_skill` tool (`packages/core/src/tools/use-skill.ts:20-62`) whose input is constrained to that exact allowlist via a Zod enum:

```typescript
z.object({
  skill: z.enum(["refund-policy", "tier-routing"]),
})
```

Off-list names fail Zod validation before `execute` runs — the LLM cannot load skills outside the agent's declared list, even by accident.

## Mid-run loading

A `use_skill` call does three things in one shot (see [Layer 4 of the runner architecture](/guide/14-runner-architecture#skills) for the deep version):

1. Look up `SkillDefinition` in `SkillStore`.
2. Register `skill.tools` into the live `ToolRegistry` via the same path agent setup uses. Re-registering a tool that's already present is a no-op, so two skills sharing an MCP tool is fine.
3. Return `{ name, description, instructions }` to the LLM.

From the loop's perspective, the newly-registered tools are indistinguishable from tools registered at run start. The next model call's available-tools list expands automatically.

## Per-run de-duplication

`ToolContext` carries a `loadedSkills: Set<string>` (`packages/core/src/types.ts:117`). `use_skill` checks it before doing any work; a repeat call returns `{ alreadyLoaded: true, name }` without re-hitting the store or re-registering tools (`packages/core/src/tools/use-skill.ts:40-42`).

This keeps the LLM from burning turns re-loading the same skill if it forgets it already has the instructions.

## Session redaction

Skill instructions can be long — multi-paragraph playbooks aren't unusual. Storing the full instructions in every session message would explode session history.

The worker's session-persist path runs `wrapWithSkillRedaction` (`packages/worker/src/session-redact.ts`) before storing the run. For every `use_skill` tool result, `instructions` is rewritten to:

```
[skill 'refund-policy' was loaded earlier — call use_skill('refund-policy') to re-load]
```

The tool-call message itself is preserved verbatim, so on the next turn in the same session the LLM sees that it called `use_skill("refund-policy")` and can re-call it to get the instructions back. The model spends one extra turn re-loading instead of permanently bloating the session.

## YAML manifest form

Skills can also be declared on `LLMAgentManifest` in the YAML manifest format (`packages/manifest/src/types.ts:79-84`):

```yaml
# examples/agents/researcher-bot.yaml
id: researcher-bot
kind: llm
model:
  provider: anthropic
  name: claude-sonnet-4-6
instruction: |
  You research topics thoroughly. Pick the right skill for the task.
skills:
  - researcher
  - summarizer
```

The skill YAMLs themselves live in `examples/skills/*.yaml` and are parsed by `packages/manifest/src/skill-parser.ts`.

## When to use a skill vs. a tool vs. a sub-agent

| You want… | Use |
|---|---|
| A reusable function the LLM can call | **Tool** — always available, no extra step |
| A reusable playbook the LLM can opt into | **Skill** — loaded on demand, instructions become part of the prompt |
| A reusable agent the LLM can delegate to | **Agent-as-tool** — separate model call, separate context |
| Many concurrent sub-tasks | **`spawnable`** — see [agent chains](/guide/agent-chains) |

Skills are the right tool when the workflow is "the LLM should follow these steps in this situation" — the instructions need to enter the prompt, not run as code.

## Errors

`SkillNotFoundError` (`packages/core/src/errors.ts:182-193`) is thrown if `getSkill(name)` returns null at load time. The Zod enum on `use_skill` catches missing names earlier in practice, but the error exists for code paths that resolve skills outside the synthetic tool.

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/core/src/types.ts:438-457` | `SkillDefinition`, `SkillStore` |
| `packages/core/src/skill.ts` | `defineSkill()` validator |
| `packages/core/src/tools/use-skill.ts` | The synthetic `use_skill` tool |
| `packages/worker/src/session-redact.ts` | Skill instruction redaction in session history |
| `packages/manifest/src/skill-parser.ts` | YAML → `SkillDefinition` |
| `examples/skills/*.yaml` | Sample skill manifests |
