# How the Agent Runner Works — A Layered Walkthrough

> A top-down breakdown of `@agntz`'s runtime: the agent loop, pipeline composition, tool & MCP execution, and session/streaming. Each section starts at altitude and zooms into code.

---

## Layer 0 — The 30-Second Picture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         APP (Next.js)                                │
│   • UI, auth, /api routes, calls worker over HTTP                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  POST /run | /run/stream  (SSE)
                               │  X-Internal-Secret + userId
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       WORKER (Hono HTTP)                             │
│   packages/worker — owns execution, system agents, MCP, tools        │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  resolveRunnerAndManifest → createRunner({ store, tools })  │   │
│   │  createExecutionContext(runner) → execute(manifest, input)  │   │
│   └────────────────────────┬────────────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                MANIFEST EXECUTOR  (packages/manifest)                │
│   Dispatches by kind: llm | tool | sequential | parallel             │
│   State is threaded between steps; LLM steps call the bridge         │
└────────────────────────────┬────────────────────────────────────────┘
                             │  ctx.invokeLLM(manifest, instr, state)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CORE RUNNER  (packages/core)                      │
│   buildMessages → agent loop → toolRegistry.execute → repeat         │
│   Persists session, logs, context. Streams text-delta + tool events. │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        AISDKModelProvider  ToolRegistry   MCPClientManager
        (ai SDK + Zod)      (inline tools) (HTTP/SSE transport)
