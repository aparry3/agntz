# Agent Manifest Examples

YAML manifest examples demonstrating each agent kind and feature. See the
[schema reference](https://agntz.co/docs/schema/common-fields), the
[hosted AI guide](https://agntz.co/docs/hosted/provider-replacement), or the
[machine-readable JSON Schema](https://agntz.co/schemas/agent-manifest.schema.json)
for the complete contract.

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
| [social-transcription.yaml](social-transcription.yaml) | `transcription` | Managed audio input, manifest-controlled transcription prompt, and no-retention execution |
| [generated-recipe-cover.yaml](generated-recipe-cover.yaml) | `image` | Image generation with provider options and expiring output artifacts |
| [hosted-nutritionist-callback.yaml](hosted-nutritionist-callback.yaml) | `llm` | Typed signed application callback with trusted runtime identity |

The `transcription` and `image` examples require a hosted/self-hosted worker
with the matching model-operation adapter and artifact store. The callback
example also requires its named secret to exist in the tenant secret store and
the receiver to verify the Agntz signature and delivery id.
