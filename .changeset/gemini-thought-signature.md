---
"@agntz/core": patch
---

Fix multi-turn tool calls with Gemini 3.x. Gemini attaches an opaque `thought_signature` to each function call and **requires it echoed back** on the next turn; the runner was discarding it, so any tool round-trip on a Gemini 3 model failed with `Function call is missing a thought_signature`.

Tool calls now carry the provider's opaque metadata through `GenerateTextResult.toolCalls[].providerMetadata`, and the runner replays it as the tool-call part's `providerOptions` on the following turn. This is a no-op for providers that don't emit it (OpenAI, Anthropic, Mistral, Cohere, …) and for Gemini 2.5, which doesn't require the round-trip.
