# Getting Started

## Installation

```bash
npm install agntz
# or
pnpm add agntz
# or
yarn add agntz
```

### Model Provider Setup

agntz uses the `ai` package for model abstraction. Install the provider SDK for your chosen model:

```bash
# OpenAI
npm install @ai-sdk/openai
export OPENAI_API_KEY=sk-...

# Anthropic
npm install @ai-sdk/anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Google
npm install @ai-sdk/google
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

::: tip No Vendor Lock-in
The `ai` package is just a client library — your API calls go directly to OpenAI/Anthropic/Google. No middleman, no proxy, no Vercel services involved. Switching providers is a one-line change.
:::

## Hello World

```typescript
import { createRunner, defineAgent } from "agntz";

const runner = createRunner();

runner.registerAgent(defineAgent({
  id: "greeter",
  name: "Greeter",
  systemPrompt: "You are a friendly greeter. Keep responses under 2 sentences.",
  model: { provider: "openai", name: "gpt-5.4-mini" },
}));

const result = await runner.invoke("greeter", "Hello!");
console.log(result.output);
// → "Hey there! Welcome — great to have you here."
```

That's it. Five lines of setup, one line to invoke.

## Adding Tools

```typescript
import { createRunner, defineAgent, defineTool } from "agntz";
import { z } from "zod";

const getWeather = defineTool({
  name: "get_weather",
  description: "Get current weather for a city",
  input: z.object({
    city: z.string().describe("City name"),
  }),
  async execute(input) {
    // Your implementation here
    return { temp: 72, condition: "sunny" };
  },
});

const runner = createRunner({ tools: [getWeather] });

runner.registerAgent(defineAgent({
  id: "assistant",
  name: "Weather Assistant",
  systemPrompt: "Help users with weather questions. Use the get_weather tool.",
  model: { provider: "openai", name: "gpt-5.4" },
  tools: [{ type: "inline", name: "get_weather" }],
}));

const result = await runner.invoke("assistant", "What's the weather in NYC?");
console.log(result.output);
console.log(result.toolCalls); // Shows the tool calls made
```

## Persistent Storage

By default, agntz uses in-memory storage. For persistence:

```typescript
import { createRunner, JsonFileStore } from "agntz";

const runner = createRunner({
  store: new JsonFileStore("./data"),
});
```

This creates a `./data` directory with agents, sessions, context, and logs stored as JSON files.

## Sessions (Conversations)

```typescript
// First message — creates session
await runner.invoke("assistant", "My name is Aaron", {
  sessionId: "chat-1",
});

// Second message — runner auto-loads history
const result = await runner.invoke("assistant", "What's my name?", {
  sessionId: "chat-1",
});
// → "Your name is Aaron!"
```

## Launch the Studio

```bash
npx agntz studio
```

Opens a visual development UI at `http://localhost:4000` where you can:
- Create and edit agents
- Browse available tools
- Test agents in a playground
- Run eval suites
- Browse sessions and logs

## Next Steps

- [Agents](/guide/agents) — Deep dive into agent definitions
- [Tools](/guide/tools) — Inline tools, MCP tools, and agent-as-tool
- [Context](/guide/context) — Shared state across agents
- [Evals](/guide/evals) — Test your agents
- [Studio](/studio/overview) — Visual development experience
