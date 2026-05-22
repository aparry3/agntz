export default `# Models & providers

agntz calls model providers directly with your API key — there's no proxy and no data routing through our servers. You configure a provider by exporting its API key as an environment variable (embedded mode) or saving it in **Settings → Connections** (hosted / self-hosted).

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
