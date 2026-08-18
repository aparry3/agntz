# Agntz

Agntz is a declarative runtime for production agents. Define agents in YAML, run
them locally with TypeScript or Python, then move the same manifests to hosted
or self-hosted workers when you need multi-user isolation, durable runs, traces,
memory, and eval records.

The TypeScript packages are in public beta; the hosted client, contracts, and
core runtime use the `0.4.x` line, while stores use `0.3.x`. The Python package
uses the `0.5.x` line. TypeScript runtimes require Node 22 or newer, and Python
requires 3.11 or newer. See [`ROADMAP.md`](./ROADMAP.md) for the pre-1.0
stability policy.

## Install

TypeScript embedded SDK:

```sh
pnpm add @agntz/sdk
```

Python embedded SDK:

```sh
pip install "agntz[litellm]"
```

Hosted client:

```sh
pnpm add @agntz/client
```

## Quickstart

Create an agent manifest:

```yaml
# agents/support.yaml
id: support
kind: llm

model:
  provider: openai
  name: gpt-4o-mini

instruction: |
  You answer support questions concisely.
```

Run it locally with TypeScript:

```ts
import { agntz } from "@agntz/sdk";

const client = await agntz({ agents: "./agents" });

const result = await client.agents.run({
  agentId: "support",
  input: { message: "Can I change my shipping address?" },
});

console.log(result.output);
```

Run the same manifest locally with Python:

```py
from agntz import LiteLLMModelProvider, agntz

client = agntz(
    agents="./agents",
    model_provider=LiteLLMModelProvider(),
)

result = client.agents.run(
    agent_id="support",
    input={"message": "Can I change my shipping address?"},
)

print(result.output)
```

Runnable TypeScript and Python programs using the shared manifests live in
[`examples`](./examples).

Publish local manifests to hosted Agntz:

```sh
npx @agntz/sdk login --key ar_live_...
npx @agntz/sdk publish agents --agents-dir ./agents --dry-run
npx @agntz/sdk publish agents --agents-dir ./agents --yes
```

Publishing an existing agent id creates a new hosted version by default. The
CLI publishes manifests, not arbitrary local tool-handler code.

Call a hosted or self-hosted worker:

```ts
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: "https://api.agntz.co",
});

const result = await client.agents.run({
  agentId: "support",
  input: { message: "Can I change my shipping address?" },
});
```

## Replace direct provider calls

The hosted run API can own the prompt, provider/model choice, recursive
structured-output schema, model settings, multimodal transport, and response
metadata that would otherwise live in an OpenAI or Anthropic call site.

```yaml
# agents/recipe-enrichment.yaml
id: recipe-enrichment
kind: llm
model:
  provider: anthropic
  name: claude-sonnet-4-6
  temperature: 0
  maxTokens: 4096
inputSchema:
  type: object
  properties:
    recipes:
      type: array
      items:
        type: object
        properties:
          id: { type: string }
          title: { type: string }
        required: [id, title]
        additionalProperties: true
  required: [recipes]
  additionalProperties: false
outputSchema:
  type: object
  properties:
    recipes:
      type: array
      items:
        type: object
        properties:
          id: { type: string }
          tags:
            type: array
            items: { type: string }
        required: [id, tags]
        additionalProperties: false
  required: [recipes]
  additionalProperties: false
retention:
  mode: result
  ttlSeconds: 86400
```

```ts
const result = await client.agents.run({
  agentId: "recipe-enrichment",
  input: { recipes },
  retention: { mode: "result" },
});

console.log(result.output);
console.log(result.provider, result.model, result.usage);
```

The same client supports ordered text/image/audio content, automatic local-file
uploads, managed artifacts, transcription, image generation, signed application
callbacks, and explicit `none` / `result` / `session` retention.

For offline workloads, provider-native batches version a strict `kind: llm`
manifest independently from a reusable dataset, submit through OpenAI,
Anthropic, Gemini, or Mistral, and normalize results so model-swap reruns can be
compared item by item.

- [Provider-replacement guide](https://agntz.co/docs/hosted/provider-replacement)
- [Provider-native batches](https://agntz.co/docs/hosted/batches)
- [Content, artifacts, and retention](https://agntz.co/docs/hosted/content-artifacts-retention)
- [Transcription and image generation](https://agntz.co/docs/hosted/transcription-images)
- [Signed callback tools](https://agntz.co/docs/tools/callback)

## Package map

| Package | Purpose |
|---|---|
| `@agntz/sdk` | TypeScript embedded SDK, local client, CLI, and SQLite helper |
| `@agntz/client` | TypeScript hosted/self-hosted HTTP client |
| `@agntz/core` | Low-level runner, definitions, MCP helpers, telemetry, and `@agntz/core/manifest` |
| `@agntz/contracts` | Shared type/kernel package for stores, resources, tools, evals, runs, and leaf utilities |
| `@agntz/db` | Shared SQLite/Postgres connection and migration plumbing |
| `@agntz/stores` | Store contracts plus in-memory, SQLite, and Postgres implementations |
| `@agntz/memrez` | Memory resource provider and memory stores |
| `agntz` | Python hosted client, embedded SDK/runtime, stores, and memrez resources |

The old standalone `@agntz/manifest` package has been merged into
`@agntz/core/manifest`.

## Repository layout

| Path | Purpose |
|---|---|
| `packages/site` | Marketing site and canonical public docs |
| `packages/app` | Hosted product UI |
| `packages/worker` | Hosted execution worker |
| `packages/*` | TypeScript packages |
| `python` | Python package |
| `examples` | Example agents and integrations |
| `planning` | Active and historical implementation plans |

## Common commands

```sh
pnpm install
pnpm build
pnpm test
pnpm test:packed
pnpm --filter @agntz/site build
```

Python validation:

```sh
cd python
python -m pip install -e '.[dev]'
python -m pytest
python -m ruff check .
python -m basedpyright
```

## Documentation

- Public docs: `packages/site/src/components/docs/pages`
- Website: `pnpm --filter @agntz/site dev`
- npm publishing: [`PUBLISH.md`](./PUBLISH.md)
- PyPI publishing: [`PYTHON_PUBLISH.md`](./PYTHON_PUBLISH.md)
- Deployment: [`DEPLOY.md`](./DEPLOY.md)

Every public docs page is also exposed as markdown by the site, and the
agent-facing corpus is available at `/llms.txt`.

## License

MIT
