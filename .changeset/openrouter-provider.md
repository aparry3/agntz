---
"@agntz/core": minor
---

Add OpenRouter as a first-class model provider. Use `{ provider: "openrouter", name: "<slug>" }` (e.g. `anthropic/claude-sonnet-4`, `meta-llama/llama-3.3-70b-instruct`) with `OPENROUTER_API_KEY` to access 300+ models — commercial and open-source — through a single key.

Per-request cost reported by OpenRouter flows through to `TokenUsage.cost`, and `computeCost()` prefers provider-reported cost over the static rate table. Default attribution headers (`HTTP-Referer: https://agntz.co`, `X-Title: agntz`) can be overridden via the provider's stored `config`.
