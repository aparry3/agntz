# Agents

An agent is a JSON-serializable configuration that defines AI behavior. This is agntz's core differentiator — agents are data, not code.

## Defining an Agent

```typescript
import { defineAgent } from "agntz";

const agent = defineAgent({
  id: "support",
  name: "Support Agent",
  description: "Handles customer support inquiries",
  version: "1.0.0",
  systemPrompt: "You are a helpful customer support agent for Acme Corp...",
  model: {
    provider: "anthropic",
    name: "claude-sonnet-4-6",
    temperature: 0.7,
    maxTokens: 2048,
  },
  tools: [
    { type: "inline", name: "lookup_order" },
    { type: "mcp", server: "crm" },
  ],
});
```

## Agent Definition Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique identifier |
| `name` | `string` | ✅ | Human-readable name |
| `systemPrompt` | `string` | ✅ | The agent's instructions |
| `model` | `ModelConfig` | ✅ | Model provider and name |
| `description` | `string` | | What this agent does |
| `version` | `string` | | Semantic version |
| `tools` | `ToolReference[]` | | Tools the agent can use |
| `examples` | `Example[]` | | Few-shot examples |
| `outputSchema` | `JsonSchema` | | Structured output constraint |
| `contextWrite` | `boolean` | | Auto-write output to context |
| `eval` | `EvalConfig` | | Evaluation configuration |
| `tags` | `string[]` | | Categorization tags |
| `metadata` | `Record<string, unknown>` | | Custom metadata |

## Model Configuration

```typescript
model: {
  provider: "openai",     // "openai" | "anthropic" | "google" | etc.
  name: "gpt-5.4",         // Model name
  temperature: 0.7,       // 0-2 (optional)
  maxTokens: 4096,        // Max output tokens (optional)
  topP: 0.9,              // Nucleus sampling (optional)
  options: {},             // Provider-specific options (optional)
}
```

Supported providers (via the `ai` package): OpenAI, Anthropic, Google, Mistral, Cohere, and 40+ others.

## Tool References

Agents reference tools by type, not by function pointer:

```typescript
tools: [
  // Inline tool (registered via defineTool + registerTool)
  { type: "inline", name: "lookup_order" },

  // All tools from an MCP server
  { type: "mcp", server: "github" },

  // Specific tools from an MCP server
  { type: "mcp", server: "github", tools: ["get_file_contents", "create_issue"] },

  // Another agent as a tool
  { type: "agent", agentId: "researcher" },
]
```

## Few-Shot Examples

```typescript
defineAgent({
  id: "classifier",
  name: "Sentiment Classifier",
  systemPrompt: "Classify the sentiment of the given text.",
  model: { provider: "openai", name: "gpt-5.4-mini" },
  examples: [
    { input: "I love this product!", output: "positive" },
    { input: "Terrible experience.", output: "negative" },
    { input: "It's okay I guess.", output: "neutral" },
  ],
});
```

## Structured Output

Constrain agent output to a specific JSON schema:

```typescript
defineAgent({
  id: "extractor",
  name: "Entity Extractor",
  systemPrompt: "Extract entities from text.",
  model: { provider: "openai", name: "gpt-5.4" },
  outputSchema: {
    type: "object",
    properties: {
      people: { type: "array", items: { type: "string" } },
      places: { type: "array", items: { type: "string" } },
      dates: { type: "array", items: { type: "string" } },
    },
    required: ["people", "places", "dates"],
  },
});
```

## Registering Agents

```typescript
const runner = createRunner();

// Register in code
runner.registerAgent(agent);

// Or use a store — agents persist across restarts
const runner = createRunner({
  store: new JsonFileStore("./data"),
});
runner.registerAgent(agent); // Saved to ./data/agents/support.json
```

## Portability

Since agents are JSON data, you can:

- **Version them** in git alongside your code
- **Store them** in a database for dynamic management
- **Share them** across services or teams
- **Create them** in the Studio UI and use them in code
- **Export/import** between environments
