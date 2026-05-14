# Manifests

A **manifest** is a declarative spec for an agent — YAML or JSON that parses into an `AgentManifest` discriminated union. The `@agntz/manifest` package provides the parser and the executor: parse a manifest, hand it to `execute()` with an `ExecutionContext`, and the executor dispatches across four agent kinds.

`AgentDefinition` (from `@agntz/core`) is for code-driven agents that live in memory or a store. `AgentManifest` (from `@agntz/manifest`) is for declarative agents typically stored as YAML files. They overlap heavily but serve different niches — the worker uses manifests because agents in agntz are ultimately data, and YAML is friendlier to humans and version control than serialized JSON.

## The four kinds

```typescript
// packages/manifest/src/types.ts:5-14
type AgentKind = "llm" | "tool" | "sequential" | "parallel";

type AgentManifest =
  | LLMAgentManifest         // Calls an LLM with tools
  | ToolAgentManifest        // Calls a single tool, no LLM
  | SequentialAgentManifest  // Runs sub-agents in order, threading state
  | ParallelAgentManifest;   // Runs sub-agents concurrently, merging state
```

| Kind | Use when |
|---|---|
| `llm` | The "normal" agent — LLM + tools + optional skills + optional structured output |
| `tool` | Lightweight wrapper that just calls one tool (local or MCP). No LLM in the loop |
| `sequential` | Multi-step pipeline; step N's output feeds step N+1 via state |
| `parallel` | Fan-out — branches run via `Promise.all`, results merged into state |

## Shared fields

Every manifest has these (`packages/manifest/src/types.ts:17-24`):

```typescript
interface AgentManifestBase {
  id: string;
  name?: string;
  description?: string;
  kind: AgentKind;
  inputSchema?: InputSchema;
  stateKey?: string;
}
```

`stateKey` controls where this agent's output lands when it runs inside a sequential or parallel parent. `inputSchema` is a flat property map for runtime validation.

## LLM agent

The workhorse (`packages/manifest/src/types.ts:65-85`):

```yaml
id: researcher
kind: llm
model:
  provider: anthropic
  name: claude-sonnet-4-6
  temperature: 0.4
instruction: |
  You research topics thoroughly. Return findings as bullet points.
tools:
  - kind: mcp
    server: web-search
  - kind: local
    tools: [read_file]
skills:
  - citation-style
spawnable:
  - kind: ref
    agentId: fact-checker
outputSchema:
  findings:
    type: array
  confidence:
    type: number
```

Cross-references:
- `tools` syntax — see [tools chapter](/guide/04-tools)
- `skills` — see [skills chapter](/guide/05-skills)
- `spawnable` — see [agent chains](/guide/agent-chains) and [runs chapter](/guide/08-runs)
- `outputSchema` — flat property map; constrains structured output

The `instruction` field is what `AgentDefinition.systemPrompt` is to a core SDK agent. It supports template substitution from runtime state (`{{state.fieldName}}`) when run inside a pipeline.

## Tool agent

For wrapping a single tool with a friendly name (`packages/manifest/src/types.ts:113-123`):

```yaml
id: fetch-page
kind: tool
tool:
  kind: mcp
  server: browser
  name: fetch_html
  params:
    url: "{{state.url}}"
```

No LLM involved — the executor calls `ctx.invokeTool(config, state)` directly. Useful as a leaf step inside a sequential pipeline.

## Sequential agent

A pipeline (`packages/manifest/src/types.ts:129-135`):

```yaml
id: research-and-summarize
kind: sequential
steps:
  - ref: researcher
    input:
      topic: "{{input}}"
    stateKey: research

  - ref: summarizer
    input:
      content: "{{state.research.findings}}"
    stateKey: summary

output:
  summary: "{{state.summary}}"
```

Each step's output is stashed under its `stateKey` and becomes available to subsequent steps as `{{state.<key>}}`. The `output` mapping projects state into a final shape.

Optional fields:
- `when` on a step skips it conditionally (`when: "{{state.research.confidence > 0.5}}"`)
- `until` + `maxIterations` (default 100) turn the whole sequence into a loop

## Parallel agent

Fan-out (`packages/manifest/src/types.ts:141-145`):

```yaml
id: multi-perspective
kind: parallel
branches:
  - ref: optimist
    stateKey: pro
  - ref: pessimist
    stateKey: con
  - ref: neutral-analyst
    stateKey: balanced

output:
  pro: "{{state.pro}}"
  con: "{{state.con}}"
  balanced: "{{state.balanced}}"
```

All branches see the same `parentInput`; results merge into `state` once every `Promise.all` settles. Without an `output` mapping you get `{ [branchKey]: branchOutput }` for each branch.

## Step references

In sequential `steps` and parallel `branches`, a `StepRef` is either a reference to a stored agent or an inline definition (`packages/manifest/src/types.ts:151-162`):

```yaml
# Reference an existing agent by id
- ref: researcher

# Or define inline
- agent:
    id: ad-hoc-extractor
    kind: llm
    model: { provider: openai, name: gpt-5.4-mini }
    instruction: "Extract dates from: {{input}}"
```

