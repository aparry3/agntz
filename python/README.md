# Agntz Python

Python SDK and hosted client implementation for Agntz.

The compatibility rule is that an agent definition YAML file should have the
same observable behavior in the TypeScript and Python runtimes.

## Local quickstart

```bash
pip install agntz
```

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
```

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

## Local tools

```python
from pydantic import BaseModel
from agntz import agntz, tool

class AddInput(BaseModel):
    a: float
    b: float

def add(args: AddInput) -> dict[str, float]:
    return {"result": args.a + args.b}

client = agntz(
    agents="./agents",
    tools=[
        tool(
            name="add",
            description="Add two numbers",
            input_schema=AddInput,
            execute=add,
        )
    ],
)
```

## Development

```bash
python -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m pytest
.venv/bin/python -m ruff check .
.venv/bin/python -m basedpyright
```
