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
| `skills` | `string[]` | | Skill names the agent may load mid-run via `use_skill`. See [Skills](/guide/05-skills) |
| `spawnable` | `AgentRef[]` | | Sub-agents this agent may spawn concurrently via `spawn_agent`. See [Runs](/guide/08-runs) |
| `examples` | `Example[]` | | Few-shot examples — `Array<{ input: string; output: string }>` |
| `userPromptTemplate` | `string` | | Template with `{{input}}` placeholder; wraps user input |
| `outputSchema` | `JsonSchema` | | Structured output constraint |
| `contextWrite` | `boolean` | | Auto-write output to context |
| `tags` | `string[]` | | Categorization tags |
| `metadata` | `Record<string, unknown>` | | Custom metadata |

Full type at `packages/core/src/types.ts:9-58`.

### Skills + spawnable example

```typescript
defineAgent({
  id: "orchestrator",
  name: "Research Orchestrator",
  systemPrompt: "You coordinate research tasks across sub-agents.",
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
  skills: ["citation-style", "summarization"],
  spawnable: [
    { kind: "ref", agentId: "researcher" },
    { kind: "ref", agentId: "fact-checker" },
  ],
  tools: [{ type: "inline", name: "save_note" }],
});
```

The runner auto-registers `use_skill` (if `skills` is non-empty) and `spawn_agent` + `check_agents` (if `spawnable` is non-empty) alongside the agent's other tools. See [Tools](/guide/04-tools#synthetic-tools) for how these work.

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
const persistentRunner = createRunner({
  store: persistentStore,
});
persistentRunner.registerAgent(agent); // Saved to the configured store
```

## Portability

Since agents are JSON data, you can:

- **Version them** in git alongside your code
- **Store them** in a database for dynamic management
- **Share them** across services or teams
- **Create them** in the Studio UI and use them in code
- **Export/import** between environments
