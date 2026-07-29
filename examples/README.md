# Runnable Examples

The manifests in [`agents`](./agents) are shared by both runtimes. Set the API
key for the provider named in the manifest before running an LLM example. The
default chatbot uses OpenAI:

```sh
export OPENAI_API_KEY=...
```

TypeScript:

```sh
pnpm install
pnpm --filter @agntz/example-typescript start -- "Explain durable agent runs"
```

Python:

```sh
python -m venv python/.venv
python/.venv/bin/python -m pip install -e 'python[litellm]'
python/.venv/bin/python examples/python/run.py "Explain durable agent runs"
```

Validate every manifest without making a provider call:

```sh
pnpm --filter @agntz/sdk exec agntz validate ../../examples/agents
```

Some manifests demonstrate MCP, local tools, HTTP APIs, skills, or composed
pipelines and require the integrations described in
[`agents/README.md`](./agents/README.md). The runnable programs intentionally use
`chatbot.yaml`, which needs only a model provider key.

The provider-replacement examples are designed for a hosted or self-hosted
worker:

- `social-transcription.yaml` accepts one audio content block.
- `generated-recipe-cover.yaml` returns managed image artifacts.
- `hosted-nutritionist-callback.yaml` calls a signed application endpoint with
  trusted runtime context.

Import one through the hosted UI or `client.agents.import(...)`, then invoke it
with the same `agents.run`, `agents.stream`, or durable `agents.start` resource
shape. See the
[provider-replacement guide](https://agntz.co/docs/hosted/provider-replacement)
for TypeScript and Python calls.
