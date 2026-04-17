# Migrating to agntz (gymtext)

This guide shows how to replace a custom AI system with agntz, using the gymtext fitness coaching app as a concrete example.

## Before: Custom AI Code

A typical custom AI integration looks like this:

```typescript
// Before: scattered across your codebase
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function handleMessage(userId: string, message: string, sessionId: string) {
  // Manual history management
  const history = await db.messages.findMany({ where: { sessionId } });

  // Manual system prompt construction
  const userProfile = await db.users.findUnique({ where: { id: userId } });
  const systemPrompt = buildSystemPrompt(userProfile);

  // Manual tool definitions (provider-specific format)
  const tools = [
    { name: "get_workout", description: "...", input_schema: { ... } },
    { name: "log_workout", description: "...", input_schema: { ... } },
  ];

  // Manual tool execution loop
  let response = await client.messages.create({
    model: "claude-sonnet-4-6",
    system: systemPrompt,
    messages: history,
    tools,
  });

  while (response.stop_reason === "tool_use") {
    const toolCall = response.content.find(c => c.type === "tool_use");
    const result = await executeTool(toolCall.name, toolCall.input);
    // ... manual message appending, re-calling the model, etc.
  }

  // Manual history persistence
  await db.messages.create({ data: { sessionId, role: "assistant", content: response.content } });

  return extractText(response);
}
```

**Problems:**
- Tool definitions are provider-specific JSON (not portable)
- History management is manual and error-prone
- No way to test agents independently
- Switching models requires rewriting tool schemas
- No shared context between different AI features

## After: agntz

### 1. Install

```bash
pnpm add agntz
```

### 2. Define Your Agents

```typescript
// agents.ts
import { defineAgent, defineTool } from "agntz";
import { z } from "zod";

// ═══ Tools ═══

export const getWorkout = defineTool({
  name: "get_workout",
  description: "Generate a personalized workout for the user",
  input: z.object({
    type: z.enum(["strength", "cardio", "flexibility", "hiit"]),
    duration: z.number().optional().describe("Target duration in minutes"),
  }),
  async execute(input, ctx) {
    // ctx.user comes from toolContext — no global state needed
    const userId = ctx.user.id;
    return await ctx.invoke("workout-generator", JSON.stringify(input), {
      contextIds: [`users/${userId}/fitness`, "global/exercises"],
    });
  },
});

export const logWorkout = defineTool({
  name: "log_workout",
  description: "Log a completed workout",
  input: z.object({
    exercises: z.array(z.object({
      name: z.string(),
      sets: z.number().optional(),
      reps: z.number().optional(),
      weight: z.number().optional(),
    })),
    notes: z.string().optional(),
  }),
  async execute(input, ctx) {
    await db.workouts.create({
      data: { userId: ctx.user.id, ...input, date: new Date() },
    });
    return { logged: true, count: input.exercises.length };
  },
});

// ═══ Agents ═══

export const chatAgent = defineAgent({
  id: "chat",
  name: "GymText Coach",
  systemPrompt: `You are GymText, an AI personal trainer...`,
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
  tools: [
    { type: "inline", name: "get_workout" },
    { type: "inline", name: "log_workout" },
  ],
});

export const workoutGenerator = defineAgent({
  id: "workout-generator",
  name: "Workout Generator",
  systemPrompt: `Generate personalized workouts based on user context...`,
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
});
```

### 3. Create Your Runner

```typescript
// runner.ts
import { createRunner } from "agntz";
import { chatAgent, workoutGenerator, getWorkout, logWorkout } from "./agents";

export const runner = createRunner({
  // Use JsonFileStore for prototyping, switch to SQLite/Postgres later
  store: new JsonFileStore("./data"),
  tools: [getWorkout, logWorkout],
});

runner.registerAgent(chatAgent);
runner.registerAgent(workoutGenerator);
```

### 4. Use in Your API Routes

```typescript
// routes/message.ts (Express, Hono, Next.js — whatever you use)
import { runner } from "../runner";

app.post("/api/message", async (req, res) => {
  const { userId, message, sessionId } = req.body;

  const result = await runner.invoke("chat", message, {
    sessionId,                          // agntz handles history
    contextIds: [`users/${userId}`],    // shared context, auto-injected
    toolContext: {                      // runtime data for tools
      user: await db.users.findUnique({ where: { id: userId } }),
    },
  });

  res.json({
    reply: result.output,
    tokens: result.usage.totalTokens,
  });
});
```

That's it. **5 files, clean separation, testable agents.**

## What You Get for Free

| Concern | Before (custom) | After (agntz) |
|---------|-----------------|---------------------|
| History management | Manual DB queries, manual trimming | Automatic (sliding window or summary) |
| Tool execution loop | Manual while loop, provider-specific | Built-in, model-agnostic |
| Tool schemas | Hand-written JSON Schema per provider | Zod → auto-generated |
| Context sharing | Custom global state / DB queries | Named context buckets, auto-injection |
| Model switching | Rewrite tool schemas + API calls | Change one string (`model.provider`) |
| Testing | Mock everything manually | `runner.eval()` with assertions |
| Dev UI | None | `npx agntz studio` |
| Observability | Custom logging | Built-in logs + optional OpenTelemetry |

## Switching Stores

Start simple, scale later:

```typescript
// Development
import { JsonFileStore } from "agntz";
const store = new JsonFileStore("./data");

// Production (single server)
import { SqliteStore } from "@agntz/store-sqlite";
const store = new SqliteStore("./agntz.db");

// Production (multi-server)
import { PostgresStore } from "@agntz/store-postgres";
const store = new PostgresStore(pool);
```

Just change one line — same runner, same agents, same tools.

## Adding the Studio

During development, add the Studio for a visual UI:

```bash
pnpm add -D @agntz/studio
npx agntz studio
```

This gives you:
- **Agent Editor** — edit system prompts, model config, tool assignments
- **Playground** — test agents with different inputs, sessions, and context
- **Tool Catalog** — browse all available tools with their schemas
- **Logs** — inspect every invocation with full input/output
- **Evals** — run test suites and track pass rates

## Adding Evals

Test your agents like you test your code:

```typescript
const chatAgent = defineAgent({
  id: "chat",
  // ... agent config ...
  eval: {
    testCases: [
      {
        name: "generates workout on request",
        input: "Give me a leg day workout",
        assertions: [
          { type: "contains", value: "squat" },
          { type: "llm-rubric", value: "Response includes a structured workout with sets and reps" },
        ],
      },
      {
        name: "acknowledges logged workout",
        input: "I just did 3 sets of bench press at 185lbs",
        assertions: [
          { type: "llm-rubric", value: "Response acknowledges the workout and is encouraging" },
        ],
      },
    ],
    passThreshold: 0.8,
  },
});
```

Run evals:
```bash
npx agntz eval chat
# Or in CI:
npx agntz eval --all --json --threshold 0.8
```

## Key Differences from Custom Code

1. **Agents are data, not code.** You can store them in a DB, version them, edit them in the Studio — the runtime is separate from the definition.

2. **Tools are portable.** A tool defined once works with any agent, any model provider. No rewriting schemas.

3. **Context is explicit.** Instead of ad-hoc DB queries scattered through your prompt builder, context is a named system that agents declare and the runtime manages.

4. **Sessions are automatic.** Pass a `sessionId` and agntz handles load, append, and trim.

5. **Testing is built in.** No mocking the entire AI stack — `runner.eval()` runs your agent through test cases with real or mock models.
