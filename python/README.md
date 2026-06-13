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

For hosted Python deployments backed by Postgres:

```bash
pip install "agntz[server,postgres,litellm]"
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
  userQuery: string
outputSchema:
  answer: string
  confidence: number
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
```

The async hosted client has the same resource shape:

```python
from agntz import AsyncAgntzClient

async with AsyncAgntzClient(api_key="...", base_url="https://api.agntz.co") as client:
    result = await client.agents.run(agent_id="support", input="Hello")
```

Pass runtime namespace grants with `context` when the run needs resource access:

```python
result = client.agents.run(
    agent_id="support",
    input="Hello",
    context=["app/user/u_123"],
)
```

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

## Hosted Python service

The Python package can run as an ASGI backend with the same core hosted surfaces
used by the TypeScript service: health, run, run stream, async runs, run cancel,
traces, agents, versions, aliases, datasets, eval definitions, eval runs, eval
cancel, and latest eval scores.

Create `app.py`:

```python
import os

from agntz import LiteLLMModelProvider
from agntz.server import create_app
from agntz.stores import PostgresStore

store = PostgresStore(os.environ["DATABASE_URL"])

app = create_app(
    store=store,
    internal_secret=os.environ["AGNTZ_INTERNAL_SECRET"],
    model_provider=LiteLLMModelProvider(),
)
```

Run it with uvicorn:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

Bearer API keys resolve to user ids through the configured store. Internal
worker calls use `X-Internal-Secret` plus `X-User-Id` or a `userId` field in the
JSON request body.

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
from agntz.memrez import create_memrez
from agntz.memrez_sqlite import SqliteMemoryStore

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

Configure agent-specific memory vocabulary and invoke-time preload in the
resource declaration:

```yaml
resources:
  memory:
    kind: memory
    mode: read-write
    topics:
      preferred: [goals, equipment, schedule, injuries]
    preload:
      core: true
      topics: [goals, equipment]
      limit: 30
      maxChars: 10000
      types: [fact, preference, summary]
```

Override the reasoner explicitly when needed:

```python
from agntz.memrez import DeterministicReasoner, create_memrez
from agntz.memrez_llm_reasoner import ReasonerModelConfig, llm_reasoner

memrez = create_memrez(
    reasoner=llm_reasoner(
        tagger_model=ReasonerModelConfig(provider="anthropic", name="claude-haiku-4-5")
    )
)

test_memrez = create_memrez(reasoner=DeterministicReasoner())
```

## CLI

The terminal CLI is distributed through the Node package `@agntz/sdk`, while
Python service code uses the `agntz` Python package.

```bash
npx @agntz/sdk create "Answer support questions in a concise tone" -o ./agents/support.yaml
npx @agntz/sdk run ./agents/support.yaml --input '{"userQuery":"hello"}'
npx @agntz/sdk --help
```

Use Python code when the agent needs Python local tools, a Python resource
provider, or a Python store. The same YAML file can be loaded by both runtimes.

## Current parity

Implemented in this package:

- Hosted sync and async clients for agents, versions, aliases, run, run stream,
  async runs, traces, datasets, evals, eval runs, cancellation, and eval scores.
- FastAPI/ASGI hosted service factory for Python deployments.
- Local YAML execution for `llm`, `tool`, `sequential`, and `parallel` agents.
- Local Python tools, HTTP tools, MCP JSON-RPC tools, and agent-as-tool calls.
- Versioned local and hosted agent resolution for bare ids, `@latest`, exact
  timestamps, and aliases.
- First-class datasets, eval definitions, eval runs, and latest-score tracking.
- Runtime namespace grants, resource providers, and the memrez memory provider.
- Memrez LLM reasoner default, preload/topic policy, in-memory, SQLite, and
  Postgres memory stores.
- LiteLLM-backed model execution with tool-call loop support.
- Memory, SQLite, and Postgres stores for hosted service data including runs,
  traces, sessions, agent versions, aliases, eval data, latest scores, and API
  keys.
- Contract fixtures shared with the TypeScript manifest package.

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
