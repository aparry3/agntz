# Slice 9 — Skills

## Context

Today an LLM agent's behavior is fully determined by its YAML manifest: one system prompt, one fixed tool list. If two agents both need "research with citations," that prompt and the `web_search` / `fetch_url` tools have to be inlined into each agent. There is no way to share the playbook.

**Skills** are reusable, composable instruction+tool bundles that LLM agents can opt into mid-run. A `SkillDefinition` is a named bundle of `(description, instructions, tools)` stored independently of agents. An LLM agent declares `skills: [name1, name2]` in its manifest; at runtime the agent sees each skill's name and description in its system prompt and may call a synthetic `use_skill("name")` tool to load the skill's instructions and tools into the current run. Once loaded, the skill's tools are usable for the rest of the run. At end-of-run, the heavy skill content is redacted from the persisted session so subsequent runs in the same session can re-load fresh without context bloat.

Conceptually this is closest to Claude Code's `Skill` tool — markdown-style invocation that injects content — extended to also carry tools. It is *not* a sub-agent: no separate loop, no isolated context, no return value. The skill augments the calling agent in place.

## Goals (in scope for this slice)

- `SkillDefinition` type, Zod schema, and YAML format consistent with existing `examples/agents/*.yaml`
- `SkillStore` interface (CRUD, per-user, no versioning v1) with backends: memory, JSON-file, SQLite, Postgres
- Skill validator: structural (`validateSkill`) + reference integrity (`validateSkillFull`), separate from the agent validator
- `skills: string[]` field on `LLMAgentManifest` with structural + reference validation
- Runtime: synthetic `use_skill` tool registered on LLM agents with non-empty `skills`; mid-run tool registration; system-prompt augmentation
- End-of-run redaction of `use_skill` tool results in the worker's session-persist path
- 2 example skill YAMLs + 1 example agent that uses them
- Tests: conformance, unit, integration, e2e smoke

## Out of scope (deferred to later slices)

- HTTP CRUD endpoints on the worker for `SkillStore` (Slice 10)
- App UI in `packages/app` (Slice 11)
- Skill versioning + version activation
- Skill input parameters / input schemas
- Skills loading other skills

## Design

### 1. Data model

```typescript
// packages/core/src/types.ts
export interface SkillDefinition {
  name: string;            // lowercase-kebab-case, unique per user, identifier
  description: string;     // surfaced to the LLM
  instructions: string;    // returned as the use_skill tool result
  tools?: ToolReference[]; // reuses existing union: inline | mcp | agent
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillStore {
  getSkill(name: string): Promise<SkillDefinition | null>;
  listSkills(): Promise<Array<{ name: string; description: string }>>;
  putSkill(skill: SkillDefinition): Promise<void>;
  deleteSkill(name: string): Promise<void>;
}

export class SkillNotFoundError extends Error { /* name, message */ }
```

Skills use only `name` as identifier (no separate `id` like `AgentDefinition`). No `kind`, no `model`, no `inputSchema`. `name` regex: `^[a-z][a-z0-9-]*$`.

### 2. YAML format

```yaml
# examples/skills/researcher.yaml
name: researcher
description: Web research with citation. Use when the agent needs to verify facts, gather sources, or summarize external information.
tools:
  - kind: local
    tools: [web_search, fetch_url]
instructions: |
  You are now in research mode. When asked to research a topic:
  1. Search broadly first with web_search (3+ queries with varied phrasing).
  2. Read promising results with fetch_url.
  3. Verify each claim against at least 2 independent sources.
  4. Cite sources inline as [domain.com](full-url).
```

### 3. Agent integration

```yaml
# examples/agents/researcher-bot.yaml
kind: llm
id: researcher-bot
name: Researcher Bot
model: { provider: anthropic, name: claude-sonnet-4-6 }
instruction: |
  You are a helpful assistant. For any task that needs external research,
  load the researcher skill before answering.
skills:
  - researcher
  - summarizer
```

`LLMAgentManifest` gains `skills?: string[]`. `normalizeLLM` reads it, defaults to `[]`. `validateManifest` checks it's a string array of valid names. `validateManifestFull` resolves every name against `SkillStore`.

### 4. Runtime data flow

```
1. Run starts for agent with skills: [researcher, summarizer].
2. Runner builds the tool registry from agent.tools[].
3. Runner registers synthetic use_skill tool with input
   z.object({ skill: z.enum(["researcher", "summarizer"]) }).
4. Runner builds the system prompt. Appends an "Available skills" section
   listing name + description only (NOT instructions or tools).
5. LLM may call use_skill("researcher"):
   a. Fetch SkillDefinition from SkillStore.
   b. If already in ctx.loadedSkills, return { alreadyLoaded: true }.
   c. Otherwise add name to ctx.loadedSkills.
   d. Register skill.tools[] into the runner's tool registry via
      ToolRegistry.registerToolReferences().
   e. Return { name, description, instructions } as the tool result.
6. LLM's next turn sees the instructions in the tool result and the
   expanded tool list. It uses skill tools as needed.
7. Run ends. Worker's session-persist path calls
   redactSkillToolResults(messages) before storing: every use_skill tool
   result has its `instructions` replaced with
   "[skill 'X' was loaded earlier — call use_skill('X') to re-load]".
   The tool-call message itself is preserved verbatim.
8. Next run in same session: history shows use_skill was called, but
   instructions and tools are gone. LLM may re-call use_skill to re-load.
```

### 5. Critical files

