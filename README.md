# Agntz

Agntz is a declarative runtime for production agents. Define agents in YAML, run
them locally with TypeScript or Python, then move the same manifests to hosted
or self-hosted workers when you need multi-user isolation, durable runs, traces,
memory, and eval records.

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
