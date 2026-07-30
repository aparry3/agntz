# Agntz Python

Python SDK and hosted client for Agntz.

The compatibility rule is simple: an agent definition YAML file should have the
same observable behavior in the TypeScript and Python runtimes. Python code uses
Python naming conventions, but the agent, run, session, trace, and tool concepts
match the TypeScript SDK.

## Install

```bash
pip install agntz
```

For local LLM execution through LiteLLM:

```bash
pip install "agntz[litellm]"
```

For local LLM execution with Postgres-backed stores:

```bash
pip install "agntz[postgres,litellm]"
```

## Create an agent

Save this as `agents/support.yaml`:

```yaml
id: support
kind: llm
name: Support Assistant
description: Answers support questions with a concise plan.
model:
  provider: openai
  name: gpt-5.4
  temperature: 0.2
instruction: |
  You are a careful support agent.
prompt: |
  Help with this request: {{userQuery}}
inputSchema:
  type: object
  properties:
    userQuery:
      type: string
      minLength: 1
  required: [userQuery]
  additionalProperties: false
outputSchema:
  type: object
  properties:
    answer: { type: string }
    confidence: { type: number, minimum: 0, maximum: 1 }
  required: [answer, confidence]
  additionalProperties: false
```

The same file can be loaded by the TypeScript and Python SDKs.

## Run locally

```python
from agntz import LiteLLMModelProvider, agntz

client = agntz(
    agents="./agents",
    model_provider=LiteLLMModelProvider(),
)

result = client.agents.run(
    agent_id="support",
    input={"userQuery": "Help me debug this invoice"},
)

print(result.output)
print(result.session_id)
```

Use `client.agents.arun(...)` inside an existing event loop.

## Hosted client

```python
import os
from agntz import AgntzClient

client = AgntzClient(
    api_key=os.environ["AGNTZ_API_KEY"],
    base_url="https://api.agntz.co",
)

result = client.agents.run(agent_id="support", input="Hello")
print(result.output)
print(result.provider, result.model)
print(result.usage.total_tokens, result.resolved_agent_version)
print(result.finish_reason, result.warnings)
```

The async hosted client has the same resource shape:

```python
from agntz import AsyncAgntzClient

async with AsyncAgntzClient(api_key="...", base_url="https://api.agntz.co") as client:
    result = await client.agents.run(agent_id="support", input="Hello")
```

Provider-native batches are also available in both clients:

```python
dataset = client.datasets.import_(
    "./customers.csv",
    format="csv",
    dataset_id="customers",
    name="Customers",
)
batch = client.batches.create(batch_yaml)
run = client.batches.run(
    batch_id=batch.id,
    dataset_id=dataset.id,
    idempotency_key="customers-2026-07-29",
)

items = client.batches.items(run.id, limit=500)
jsonl = client.batches.results_jsonl(run.id)
comparison = client.batches.compare(first_run.id, second_run.id)
```

Use `client.batches.delete_run(run_id)` to explicitly remove a terminal run and
its retained results.

Pass runtime namespace grants with `context` when the run needs resource access:

```python
result = client.agents.run(
    agent_id="support",
    input="Hello",
    context=["app/user/u_123"],
)
```

The hosted Python and TypeScript clients share the same rich-content,
retention, and artifact contract:

```python
from pathlib import Path

result = client.agents.run(
    agent_id="social-narration-transcription",
    content=[
        {
            "type": "audio",
            "file": Path("./narration.mp3"),
            "media_type": "audio/mpeg",
        }
    ],
    retention={"mode": "none", "artifact_ttl_seconds": 3600},
)

artifact = client.artifacts.upload(
    file=Path("./frame.png"),
    media_type="image/png",
    expires_in_seconds=3600,
)
image_bytes = client.artifacts.download(artifact.id)
```

Use `client.agents.start(...)` for a durable asynchronous run. `none` is
synchronous-only; `result` retains a redacted result record, while `session`
retains conversation history and traces. A caller can tighten the manifest's
default retention but cannot loosen it.

The same `agents.run`, `agents.stream`, and `agents.start` methods dispatch
`llm`, `transcription`, `image`, `tool`, `sequential`, and `parallel`
manifests. Transcription output includes `text`, optional `language`,
`durationInSeconds`, and timestamped `segments`. Image output contains artifact
references with media type, size, checksum, expiry, and download URL metadata;
download bytes with `client.artifacts.download(...)`.

For a backend that would otherwise call a provider SDK directly, keep
authorization and domain persistence in the application and move prompts,
model selection, JSON Schema, media handling, and provider-specific settings
into versioned manifests:

