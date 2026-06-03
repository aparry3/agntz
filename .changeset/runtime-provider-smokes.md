---
"@agntz/core": patch
---

Fix runtime provider smoke coverage and provider-specific tool loop handling. The runner now preserves detailed usage metadata across tool steps, recovers Cohere tool-result responses rejected by the upstream AI SDK citation schema, and keeps OpenAI reasoning/tool-call response messages intact across streamed and non-streamed tool turns.
