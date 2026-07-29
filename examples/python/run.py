"""Run the shared chatbot manifest with the Python embedded SDK."""

from __future__ import annotations

import sys
from pathlib import Path

from agntz import LiteLLMModelProvider, agntz

AGENTS = Path(__file__).resolve().parents[1] / "agents"


def main() -> None:
    prompt = " ".join(sys.argv[1:]) or "What can you help me with?"
    client = agntz(
        agents=str(AGENTS),
        model_provider=LiteLLMModelProvider(),
    )
    result = client.agents.run(agent_id="chatbot", input=prompt)
    print(result.output)


if __name__ == "__main__":
    main()
