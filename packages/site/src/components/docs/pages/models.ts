export default `# Models & providers

The active runtime calls the configured model provider. In embedded mode that
is your process; in hosted or self-hosted mode it is the Agntz worker. Configure
a provider by exporting its API key in embedded mode or saving it in
**Settings → Connections** for a worker. Provider credentials are never sent by
the hosted client on individual run requests.

## Supported providers

| Provider | Env var | Provider id | Current starting points |
|---|---|---|---|
| OpenAI | \`OPENAI_API_KEY\` | \`openai\` | \`gpt-5.6-sol\`, \`gpt-5.6-terra\`, \`gpt-5.6-luna\` |
| Anthropic | \`ANTHROPIC_API_KEY\` | \`anthropic\` | \`claude-fable-5\`, \`claude-opus-5\`, \`claude-sonnet-5\`, \`claude-haiku-4-5\` |
| Google | \`GOOGLE_GENERATIVE_AI_API_KEY\` | \`google\` | \`gemini-3.6-flash\`, \`gemini-3.5-flash\`, \`gemini-3.5-flash-lite\`, \`gemini-3.1-pro-preview\` |
| **OpenRouter** | \`OPENROUTER_API_KEY\` | \`openrouter\` | Any current \`<author>/<model>\` slug |
| Mistral | \`MISTRAL_API_KEY\` | \`mistral\` | \`mistral-medium-3-5\`, \`mistral-small-2603\`, \`mistral-large-2512\` |
| xAI | \`XAI_API_KEY\` | \`xai\` | \`grok-4.5\` |
| Groq | \`GROQ_API_KEY\` | \`groq\` | \`openai/gpt-oss-120b\`, \`openai/gpt-oss-20b\` |
| DeepSeek | \`DEEPSEEK_API_KEY\` | \`deepseek\` | \`deepseek-v4-pro\`, \`deepseek-v4-flash\` |
| Perplexity | \`PERPLEXITY_API_KEY\` | \`perplexity\` | \`sonar\`, \`sonar-pro\`, \`sonar-reasoning-pro\`, \`sonar-deep-research\` |
| Cohere | \`COHERE_API_KEY\` | \`cohere\` | \`command-a-plus-05-2026\`, \`command-a-03-2025\`, \`command-a-reasoning-08-2025\` |
| Azure OpenAI | \`AZURE_OPENAI_API_KEY\` | \`azure\` | Your Azure deployment name |

This table was reviewed on 2026-08-17. The model picker queries each configured
provider's catalog when one is available and falls back to this curated set if
the catalog cannot be reached. OpenRouter's public catalog is loaded without a
key. Perplexity exposes a fixed Sonar model enum rather than a list endpoint,
and Azure requests use your deployment name, so those two remain configuration
driven.

## Picking a model in a manifest

\`provider\` is the provider id from the table. \`name\` must be the exact model
id—or Azure deployment name—that provider expects.

\`\`\`yaml
model:
  provider: anthropic
  name: claude-sonnet-5
  maxTokens: 4096
\`\`\`

OpenAI's \`gpt-5.6\` alias resolves to \`gpt-5.6-sol\`. The Pro capability is a
reasoning mode on GPT-5.6 rather than a separate model id. Use \`gpt-5.6-terra\`
for a balanced default and \`gpt-5.6-luna\` for high-volume, cost-sensitive
work.

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
  provider: mistral
  name: mistral-small-2603
  temperature: 0.2
  maxTokens: 4096
  topP: 0.95
  stopSequences: ["<END>"]
  seed: 42
  maxRetries: 2
\`\`\`

Unsupported settings may be ignored or reported as provider warnings. The
normalized run result records the requested provider/model, the actual model
reported by the provider, finish reason, response id, warnings, and usage.

Model-specific rules matter on the newest releases:

- Claude Sonnet 5 uses adaptive thinking and rejects non-default
  \`temperature\`, \`topP\`, or \`topK\`.
- Gemini 3.6 Flash and Gemini 3.5 Flash-Lite deprecate the sampling controls
  \`temperature\`, \`topP\`, and \`topK\`.
- Groq retired \`llama-3.1-8b-instant\` and \`llama-3.3-70b-versatile\` on
  2026-08-16; use its GPT-OSS production routes.
- DeepSeek retired the legacy \`deepseek-chat\` and \`deepseek-reasoner\`
  aliases on 2026-07-24; use a DeepSeek V4 id.

## Provider-scoped options

Use \`providerOptions\` for settings with no portable equivalent. Options are
namespaced so switching the manifest provider cannot accidentally send OpenAI
settings to Anthropic.

\`\`\`yaml
model:
  provider: openai
  name: gpt-5.6-terra
  providerOptions:
    openai:
      reasoningEffort: medium
      store: false
\`\`\`

\`\`\`yaml
model:
  provider: anthropic
  name: claude-sonnet-5
  providerOptions:
    anthropic:
      thinking:
        type: adaptive
      effort: medium
\`\`\`

The inner keys are passed to the selected AI SDK provider. Validate them against
that provider's current documentation and keep them additive so a model switch
can fall back to the common fields. Secret-like option keys are rejected; store
credentials in Connections or Secrets, never in \`providerOptions\`.

The old \`model.options\` field remains accepted for compatibility but new
manifests should use \`providerOptions\`.

## OpenRouter — one key, hundreds of models

[OpenRouter](https://openrouter.ai) proxies commercial and open-source models
behind a single API key. Set the key and reference a current model by its
\`<author>/<model>\` slug:

\`\`\`bash
export OPENROUTER_API_KEY=sk-or-...
\`\`\`

\`\`\`yaml
model:
  provider: openrouter
  name: anthropic/claude-sonnet-5
\`\`\`

\`\`\`yaml
model:
  provider: openrouter
  name: google/gemini-3.6-flash
\`\`\`

\`\`\`yaml
model:
  provider: openrouter
  name: deepseek/deepseek-v4-pro
\`\`\`

OpenRouter reports the per-request USD cost on every response, so traces in the
UI show actual spend instead of a static estimate.

### Attribution

By default, requests through OpenRouter are attributed to your app with the
headers \`HTTP-Referer: https://agntz.co\` and \`X-Title: agntz\`. Override them
through the provider's stored \`config\`:

\`\`\`json
{ "referer": "https://your-app.com", "title": "Your App" }
\`\`\`

## Provider model references

- [OpenAI models](https://developers.openai.com/api/docs/models)
- [Anthropic model selection](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [OpenRouter model catalog](https://openrouter.ai/models)
- [Mistral models](https://docs.mistral.ai/models/overview)
- [xAI models](https://docs.x.ai/developers/models)
- [Groq models](https://console.groq.com/docs/models)
- [DeepSeek updates](https://api-docs.deepseek.com/news/news260424/)
- [Perplexity Sonar models](https://docs.perplexity.ai/docs/sonar/models)
- [Cohere models](https://docs.cohere.com/v1/docs/models)
- [Azure deployment endpoints](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/endpoints)

## Other providers and custom endpoints

Every provider supports a \`baseUrl\` override in its stored config—useful for
proxies and OpenAI-compatible gateways. For arbitrary providers not in the
table, supply a custom \`modelProvider\` implementation to \`createRunner\`.
`;
