# Agent Manifest Examples

YAML manifest examples demonstrating each agent kind and feature. See [docs/schema.md](../../docs/schema.md) for the full schema reference.

The **Agent Builder** (`agent-builder`) is a built-in default agent that ships with the worker and is automatically seeded on startup. Its source lives in `packages/worker/src/defaults/agents/`.

## Examples

| File | Kind | Demonstrates |
|------|------|-------------|
| [chatbot.yaml](chatbot.yaml) | `llm` | Simplest agent — no inputSchema, plain string input as `{{userQuery}}` |
| [sentiment-analyzer.yaml](sentiment-analyzer.yaml) | `llm` | Structured input (`inputSchema`), structured output (`outputSchema`), few-shot examples |
| [with-tools.yaml](with-tools.yaml) | `llm` | MCP tools, local tools, tool wrapping with pinned params |
| [send-email.yaml](send-email.yaml) | `tool` | Deterministic tool call, no LLM — params mapped from state |
| [research-pipeline.yaml](research-pipeline.yaml) | `sequential` | Multi-step pipeline, inline agents, conditional step (`when`), output mapping |
| [text-analysis.yaml](text-analysis.yaml) | `parallel` | Concurrent branches, inline agents, merged output |
| [write-review-loop.yaml](write-review-loop.yaml) | `sequential` (loop) | `until` condition, `maxIterations`, `{{#if}}` template conditionals |
| [article-pipeline.yaml](article-pipeline.yaml) | `sequential` (composed) | Full composition: parallel research → looped write/review → tool notification |
| [researcher-bot.yaml](researcher-bot.yaml) | `llm` | Declares `skills: [...]`; loads instructions and tools mid-run via `use_skill` (see [../skills/](../skills/)) |