```

Three packages do the heavy lifting:

| Package | Responsibility |
|---|---|
| `@agntz/core` | The Runner: agent loop, message building, tool registry, MCP client, model provider, stores |
| `@agntz/manifest` | Declarative agent kinds (llm / tool / sequential / parallel), state plumbing |
| `@agntz/worker` | Hono HTTP service that creates per-user runners and exposes `/run`, `/run/stream`, `/validate`, `/system/*` |

The **Next.js app** (`packages/app`) is the UI/CRUD layer — it never touches the agent loop directly. Everything funnels through the worker.

---

## Layer 1 — Anatomy of One Agent Run

A single user message becomes:

```
 user input
     │
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ 1. buildMessages()                                            │
 │    system  ← agent.systemPrompt + examples + context entries  │
 │    history ← sessionStore.getMessages(sessionId)  (trimmed)   │
 │    user    ← input  (templated if userPromptTemplate set)     │
 └──────────────────────────────────────────────────────────────┘
     │
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ 2. AGENT LOOP   (max 10 steps)                                │
 │                                                               │
 │      ┌─────────────┐     toolCalls?                           │
 │      │ model call  │──────► no ──► finalOutput = text  → DONE │
 │      └──────┬──────┘                                          │
 │             │ yes                                             │
 │             ▼                                                 │
 │      ┌─────────────┐                                          │
 │      │ execute each│   ── append assistant + tool results ──┐ │
 │      │ tool_use    │      to messages, loop again           │ │
 │      └─────────────┘                                        │ │
 │             ▲                                               │ │
 │             └───────────────────────────────────────────────┘ │
 └──────────────────────────────────────────────────────────────┘
     │
     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ 3. Persist                                                    │
 │    sessionStore.append(sid, [user, ...sessionLoopMessages])   │
 │    contextStore.add(...) for any context buckets              │
 │    logStore.log({ tokens, toolCalls, duration, error })       │
 └──────────────────────────────────────────────────────────────┘
```

Every numbered box maps to a section below.

---

## Layer 2 — The Core Runner (`packages/core/src/runner.ts`)

### Public surface

`runner.ts:58-122` — the `Runner` class is constructed via `createRunner(config)`. It pulls four stores (`agent`, `session`, `context`, `log`) from a unified store or a default `MemoryStore`, instantiates the model provider, and lazily constructs an `MCPClientManager` if servers are configured.

Key methods:

| Method | Purpose |
|---|---|
| `invoke(agentId, input, opts)` | Synchronous run — returns `InvokeResult` once the loop terminates |
| `stream(agentId, input, opts)` | Async iterable of `StreamEvent`s + a `result` promise |
| `registerAgent(agent)` / `registerTool(tool)` | In-memory registration (vs. store-persisted) |
| `eval(agentId, opts)` | Run an evaluation suite |
| `shutdown()` | Tears down MCP clients |

There are also `.agents`, `.sessions`, `.contexts`, `.logs`, `.providers`, `.connections`, `.model`, `.tools`, `.mcp` getters used by the Studio UI to introspect.

### Where the loop lives

The synchronous loop is in `runner.ts:728-882` (the `invoke` method); the streaming variant is in `runner.ts:309-623` (`stream`). They are nearly identical — the streaming version yields `StreamEvent`s as it goes.

```ts
// runner.ts ~728  (synchronous invoke)
const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;   // = 10

while (step < maxSteps) {
  step++;
  if (options.signal?.aborted) throw new InvocationCancelledError();

  result = await withRetry(
    () => this.modelProvider.generateText({
      model: modelConfig,
      messages,
      tools: availableTools.length > 0 ? availableTools : undefined,
      outputSchema,
      signal: options.signal,
    }),
    this.config.retry, options.signal,
  );

  totalUsage.promptTokens     += result.usage.promptTokens;
  totalUsage.completionTokens += result.usage.completionTokens;
  totalUsage.totalTokens      += result.usage.totalTokens;

  const hasToolCalls = !!result.toolCalls?.length;

  if (hasToolCalls) {
    for (const tc of result.toolCalls!) {
      const toolCtx: ToolContext = {
        agentId, sessionId, contextIds, invocationId,
        invoke: (id, inp, o) => this.invoke(id, inp, {
          ...o, _recursionDepth: (o?._recursionDepth ?? currentDepth) + 1,
        }),
        ...(options.toolContext ?? {}),
      };
      try   { output = await this.toolRegistry.execute(tc.name, tc.args, toolCtx); }
      catch (err) { error = String(err); output = { error }; }
      // …record + push to toolResults
    }
  }

  // capture for session
  sessionLoopMessages.push({ role: "assistant", content: result.text ?? "", toolCalls: stepToolCalls, ... });
  for (const tr of toolResults) sessionLoopMessages.push({ role: "tool", content: tr.result, toolCallId: tr.id, ... });

  if (!hasToolCalls) { finalOutput = result.text; break; }      // ← termination 1

  // append to in-loop messages and continue
  messages.push({ role: "assistant", content: result.text ?? "" });
  messages.push({ role: "assistant",
    content: result.toolCalls!.map(tc => `[Tool Call: ${tc.name}(${JSON.stringify(tc.args)})]`).join("\n"),
  });
  for (const tr of toolResults) messages.push({ role: "tool", content: tr.result });

  if (result.finishReason === "stop" && result.text) {           // ← termination 2
    finalOutput = result.text; break;
  }
}
```

**Three ways the loop ends:**

1. **No tool calls** in the latest model response → that text is the final answer.
2. **`finishReason === "stop"` with text** even after tool calls → model is done.
3. **`step >= maxSteps`** → throw `MaxStepsExceededError` (default cap 10, see `runner.ts:48-49`).

### Recursion safety

Each tool execution receives a `ToolContext` that carries `_recursionDepth`. When a tool is itself an agent (the "agent-as-tool" pattern), `ctx.invoke()` increments depth and throws `MaxRecursionDepthError` past `DEFAULT_MAX_RECURSION_DEPTH = 3` (`runner.ts:51-52`). This stops a misbehaving sub-agent from hammering the loop indefinitely.

### Message building (`packages/core/src/message-builder.ts:7-87`)

```
system:  agent.systemPrompt
       + "\n## Examples\n"  (if agent.examples)
       + "<context id="…"> entries </context>"  (per context bucket)
       + "<extra-context>…</extra-context>"     (if provided)

history: sessionStore.getMessages(sessionId)  →  trim by strategy
         (kept verbatim, including [Tool Call: …] assistant lines)

user:    input  (or userPromptTemplate.replace("{{input}}", input))
```

The history is trimmed by `runner.ts:675-689`:
- `"sliding"` (default) — keep last N (`maxMessages`, default 50)
- `"summary"` — `trimHistoryWithSummary` uses the model itself to compress old messages
- `"none"` — keep everything

### Model provider (`packages/core/src/model-provider.ts:7-206`)

`AISDKModelProvider` wraps Vercel's `ai` SDK (`generateText` / `streamText`). It:

1. Resolves the model via `ProviderStore` (per-user keys) or env vars (`ANTHROPIC_API_KEY`, etc.).
2. Converts each tool's JSON Schema → Zod (the AI SDK wants Zod for `inputSchema`).
3. Builds an optional `experimental_output` from `agent.outputSchema` for structured output.
4. Calls the model and normalizes the response into `{ text, toolCalls, usage, finishReason }`.

Supported providers (lines 148-206): OpenAI, Anthropic, Google, Mistral, xAI, Groq, DeepSeek, Perplexity, Cohere, Azure.

---

## Layer 3 — Pipeline Construction (the manifest layer)

Agents are not all "LLM-with-tools." A manifest declares one of four `kind`s, and the **executor dispatches** (`packages/manifest/src/executor.ts:38-56`):

```
                     ┌───────────────────────────┐
                     │  AgentManifest (YAML)     │
                     │  kind: llm|tool|seq|par   │
                     └────────────┬──────────────┘
                                  │
        ┌───────────┬─────────────┼─────────────┬───────────┐
        ▼           ▼                           ▼           ▼
    executeLLM  executeTool              executeSequential  executeParallel
        │           │                           │           │
        │           │                           │     branches[] run via
        │           │                           │     Promise.all,
        │           │                       steps[] run in     state[k] merged
        │           │                       order, each step's
        │           │                       output threaded into next
        │           │
        │     calls ctx.invokeTool(...)  → bridge → toolRegistry.execute
        │
        └─→ ctx.invokeLLM(manifest, instruction, state)
                └─→ bridge registers a temp agent, calls runner.invoke()
                    → THIS is where the Layer 2 loop runs
```

### The four kinds (`packages/manifest/src/types.ts:5-124`)

```ts
type AgentKind = "llm" | "tool" | "sequential" | "parallel";

interface LLMAgentManifest        { kind: "llm";        model; instruction; tools?; outputSchema?; … }
interface ToolAgentManifest       { kind: "tool";       tool: { kind: "mcp"|"local"; server?; name; params? } }
interface SequentialAgentManifest { kind: "sequential"; steps: StepRef[]; until?; maxIterations?; output? }
interface ParallelAgentManifest   { kind: "parallel";   branches: StepRef[]; output? }
```

### Sequential composition (`pipeline/sequential.ts:10-78`)

Walk steps in order; each step's output is stashed under its `stateKey` and becomes `previousOutput` for the next. `when` clauses skip steps; `until` + `maxIterations` make the whole sequence loop (with a hard cap of 100 by default).

```ts
do {
  for (const step of manifest.steps) {
    if (step.when && !evaluateCondition(step.when, state)) { state[key] = null; continue; }
    const childManifest = await resolveStepAgent(step, ctx);
    const childInput    = applyInputTransform(step.input, state, previousOutput);
    const result        = await executeWithState(childManifest, createInitialState(childInput, …), ctx, childInput);
    state[getStateKey(step)] = result.output;
    previousOutput = result.output;
  }
  iteration++;
} while (isLoop && !evaluateCondition(manifest.until!, state) && iteration < maxIterations);
```

### Parallel composition (`pipeline/parallel.ts:8-45`)

Every branch sees the same `parentInput`; results are merged into `state` once all `Promise.all` settle. Use `output:` mapping to project to a clean shape, otherwise you get `{ branchKey: branchOutput }` for each.

### LLM step (`pipeline/llm.ts:7-23`)

```ts
export async function executeLLM(manifest, state, ctx) {
  const instruction = renderTemplate(manifest.instruction, state);   // mustache-y
  const output      = await ctx.invokeLLM(manifest, instruction, state);
  return { output, state: { ...state } };
}
```

`ctx.invokeLLM` is implemented by **the bridge** — that's how the manifest layer gets back into the core runner.

---

## Layer 4 — Tools and MCP

### Tool definition

Local tools use `defineTool({ name, description, input: z.object({…}), execute(input, ctx) })` (`packages/core/src/tool.ts:8-24`). Example — the `read_file` tool the worker ships (`packages/worker/src/tools/read-file.ts`):

```ts
const __dirname = dirname(fileURLToPath(import.meta.url));
// tsup bundles into dist/chunk-*.js, so __dirname is packages/worker/dist/.
// Resolve INTO defaults/ — don't walk up.
const REFS_DIR = resolve(__dirname, "defaults/agents/agent-builder");

export const readFileTool = defineTool({
  name: "read_file",
  description: "Read a bundled reference file and return its contents as a string",
  input: z.object({ path: z.string().describe("…relative to bundled refs") }),
  async execute(input) {
    const filePath = resolve(REFS_DIR, input.path);
    if (!filePath.startsWith(REFS_DIR)) throw new Error(`Access denied`);
    return readFile(filePath, "utf-8");
  },
});
```

This is the **fix in commit `364466e`**: previously the path used `../defaults` plus `process.env.DOCS_DIR`, which broke because tsup-bundled output runs from `dist/` — walking up escaped the bundle. The current code resolves *into* `dist/defaults/agents/agent-builder/` (which tsup copies in at build time) and adds a startsWith guard to prevent `../` traversal.

### Registry and dispatch

`ToolRegistry` (`packages/core/src/tool.ts:30-137`) stores `{ definition, info }`. On `register()` it converts the Zod schema → JSON Schema (that's what the model sees). On `execute(name, input, ctx)` it Zod-validates the input then calls `definition.execute`.

The runner pulls available tools per-call from `runner.ts ~700` based on the agent's `tools:` list, calls into the model with their JSON Schema, and dispatches each `tool_use` block back into `toolRegistry.execute` (see Layer 2 loop).

### Tool flow visualized

```
   model returns toolCalls = [ { id, name, args }, … ]
              │
              ▼
   ┌──────────────────────────────────────────┐
   │  for each tc:                            │
   │    toolCtx = { agentId, sessionId, …,    │
   │                invoke: <recurse-guard> } │
   │    output = toolRegistry.execute(        │
   │        tc.name, tc.args, toolCtx)        │
   │    record { id, name, input, output,     │
   │             duration, error }            │
   └──────────────────────────────────────────┘
              │
              ▼
   append to messages:
     assistant: "[Tool Call: read_file({\"path\":…})]"
     tool:      <stringified output>
              │
              ▼
   loop back into model
```

### MCP integration

MCP support lives in `packages/core/src/mcp/`:

- `client-manager.ts` — `MCPClientManager` holds N named connections.
- Transport: **HTTP/SSE** via `@modelcontextprotocol/sdk/client/streamableHttp.js` (no stdio subprocesses, despite that being the more common MCP shape).

Server config (`types.ts:346-351`):

```ts
interface MCPServerConfig { url: string; headers?: Record<string,string> }
mcp?: { servers: Record<string, MCPServerConfig> }
```

**Lazy connect** (`runner.ts:128-134`) — servers don't dial until the first `invoke` that needs them. **Discovery** (`client-manager.ts:142-165`) — calls `client.listTools()` and wraps each into an `MCPTool` with `execute(input)` that calls `client.callTool({ name, arguments })`.

**Merging with built-ins** (`runner.ts:1030-1074` — `resolveMCPTools`):

```ts
for (const mcpTool of mcpTools) {
  const qualifiedName = `mcp__${serverName}__${mcpTool.name}`;
  if (!this.toolRegistry.get(qualifiedName)) {
    this.toolRegistry.register({
      name: qualifiedName,
      description: mcpTool.description,
      input: z.object({}).passthrough(),     // MCP enforces its own schema
      async execute(input) { return mcpTool.execute(input); },
    });
  }
  resolved.push({ name: qualifiedName, description, parameters: mcpTool.inputSchema });
}
```

So MCP tools become **synthetic inline tools** with a `mcp__<server>__<tool>` name. From the loop's perspective there is no difference between local and MCP tools — same registry, same dispatch.

Server resolution (`runner.ts:1010-1024`) checks the `ConnectionStore` first (per-user MCP server registrations) and falls back to treating the ref as a raw URL.

### Tool sources at a glance

| Source | Schema seen by model | Validation | Notes |
|---|---|---|---|
| Inline (`defineTool`) | Zod → JSON Schema | Zod parse on input | Worker registers `LOCAL_TOOLS` (`registry.ts`) |
| MCP | JSON Schema from `listTools()` | Performed by MCP server | Wrapped as `mcp__<server>__<tool>` |
| Agent-as-tool | `{ input: string }` | None | Calls `ctx.invoke(subAgentId, input)` with depth check |

---

## Skills

A **skill** is a reusable bundle of `(description, instructions, tools)`, stored independently of agents and referenced by name. An LLM agent opts in by listing skills in its manifest:

```yaml
# examples/agents/researcher-bot.yaml
kind: llm
skills:
  - researcher
  - summarizer
```

The agent sees only each skill's `name` + `description` in its system prompt — under an "Available skills" section — never the full instructions or the skill's tool list. The skill stays dormant until the LLM decides to load it.

### The synthetic `use_skill` tool

When an LLM agent has `skills: [a, b, c]`, the runner auto-registers a synthetic tool named `use_skill` alongside the agent's other tools. Its input schema is allowlisted to the declared names via a Zod enum:

```ts
z.object({ skill: z.enum(["a", "b", "c"]) })
```

This means the model literally cannot call `use_skill` for a skill the agent didn't declare — wrong names fail Zod validation before `execute` runs. The tool is modeled on `createSpawnAgentTool` (`packages/core/src/tools/spawn-agent.ts:77-100`), which uses the same enum pattern.

### Mid-run tool registration

Calling `use_skill("researcher")` does three things in one shot:

1. Fetches the `SkillDefinition` from `SkillStore`.
2. Calls `ToolRegistry.registerToolReferences(skill.tools)` — the same path agent setup uses. The registry is idempotent: re-registering an already-present tool is a no-op, so a second skill declaring the same MCP tool is fine.
3. Returns `{ name, description, instructions }` as the tool result, so the LLM's next turn sees the skill's full playbook.

From the loop's perspective the new tools are indistinguishable from tools registered at run start. The next model call's available-tools list expands automatically.

### Per-run de-duplication

`ToolContext` carries a `loadedSkills: Set<string>`. `use_skill` checks it before doing any work; a repeat call returns `{ alreadyLoaded: true }` without re-hitting the store or re-registering tools. This keeps the LLM from burning turns re-loading the same skill.

### Session redaction

A loaded skill's `instructions` can be long. To keep session history small, the worker's session-persist path runs `redactSkillToolResults` (`packages/worker/src/session-redact.ts`) before storing the run. For every `use_skill` tool result, `instructions` is rewritten to:

```
[skill 'X' was loaded earlier — call use_skill('X') to re-load]
```

The tool-call message itself is preserved verbatim, so on the next run in the same session the LLM still sees that it called `use_skill("X")` and can re-call it if it needs the instructions back.

### YAML pointer

See `examples/skills/*.yaml` for skill manifests and `examples/agents/researcher-bot.yaml` for an agent that declares them.

---

## Layer 5 — Worker, Sessions, and Streaming

### The worker boundary (PR #13, commit `7627106`)

The worker is a Hono HTTP service (`packages/worker/src/routes.ts`). Routes:

| Method + Path | Auth | Purpose |
|---|---|---|
| `GET  /health` | none | Liveness |
| `POST /run` | `workerAuth` | Synchronous invoke, JSON response |
| `POST /run/stream` | `workerAuth` | SSE stream of run events |
| `POST /validate` | `workerAuth` | Full manifest validation incl. MCP reachability |
| `GET  /system/agents` | `internalOnlyAuth` | List bundled system agents (e.g., agent-builder) |
| `GET  /system/agents/:id` | `internalOnlyAuth` | Get YAML + parsed manifest |

`workerAuth` (`middleware/auth.ts:21-46`) accepts either:
- **Internal:** `X-Internal-Secret` header + `userId` in body — used by the Next.js app's `/api` routes.
- **External:** `Authorization: Bearer ar_live_…` — looked up against `ar_api_keys.key_hash` to resolve a user.

The PR #13 cleanup made this boundary crisp: app reads UI state, worker owns *all* execution. The app no longer reads YAML from disk, no longer instantiates MCP clients, and no longer duplicates tool name lists. Anything execution-related goes through HTTP.

### Per-request setup

```ts
// routes.ts (POST /run, /run/stream)
const userId  = getUserId(c);                   // from auth middleware
const scoped  = store.forUser(userId);          // row-level scoping
const tools   = [...LOCAL_TOOLS];               // worker-bundled tools
const runner  = createRunner({ store: scoped, tools, defaults });
const ctx     = createExecutionContext(runner, { sessionId });
const result  = await execute(manifest, input ?? "", ctx);   // manifest layer
```

Note: a fresh `Runner` is created **per request**, scoped to the user. Studios that want long-lived runners would build them at the app boundary; the worker keeps it stateless.

### The bridge (`packages/worker/src/bridge.ts`)

The bridge is what closes the loop between the manifest executor and the core runner:

- `invokeLLM(manifest, instruction, state)` — registers a temp `AgentDefinition` from the LLM manifest and calls `runner.invoke()` with the rendered instruction. Parses structured output if `outputSchema` was set.
- `invokeTool(toolRef)` — routes manifest `tool:` references (kind `local` or `mcp`) into the runner's tool registry.
- `resolveAgent(id)` — loads stored agent YAML and parses to a manifest.

So a "sequential agent with three LLM steps" becomes: executor calls `invokeLLM` three times → each call boots the Layer-2 loop → tool calls + MCP happen inside each → state flows between the steps.

### Sessions

A "session" is a conversation thread (`types.ts:177-191`):

```ts
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallRecord[];
  toolCallId?: string;
  timestamp: string;
}
```

`SessionStore` interface (`types.ts:376-381`): `getMessages`, `append`, `deleteSession`, `listSessions`. Two backends:

- **MemoryStore** (`stores/memory.ts`) — per-user `Map<sessionId, SessionRow>`. Default for dev.
- **PostgresStore** (`packages/store-postgres/src/postgres-store.ts`) — `ar_sessions` + `ar_messages` tables, every row tagged with `user_id`. Selected via `STORE=postgres` env (`packages/worker/src/store.ts:9-32`).

Lifecycle:

```
client → POST /run { agentId, input, sessionId? }
         (sessionId generated server-side if absent: randomUUID())
                   │
                   ▼
runner.invoke()
   load     sessionStore.getMessages(sid) → trim (sliding | summary | none)
   build    buildMessages(...)
   loop     [Layer 2]
   capture  sessionLoopMessages = [ assistant…, tool…, assistant…, tool… ]
   append   sessionStore.append(sid, [ {role:"user",input}, ...sessionLoopMessages ])
   log      logStore.log({ tokens, toolCalls, duration, error })
                   │
                   ▼
return InvokeResult / yield "done" event
```

### Streaming (SSE)

**Producer** (`routes.ts:135-177`):

```ts
app.post("/run/stream", async (c) => {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "run-start",   data: JSON.stringify({ agentId, kind, sessionId }) });
    const result = await execute(manifest, input ?? "", ctx);
    await stream.writeSSE({ event: "run-complete",data: JSON.stringify({ output: result.output, state, sessionId }) });
  });
});
```

The runner itself emits finer-grained events through `runner.stream()` (`runner.ts:309-623`):

```ts
type StreamEvent =
  | { type: "text-delta";       text: string }
  | { type: "tool-call-start";  toolCall: { id, name } }
  | { type: "tool-call-end";    toolCall: ToolCallRecord }
  | { type: "step-complete";    step; toolCalls }
  | { type: "done";             result: InvokeResult };
```

**Consumer** (`packages/app/src/lib/worker-client.ts:54-74`):

```ts
export async function workerRunStream(req): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${WORKER_URL}/run/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Secret": internalSecret() },
    body: JSON.stringify(req),
  });
  return res.body!;        // raw SSE; UI parses events
}
```

```
   worker                                       app
   ──────                                       ───
   streamSSE                                    fetch().body (ReadableStream)
     │ event: run-start    {agentId,sid}  ─────►   parse SSE frames
     │ event: text-delta   {text:"hi "}   ─────►   append to assistant bubble
     │ event: text-delta   {text:"there"} ─────►
     │ event: tool-call-start {id,name}   ─────►   show "running tool…"
     │ event: tool-call-end   {…record}   ─────►   render tool result
     │ event: run-complete {output,state} ─────►   finalize
     ▼ close
```

### Pause / resume

There's **no explicit checkpointing**. What works:

- Pass the same `sessionId` on a follow-up `/run` and you get the full prior history loaded and trimmed.
- If a client disconnects mid-stream, the server still finishes the loop and persists `sessionLoopMessages` *after* the loop completes. Next call with that `sessionId` picks up cleanly.

What doesn't work:

- A tool call interrupted mid-execution by a process crash. The session append is a single `append()` at the end of the run, not per-step — so a crash mid-loop loses everything since the last user message.

---

## Layer 6 — A Concrete End-to-End Trace

User says "summarize my notes for last week" to a `notes-agent` via the chat UI:

```
1.  app/api/agents/run/stream/route.ts
       → workerRunStream({ agentId:"notes-agent", input:"summarize…", sessionId:"abc" })

2.  POST /run/stream  (worker)
       → workerAuth resolves userId from X-Internal-Secret + body.userId
       → resolveRunnerAndManifest(store, userId, "notes-agent")
            • store.forUser(userId)
            • load YAML, parseManifest → SequentialAgentManifest
            • createRunner({ store: scoped, tools: LOCAL_TOOLS })
       → createExecutionContext(runner, { sessionId: "abc" })
       → execute(manifest, input, ctx)            // manifest executor

3.  executeSequential
       step 1: kind:"llm" "fetch"     → ctx.invokeLLM → runner.invoke
                  Layer-2 loop:
                    model → tool_use("mcp__notion__search", {q:"last week"})
                    toolRegistry.execute → MCPClientManager → notion.callTool
                    model → text "[3 notes found]"
                  returns array
       step 2: kind:"llm" "summarize" → ctx.invokeLLM → runner.invoke
                  Layer-2 loop:
                    model → text "Summary: …"   (no tools)
                  returns string

4.  state ends as { fetch: [...], summarize: "Summary: …" }
       output mapping projects to "Summary: …"

5.  streamSSE writes "run-complete" → app finalizes assistant bubble
       runner.invoke() (called twice) appended to session "abc" each time
       logStore.log() recorded usage and durations
```

---

## Critical files cheatsheet

| File | What's there |
|---|---|
| `packages/core/src/runner.ts` | Runner class, agent loop (`:728-882` sync, `:309-623` stream), MCP resolve (`:1010-1074`) |
| `packages/core/src/message-builder.ts` | `buildMessages`, `trimHistory` |
| `packages/core/src/model-provider.ts` | `AISDKModelProvider` (`generateText`/`streamText`) |
| `packages/core/src/tool.ts` | `defineTool`, `ToolRegistry` |
| `packages/core/src/mcp/client-manager.ts` | MCP HTTP/SSE transport, tool discovery |
| `packages/core/src/types.ts` | `Message`, `SessionStore`, `MCPServerConfig`, `ModelProvider`, `StreamEvent` |
| `packages/manifest/src/types.ts` | `AgentManifest` union, the four `kind`s |
| `packages/manifest/src/executor.ts` | Dispatcher (`executeWithState`) |
| `packages/manifest/src/pipeline/{llm,tool,sequential,parallel}.ts` | Per-kind runners |
| `packages/worker/src/routes.ts` | Hono routes: `/run`, `/run/stream`, `/validate`, `/system/*` |
| `packages/worker/src/bridge.ts` | `createExecutionContext`, `invokeLLM`, `invokeTool` |
| `packages/worker/src/middleware/auth.ts` | `workerAuth`, `internalOnlyAuth` |
| `packages/worker/src/tools/read-file.ts` | `read_file` tool with bundled-path fix (`364466e`) |
| `packages/worker/src/store.ts` | Backend selection (`STORE=memory|postgres`) |
| `packages/store-postgres/src/postgres-store.ts` | Postgres schema + migrations v1–v5 |
| `packages/app/src/lib/worker-client.ts` | App → worker HTTP client |
