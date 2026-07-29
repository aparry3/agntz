export default `# Models & providers

The active runtime calls the configured model provider. In embedded mode that
is your process; in hosted or self-hosted mode it is the Agntz worker. Configure
a provider by exporting its API key in embedded mode or saving it in
**Settings → Connections** for a worker. Provider credentials are never sent by
the hosted client on individual run requests.

## Supported providers

| Provider | Env var | Provider id |
|---|---|---|
| OpenAI | \`OPENAI_API_KEY\` | \`openai\` |
| Anthropic | \`ANTHROPIC_API_KEY\` | \`anthropic\` |
| Google | \`GOOGLE_GENERATIVE_AI_API_KEY\` | \`google\` |
| **OpenRouter** | \`OPENROUTER_API_KEY\` | \`openrouter\` |
| Mistral | \`MISTRAL_API_KEY\` | \`mistral\` |
| xAI | \`XAI_API_KEY\` | \`xai\` |
| Groq | \`GROQ_API_KEY\` | \`groq\` |
| DeepSeek | \`DEEPSEEK_API_KEY\` | \`deepseek\` |
| Perplexity | \`PERPLEXITY_API_KEY\` | \`perplexity\` |
| Cohere | \`COHERE_API_KEY\` | \`cohere\` |
| Azure OpenAI | \`AZURE_OPENAI_API_KEY\` | \`azure\` |

## Picking a model in a manifest

\`\`\`yaml
model:
  provider: anthropic
  name: claude-sonnet-4-6
  temperature: 0
\`\`\`

\`provider\` is the id from the table above; \`name\` is the exact model id the provider expects (e.g. \`gpt-5.4-mini\`, \`claude-sonnet-4-6\`, \`gemini-3-pro\`).

## Common model controls

These manifest fields are normalized through the AI SDK and forwarded when the
selected model supports them:

| Field | Meaning |
|---|---|
| \`temperature\` | Sampling temperature |
| \`maxTokens\` | Maximum generated/output tokens |
| \`topP\` / \`topK\` | Nucleus and top-k sampling |
| \`presencePenalty\` / \`frequencyPenalty\` | Repetition controls |
| \`stopSequences\` | One or more generation stop strings |
| \`seed\` | Best-effort deterministic seed |
| \`maxRetries\` | Provider request retry ceiling |

\`\`\`yaml
model:
  provider: openai
  name: gpt-5.4
  temperature: 0.2
  maxTokens: 4096
  topP: 0.95
  presencePenalty: 0
  frequencyPenalty: 0
  stopSequences: ["<END>"]
  seed: 42
  maxRetries: 2
\`\`\`

Unsupported settings may be ignored or reported as provider warnings. The
normalized run result records the requested provider/model, the actual model
reported by the provider, finish reason, response id, warnings, and usage.

## Provider-scoped options

Use \`providerOptions\` for settings with no portable equivalent. Options are
namespaced so switching the manifest provider cannot accidentally send OpenAI
settings to Anthropic.

\`\`\`yaml
model:
  provider: openai
  name: gpt-5.4
  providerOptions:
    openai:
      reasoningEffort: medium
      store: false
\`\`\`

\`\`\`yaml
model:
  provider: anthropic
  name: claude-sonnet-4-6
  providerOptions:
    anthropic:
      thinking:
        type: enabled
        budgetTokens: 2048
\`\`\`

The inner keys are passed to the selected AI SDK provider. Validate them against
that provider's current documentation and keep them additive so a model switch
can fall back to the common fields. Secret-like option keys are rejected; store
credentials in Connections or Secrets, never in \`providerOptions\`.

The old \`model.options\` field remains accepted for compatibility but new
manifests should use \`providerOptions\`.

## OpenRouter — one key, hundreds of models

[OpenRouter](https://openrouter.ai) is a meta-provider that proxies to virtually every commercial and open-source model behind a single API key. Use it when you want to:

- Access **open-source models** (Llama, Mistral, DeepSeek, Qwen, …) without standing up your own inference.
- Try many models without juggling per-provider API keys.
- Take advantage of OpenRouter's routing, fallbacks, and unified billing.

Set the key and reference any OpenRouter model by its slug (\`<author>/<model>\`):

\`\`\`bash
export OPENROUTER_API_KEY=sk-or-...
\`\`\`

\`\`\`yaml
model:
  provider: openrouter
  name: anthropic/claude-sonnet-4
\`\`\`

\`\`\`yaml
model:
  provider: openrouter
  name: meta-llama/llama-3.3-70b-instruct
\`\`\`

\`\`\`yaml
model:
  provider: openrouter
  name: deepseek/deepseek-chat
\`\`\`

Free-tier models are available via the \`:free\` suffix (subject to OpenRouter's rate limits):

\`\`\`yaml
model:
  provider: openrouter
  name: meta-llama/llama-3.3-70b-instruct:free
\`\`\`

OpenRouter reports the per-request USD cost on every response, so traces in the UI show actual spend instead of an estimate.

### Attribution

By default, requests through OpenRouter are attributed to your app with the headers \`HTTP-Referer: https://agntz.co\` and \`X-Title: agntz\` (used by OpenRouter's public rankings). Override via the provider's stored \`config\`:

\`\`\`json
{ "referer": "https://your-app.com", "title": "Your App" }
\`\`\`

## Other providers, custom endpoints

Every provider supports a \`baseUrl\` override in its stored config — useful for proxies and OpenAI-compatible gateways. For arbitrary providers not in the table above, supply a custom \`modelProvider\` implementation to \`createRunner\`.
`;