- [Provider-replacement guide](https://agntz.co/docs/hosted/provider-replacement)
- [Content, artifacts, and retention](https://agntz.co/docs/hosted/content-artifacts-retention)
- [Transcription and image generation](https://agntz.co/docs/hosted/transcription-images)
- [Results, streaming, and errors](https://agntz.co/docs/hosted/results-errors)

## Per-run client tools

Declare the model-facing contract in YAML:

```yaml
tools:
  - kind: client
    name: get_current_selection
    description: Read the current editor selection
    inputSchema:
      type: object
      properties: {}
      additionalProperties: false
```

Then attach the Python implementation to that invocation:

```python
def get_current_selection(_input, context):
    if context.signal.is_set():
        raise RuntimeError("cancelled")
    return {"text": editor.current_selection()}

result = client.agents.run(
    agent_id="editor-assistant",
    input="Explain my selection",
    client_tools={"get_current_selection": get_current_selection},
)
```

Async handlers work with `AsyncAgntzClient` and embedded
`client.agents.arun()`. All reachable client tools must be supplied before the
Run is created; unattended `runs.start()` calls reject them. The default
deadline is 30 seconds. Handler failures are model-visible tool errors, and
outputs must be JSON-serializable with a 40,000-character serialized limit.

## Local tools

```python
from typing import Any

from pydantic import BaseModel
from agntz import LiteLLMModelProvider, agntz, tool


class LookupInput(BaseModel):
    order_id: str


def lookup_order(args: LookupInput) -> dict[str, Any]:
    return {"status": "shipped", "eta": "Tomorrow"}


client = agntz(
    agents="./agents",
    tools=[
        tool(
            name="lookup_order",
            description="Look up an order by ID",
            input_schema=LookupInput,
            execute=lookup_order,
        )
    ],
    model_provider=LiteLLMModelProvider(),
)
```

Reference the tool from YAML:

```yaml
tools:
  - kind: local
    tools: [lookup_order]
```

LLM agents can also call HTTP tools, MCP tools over HTTP JSON-RPC, and
agent-as-tool entries from the same manifest tool declarations used by the
TypeScript runtime.

## Sessions

Pass the same `session_id` across runs to continue a conversation. Local
sessions are persisted by the configured store and are replayed into model calls.

```python
first = client.agents.run(
    agent_id="support",
    input={"userQuery": "Hi, I need help"},
    session_id="customer-42",
)

second = client.agents.run(
    agent_id="support",
    input={"userQuery": "My order is #12345"},
    session_id=first.session_id,
)

messages = client.sessions.get_messages("customer-42")
```

## Runs and traces

Local execution records runs, sessions, and trace spans. The same store backs all
three surfaces.

```python
runs = client.runs.list(status="completed")
trace_rows = client.traces.list(agent_id="support")

trace_id = trace_rows["rows"][0]["traceId"]
detail = client.traces.get(trace_id)

print(detail["summary"])
print(detail["spans"])
```

## SQLite persistence

```python
from agntz import LiteLLMModelProvider, SQLiteStore, agntz

client = agntz(
    agents="./agents",
    store=SQLiteStore("./agntz.sqlite"),
    model_provider=LiteLLMModelProvider(),
)
```

SQLite persists local runs, trace spans, sessions, messages, agent versions,
aliases, datasets, evals, eval runs, latest scores, and API keys across process
restarts.

## Versioned agents

Agents loaded from YAML files are imported into the configured store as
immutable versions. Unchanged files are deduped by content hash, so restarting a
local process does not create duplicate versions.

```python
result = client.agents.run(
    agent_id="support@latest",
    input={"userQuery": "Help me debug this invoice"},
)

versions = client.agents.list_versions("support")
client.agents.set_alias("support", "stable", versions[0].created_at)

stable = client.agents.run(agent_id="support@stable", input={"userQuery": "Hello"})
exact = client.agents.run(
    agent_id=f"support@{versions[0].created_at}",
    input={"userQuery": "Replay this exact version"},
)
```

The same resource exposes `list`, `get`, `create`, `update`, `delete`,
`get_version`, `activate_version`, `set_alias`, and `remove_alias` for local and
hosted clients.

## Datasets and evals

Datasets are scoped to an agent, and eval definitions can point to a default
dataset. Eval runs preserve immutable history and update the latest score for
the eval, dataset, and resolved agent version.

```python
dataset = client.datasets.create(
    agent_id="support",
    name="Refund checks",
    items=[
        {
            "id": "refund-1",
            "input": {"userQuery": "How do I request a refund?"},
            "expected": {"intent": "refund"},
        }
    ],
)

definition = client.evals.create(
    agent_id="support",
    name="Support quality",
    default_dataset_id=dataset.id,
    criteria=[{"id": "helpful", "name": "Helpful", "threshold": 0.7}],
    pass_threshold=0.7,
)

run = client.evals.run(eval_id=definition.id, agent_version="latest")
latest = client.evals.get_latest_score(
    eval_id=definition.id,
    dataset_id=dataset.id,
    resolved_agent_version=run.agent_version,
)
```

Hosted eval runs return immediately with `running` status. Poll
`client.evals.get_run(run.id)` or use `client.evals.cancel_run(run.id)` to stop a
run. Pending cases are marked `cancelled`; in-flight provider calls are
best-effort and may finish before the background runner observes cancellation.

## Hosted deployments

Python no longer ships a hosted worker implementation. Use `AgntzClient` or
`AsyncAgntzClient` to call the TypeScript worker hosted by agntz.co or your own
self-hosted TS deployment. The Python package continues to support embedded
local execution, stores, resources, and memrez for in-process applications.

## Memrez

The Python package includes namespace grants, the memrez core, memory resource
provider wiring, and in-memory/SQLite/Postgres memory stores. By default,
`create_memrez()` wires memrez's built-in LLM reasoner for tagging and
curation through direct LiteLLM calls. Install `agntz[litellm]` and set the
provider key for the default model, such as `OPENAI_API_KEY`, when you want
the default reasoner to run locally. Pass `DeterministicReasoner()` for tests
or no-LLM kill-switch behavior.

```python
from agntz import LiteLLMModelProvider, agntz
from agntz.resources.memrez import SqliteMemoryStore, create_memrez

memrez = create_memrez(store=SqliteMemoryStore("./memory.db"))

client = agntz(
    agents="./agents",
    resources={"memory": memrez.provider()},
    model_provider=LiteLLMModelProvider(),
)

client.agents.run(
    agent_id="support-with-memory",
    input="Remember that I prefer metric units.",
    context=["app/user/u_123"],
)
```

You can also use memrez directly:

```python
memrez.write(["app/user/u_123"], "Prefers metric units.", topics_hint=["prefs"])
entries = memrez.read(["app/user/u_123"], "prefs")
```

Configure invoke-time preload in the resource declaration. Topic taxonomy and
reasoner policy belong to Memrez-level configuration, not the agent manifest:

```yaml
resources:
  memory:
    kind: memory
    mode: read-write
    preload:
      core: true
      topics: [goals, equipment]
      limit: 30
      maxChars: 10000
      types: [fact, preference, summary]
```

Override the reasoner explicitly when needed:

```python
from agntz.resources.memrez import (
    DeterministicReasoner,
    ReasonerModelConfig,
    create_memrez,
    llm_reasoner,
)

memrez = create_memrez(
    reasoner=llm_reasoner(
        tagger_model=ReasonerModelConfig(provider="anthropic", name="claude-haiku-4-5")
    )
)

test_memrez = create_memrez(reasoner=DeterministicReasoner())
```

## CLI

The full `agntz` terminal CLI is distributed through the Node package
`@agntz/sdk`. The Python package installs a separate `agntz-py` command for
local Python execution and validation, avoiding an executable-name collision.

```bash
npx @agntz/sdk create "Answer support questions in a concise tone" -o ./agents/support.yaml
npx @agntz/sdk run ./agents/support.yaml --input '{"userQuery":"hello"}'
npx @agntz/sdk --help
agntz-py validate --json
agntz-py run ./agents/support.yaml --input '{"userQuery":"hello"}'
```

Python validation defaults to `./agents`, ignores dependency/build/hidden
directories during recursion, and exits nonzero when no manifests are found.

Use Python code when the agent needs Python local tools, a Python resource
provider, or a Python store. The same YAML file can be loaded by both runtimes.

## Current parity

Implemented in this package:

- Hosted sync and async clients for agents, artifacts, rich content,
  caller-controlled retention, normalized result metadata, versions, aliases,
  run, run stream, async runs, traces, datasets, evals, eval runs,
  cancellation, and eval scores.
- Hosted stream normalization for all six manifest kinds, including
  sessionless `none` and `result` retention events.
- Local YAML execution for `llm`, `tool`, `sequential`, and `parallel` agents.
- Local Python tools, HTTP tools, MCP JSON-RPC tools, and agent-as-tool calls.
- Versioned local and hosted agent resolution for bare ids, `@latest`, exact
  timestamps, and aliases.
- First-class datasets, eval definitions, eval runs, and latest-score tracking.
- Runtime namespace grants, resource providers, and the memrez memory provider.
- Memrez LLM reasoner default, preload/topic policy, in-memory, SQLite, and
  Postgres memory stores.
- LiteLLM-backed model execution with tool-call loop support.
- Memory, SQLite, and Postgres stores for local data including runs,
  traces, sessions, agent versions, aliases, eval data, latest scores, and API
  keys and namespace roots.
- Import surfaces for agents, sessions, and memory use Pythonic `import_`
  methods on local and hosted clients.
- Contract fixtures shared with the TypeScript core manifest runtime.

Still intentionally outside this first Python package slice:

- The hosted product UI remains TypeScript.
- Terminal eval commands remain in the Node CLI.
- Streaming token deltas for local Python execution are not exposed yet.

## Development

```bash
python -m venv .venv
.venv/bin/python -m pip install -e '.[dev,litellm]'
.venv/bin/python -m pytest
.venv/bin/python -m ruff check .
.venv/bin/python -m basedpyright
.venv/bin/python -m build
```