## Parsing

`parseManifest(yamlString)` (`packages/manifest/src/parser.ts:17-25`) parses YAML → `AgentManifest` and normalizes the result:

```typescript
import { parseManifest } from "@agntz/manifest";

const yaml = await readFile("researcher.yaml", "utf-8");
const manifest = parseManifest(yaml);
// → typed AgentManifest, ready to execute
```

`validateManifestFull(yamlString, ctx)` (`packages/manifest/src/validate.ts`) does the same plus deep validation — referenced agents exist, MCP servers are reachable (if `strict: true`), skills resolve, etc. The worker uses it on the `POST /validate` route (`packages/worker/src/routes.ts:98-119`).

## Execution

`execute(manifest, input, ctx)` (`packages/manifest/src/executor.ts`) is the top-level entry point. It dispatches by `kind`:

```
                     ┌───────────────────────────┐
                     │      AgentManifest         │
                     │  kind: llm|tool|seq|par   │
                     └────────────┬──────────────┘
                                  │
        ┌───────────┬─────────────┼─────────────┬───────────┐
        ▼           ▼             ▼             ▼
    executeLLM  executeTool  executeSequential  executeParallel
        │           │             │             │
        │           │             │             ▼ branches[] run via
        │           │             ▼ steps[] run in    Promise.all,
        │           │             order, each step's   state merged
        │           │             output threaded
        │           │             into next via state
        │           │
        │     calls ctx.invokeTool(config, state) → bridge
        │
        └─→ ctx.invokeLLM(manifest, instruction, state)
                └─→ bridge calls core runner.invoke()
                    → core agent loop runs (model + tools + MCP)
```

The four executors live in `packages/manifest/src/pipeline/{llm,tool,sequential,parallel}.ts`.

## ExecutionContext — the bridge

The executor needs three things from the host:

```typescript
// packages/manifest/src/types.ts:213-227
interface ExecutionContext {
  resolveAgent: (id: string) => Promise<AgentManifest>;
  invokeLLM: (manifest: LLMAgentManifest, input: string, state: AgentState) => Promise<unknown>;
  invokeTool: (config: ToolCallConfig, state: AgentState) => Promise<unknown>;
  spanEmitter?: SpanEmitter;
  ownerId?: string;
}
```

This is intentionally minimal so the manifest package has no dependency on the core runner. The actual wiring — turning an LLM manifest into a temp `AgentDefinition` and calling `runner.invoke()` — lives in `packages/worker/src/bridge.ts`'s `createExecutionContext()`.

In other words:

```
@agntz/manifest  (declarative spec + executor)
       │
       │  ExecutionContext interface
       │  ctx.invokeLLM, ctx.invokeTool, ctx.resolveAgent
       │
@agntz/worker   (bridge implementation)
       │
       │  createExecutionContext(runner)
       │
@agntz/core     (runner.invoke + ToolRegistry + MCP)
```

See [Layer 3 of the runner architecture](/guide/14-runner-architecture#layer-3-pipeline-construction-the-manifest-layer) for the deep dive on how the bridge closes the loop.

## State and templating

State is a flat object that flows through a pipeline:

```typescript
type AgentState = Record<string, unknown>;
// Shape: { ...input, [stateKey]: subAgentOutput, ... }
```

Templates use `{{...}}` with state-path expressions. They're rendered by `packages/manifest/src/template.ts` before each step runs. `{{input}}` is the special parent input; `{{state.foo.bar}}` reaches into the accumulated state.

Conditions (`when:`, `until:`) use the same expression grammar via `packages/manifest/src/conditions.ts`.

## Examples in the repo

| File | What it shows |
|---|---|
| `examples/agents/researcher-bot.yaml` | An LLM agent declaring skills |
| `examples/agents/*.yaml` | More LLM agents |
| `examples/skills/*.yaml` | Skill manifests (parsed by `skill-parser.ts`) |
| `packages/worker/src/defaults/agents/agent-builder/` | The bundled system agents — real production manifests |

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/manifest/src/types.ts` | `AgentManifest`, the four kinds, `StepRef`, `ManifestToolEntry`, `ExecutionContext` |
| `packages/manifest/src/parser.ts` | `parseManifest`, `normalizeManifest` |
| `packages/manifest/src/validate.ts` | `validateManifestFull` (deep validation) |
| `packages/manifest/src/executor.ts` | `execute()` dispatcher |
| `packages/manifest/src/pipeline/llm.ts` | LLM step executor |
| `packages/manifest/src/pipeline/tool.ts` | Tool step executor |
| `packages/manifest/src/pipeline/sequential.ts` | Sequential pipeline |
| `packages/manifest/src/pipeline/parallel.ts` | Parallel pipeline |
| `packages/manifest/src/template.ts` | `{{...}}` template rendering |
| `packages/manifest/src/conditions.ts` | `when`/`until` expression evaluation |
| `packages/worker/src/bridge.ts` | `createExecutionContext` — the manifest ↔ runner bridge |
