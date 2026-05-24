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

SQLite persists local runs, trace spans, sessions, and messages across process
restarts.

## CLI

```bash
agntz validate ./agents
agntz run ./agents support --input '{"userQuery":"hello"}'
```

## Current parity

Implemented in this package:

- Hosted sync and async clients for run, run stream, runs, and traces.
- Local YAML execution for `llm`, `tool`, `sequential`, and `parallel` agents.
- Local Python tools, HTTP tools, MCP JSON-RPC tools, and agent-as-tool calls.
- LiteLLM-backed model execution with tool-call loop support.
- Memory and SQLite stores for runs, trace spans, sessions, and messages.
- Contract fixtures shared with the TypeScript manifest package.

Still intentionally outside this first Python package slice:

- The hosted app and worker remain TypeScript services.
- Python does not reimplement the TypeScript eval product yet.
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