**`@agntz/core`** — `packages/core/`
- `src/types.ts` (edit) — add `SkillDefinition`, `SkillStore`, `SkillNotFoundError`
- `src/skill.ts` (new) — `defineSkill()`, `normalizeSkill()`
- `src/tools/use-skill.ts` (new) — `createUseSkillTool()`, modeled on `src/tools/spawn-agent.ts:77-100`
- `src/runner.ts` (edit) — register `use_skill` synthetically near the existing MCP / `spawn_agent` registration block (around lines 1030-1074); augment system prompt; add `loadedSkills: Set<string>` to `ToolContext`
- `src/tool.ts` (edit) — extract resolution logic into `ToolRegistry.registerToolReferences(refs)` method usable mid-run
- `src/stores/memory.ts` (edit) — `MemoryStore.skills(userId)`
- `src/stores/json-file.ts` (edit) — `JsonFileStore.skills(userId)`; persist under `skills` key
- `src/index.ts` (edit) — barrel exports

**`@agntz/manifest`** — `packages/manifest/`
- `src/types.ts` (edit) — `skills?: string[]` on `LLMAgentManifest`
- `src/parser.ts` (edit) — `normalizeLLM` reads `skills`
- `src/validate.ts` (edit) — structural skills array check
- `src/skill-parser.ts` (new) — `parseSkill(yaml): SkillDefinition`
- `src/skill-validate.ts` (new) — `validateSkill` + `validateSkillFull`

**`@agntz/worker`** — `packages/worker/`
- `src/routes.ts` (edit) — thread `SkillStore` into `resolveRunnerAndManifest`
- `src/session-redact.ts` (new) — `redactSkillToolResults(messages)`

**`@agntz/store-sqlite`** — `packages/store-sqlite/`
- `src/skill-store.ts` (new) — SQLite-backed `SkillStore`
- `migrations/XXXX_skills.sql` (new) — table with composite `(user_id, name)` primary key, JSON payload

**`@agntz/store-postgres`** — `packages/store-postgres/`
- `src/skill-store.ts` (new) — Postgres-backed `SkillStore`
- `migrations/XXXX_skills.sql` (new) — parallel schema, `jsonb` payload

**Examples & docs**
- `examples/skills/researcher.yaml`, `examples/skills/summarizer.yaml` (new)
- `examples/agents/researcher-bot.yaml` (new)
- `docs/guide/runner-architecture.md` (edit) — short section on skills + mid-run tool registration

### 6. Reuse from existing code

- `ToolReference` union (`packages/core/src/types.ts:36-39`) — skills reuse this for their `tools` field; no new tool kinds
- `createSpawnAgentTool()` pattern (`packages/core/src/tools/spawn-agent.ts:77-100`) — `createUseSkillTool` mirrors its `z.enum(idEnum)` validation and `defineTool` shape
- `MemoryStore` / `JsonFileStore` per-user `.agents(userId)` pattern — directly mirrored for `.skills(userId)`
- `validateManifestFull` reference-integrity pattern — extended with skill-existence check using the same error / aggregation conventions
- Session-persist hook in `packages/worker/src/routes.ts` (the existing trim-strategy path) — `redactSkillToolResults` runs before whichever trim strategy is configured

### 7. Validation rules

- **`validateSkill` (sync, structural):** name format, description non-empty, instructions non-empty, tool references conform to `ToolReferenceSchema`. Called inside `SkillStore.putSkill` so structurally-invalid skills never persist.
- **`validateSkillFull` (async, reference integrity):** every `tools` entry resolves — inline tools exist in registry, MCP servers reachable, agent-as-tool references resolve in `AgentStore`. Specific error per missing item.
- **Agent-side:** `validateManifestFull` is extended to look up every `skills[]` name in `SkillStore` and aggregate `SkillNotFoundError` for missing names. Saving an agent with unknown skill names is allowed (deferred resolution), but running it fails fast.

## Verification

Run after implementation:

```bash
pnpm --filter @agntz/core test
pnpm --filter @agntz/manifest test
pnpm --filter @agntz/worker test
pnpm --filter @agntz/store-sqlite test
pnpm --filter @agntz/store-postgres test
pnpm -r build
pnpm -r typecheck
```

**Test coverage**

- `packages/core/tests/skill.test.ts` — `defineSkill` accepts/rejects fixtures
- `packages/core/tests/stores/skill-store-conformance.test.ts` — single suite parameterized over memory, json-file, sqlite, postgres (same pattern as the new `run-store-conformance.test.ts`)
- `packages/core/tests/tools/use-skill.test.ts` — load, idempotent re-load, missing skill, tool registration side-effect
- `packages/core/tests/runner-skills.test.ts` — fake LLM emits `use_skill` on turn 1, calls a skill-provided tool on turn 2; assert tool is unavailable on turn 0 and available on turn 2; assert system prompt contains skill name + description only
- `packages/manifest/tests/skill-validate.test.ts` — structural failures, full-validation missing-tool / missing-MCP / missing-agent errors
- `packages/worker/tests/session-redact.test.ts` — feed messages containing `use_skill` tool results, verify `instructions` is replaced with placeholder while tool-call message is verbatim
- `packages/worker/tests/skills-e2e.test.ts` — smoke: put skill, put agent, run agent, verify session store has the redacted message

**Manual smoke (after green tests)**

```bash
# In one terminal: start the worker
pnpm --filter @agntz/worker dev

# In another: use the SDK directly (no HTTP endpoint yet in slice 9)
# 1. PUT a skill via SkillStore
# 2. PUT an agent that declares skills: [researcher]
# 3. POST /run with that agent + a prompt that needs research
# 4. Verify the run completes and a session-store query shows the redacted message
```
