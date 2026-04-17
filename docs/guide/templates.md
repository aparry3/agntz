# Agent Templates

agntz ships with **8 starter templates** for common agent patterns. Use them as starting points — customize the system prompt, model, and tools to match your needs.

## Using Templates

```typescript
import { createRunner, defineAgent } from "agntz";
import { templates } from "agntz/templates";

const runner = createRunner();

// Use a template directly (provide your own id)
runner.registerAgent(defineAgent({
  ...templates.chatbot,
  id: "my-bot",
}));

// Or customize it
runner.registerAgent(defineAgent({
  ...templates.fitnessCoach,
  id: "coach",
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
  tools: [
    { type: "inline", name: "get_workout" },
    { type: "inline", name: "log_workout" },
  ],
}));
```

## Available Templates

### `chatbot`

A friendly conversational assistant. Good starting point for general-purpose bots.

| Field | Value |
|-------|-------|
| Model | `openai/gpt-5.4-mini` |
| Temperature | Default |
| Context Write | No |

**System prompt highlights:** Concise, clear, honest about knowledge limits.

---

### `codeReviewer`

Reviews code for bugs, style issues, and improvements. References line numbers, explains reasoning.

| Field | Value |
|-------|-------|
| Model | `anthropic/claude-sonnet-4-6` |
| Temperature | Default |
| Context Write | No |

**Best paired with:** MCP tools for file access (`@anthropic/mcp-fs`), GitHub tools for PR review.

---

### `summarizer`

Distills long content into structured summaries with key points, details, and a concise overview.

| Field | Value |
|-------|-------|
| Model | `openai/gpt-5.4-mini` |
| Temperature | Default |
| Context Write | No |

**Output format:** Summary section → Key Points (bullets) → Details.

---

### `dataExtractor`

Extracts structured data from unstructured text. Uses `temperature: 0` for precision.

| Field | Value |
|-------|-------|
| Model | `openai/gpt-5.4-mini` |
| Temperature | 0 |
| Context Write | No |

**Best paired with:** `outputSchema` for structured JSON output.

```typescript
runner.registerAgent(defineAgent({
  ...templates.dataExtractor,
  id: "invoice-parser",
  outputSchema: {
    type: "object",
    properties: {
      vendor: { type: "string" },
      amount: { type: "number" },
      date: { type: "string" },
      items: { type: "array", items: { type: "object" } },
    },
  },
}));
```

---

### `creativeWriter`

Generates blog posts, stories, marketing copy, and emails. Higher temperature (0.8) for creativity.

| Field | Value |
|-------|-------|
| Model | `anthropic/claude-sonnet-4-6` |
| Temperature | 0.8 |
| Context Write | No |

---

### `customerSupport`

Handles customer inquiries with empathy. Designed to use tools for data lookup rather than guessing.

| Field | Value |
|-------|-------|
| Model | `openai/gpt-5.4` |
| Temperature | Default |
| Context Write | No |

**Best paired with:** `lookup_order`, `lookup_customer`, `create_ticket` tools.

---

### `fitnessCoach`

The **gymtext pattern** — AI fitness coaching with context-aware personalization. Writes to context for continuity across sessions.

| Field | Value |
|-------|-------|
| Model | `anthropic/claude-sonnet-4-6` |
| Temperature | Default |
| Context Write | **Yes** |

**Best paired with:** `get_workout`, `log_workout`, `update_fitness` tools + user context buckets.

See the [gymtext example](https://github.com/aparryopenclaw/agntz/tree/main/examples/gymtext) for a full implementation.

---

### `researcher`

Thorough information gathering with source attribution. Writes findings to context for other agents to consume.

| Field | Value |
|-------|-------|
| Model | `openai/gpt-5.4` |
| Temperature | Default |
| Context Write | **Yes** |

**Best paired with:** Web search tools, MCP browser tools, and a `writer` agent that reads the research context.

---

## Custom Templates

Templates are just partial `AgentDefinition` objects. Create your own:

```typescript
// my-templates.ts
import type { AgentDefinition } from "agntz";

type AgentTemplate = Omit<AgentDefinition, "id"> & { id?: string };

export const myTemplate: AgentTemplate = {
  name: "My Custom Agent",
  systemPrompt: "...",
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
  tools: [{ type: "inline", name: "my_tool" }],
  contextWrite: true,
};
```

Templates are just data — they compose naturally with spreads and overrides.
