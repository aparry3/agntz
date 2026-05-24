from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from agntz.manifest import (
    LLMAgentManifest,
    ToolCallConfig,
    apply_input_transform,
    apply_output_mapping,
    create_initial_state,
    evaluate_condition,
    execute,
    get_manifest_state_key,
    interpolate,
    load_manifest_file,
    render_template,
    resolve_path,
)
from agntz.manifest.types import AgentManifest, AgentState

ROOT = Path(__file__).resolve().parents[3]
MANIFESTS = ROOT / "contracts" / "python-port" / "manifests"


class FakeContext:
    def __init__(self, manifests: dict[str, AgentManifest]) -> None:
        self.manifests = manifests
        self.llm_calls: list[tuple[str, str, str | None, AgentState]] = []
        self.tool_calls: list[tuple[ToolCallConfig, AgentState]] = []

    async def invoke_llm(
        self,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> Any:
        self.llm_calls.append((manifest.id, instruction, prompt, state))
        if manifest.id == "support":
            return {"answer": "Use the refund workflow.", "confidence": 0.82}
        if manifest.id == "summarizer":
            return "Use the refund workflow."
        if manifest.id == "tone-reviewer":
            return "clear"
        return f"output:{manifest.id}"

    async def invoke_tool(self, config: ToolCallConfig, state: AgentState) -> Any:
        self.tool_calls.append((config, state))
        if config.name == "add":
            params = config.params or {}
            return {"result": float(params["a"]) + float(params["b"])}
        return {"ok": True}

    async def resolve_agent(self, agent_id: str) -> AgentManifest:
        return self.manifests[agent_id]


def test_parse_contract_manifests_and_state_keys() -> None:
    support = load_manifest_file(MANIFESTS / "simple-llm.yaml")
    calculator = load_manifest_file(MANIFESTS / "local-tool.yaml")
    sequential = load_manifest_file(MANIFESTS / "sequential.yaml")
    parallel = load_manifest_file(MANIFESTS / "parallel.yaml")

    assert support.kind == "llm"
    assert get_manifest_state_key(support) == "support"
    assert calculator.kind == "tool"
    assert sequential.kind == "sequential"
    assert [step.state_key for step in sequential.steps] == ["classify", "summarize"]
    assert parallel.kind == "parallel"
    assert [branch.state_key for branch in parallel.branches] == ["support", "tone"]


def test_state_template_and_condition_helpers_match_contract_expectations() -> None:
    state = create_initial_state(
        {"userQuery": "Refund request"},
        {"userQuery": "string", "priority": {"type": "string", "default": "normal"}},
    )

    assert state == {"userQuery": "Refund request", "priority": "normal"}
    assert resolve_path({"a": {"b": 3}}, "a.b") == 3
    assert interpolate("Request: {{userQuery}}", state) == "Request: Refund request"
    assert render_template("{{#if priority == normal}}go{{/if}}", state) == "go"
    assert evaluate_condition("{{priority}} == normal && {{userQuery}} != missing", state)
    assert not evaluate_condition("{{priority}} == urgent || {{missing}}", state)


def test_input_transform_and_output_mapping_preserve_simple_reference_types() -> None:
    state = {"a": 2, "b": 3, "classify": {"answer": "ok", "confidence": 0.82}}

    assert apply_input_transform({"a": "{{a}}", "label": "n={{b}}"}, state, None) == {
        "a": 2,
        "label": "n=3",
    }
    assert apply_output_mapping(
        {"answer": "{{classify.answer}}", "confidence": "{{classify.confidence}}"},
        state,
    ) == {"answer": "ok", "confidence": 0.82}


@pytest.mark.asyncio
async def test_execute_llm_and_tool_manifests() -> None:
    support = load_manifest_file(MANIFESTS / "simple-llm.yaml")
    calculator = load_manifest_file(MANIFESTS / "local-tool.yaml")
    ctx = FakeContext({"support": support, "calculator": calculator})

    llm_result = await execute(support, {"userQuery": "Refund request"}, ctx)
    assert llm_result.output == {"answer": "Use the refund workflow.", "confidence": 0.82}
    assert ctx.llm_calls[0][1] == "You are a careful support agent.\n"
    assert ctx.llm_calls[0][2] == "Help with this request: Refund request\n"

    tool_result = await execute(calculator, {"a": 2, "b": 3}, ctx)
    assert tool_result.output == {"result": 5.0}
    assert ctx.tool_calls[0][0].params == {"a": "2", "b": "3"}


@pytest.mark.asyncio
async def test_execute_sequential_and_parallel_manifests() -> None:
    support = load_manifest_file(MANIFESTS / "simple-llm.yaml")
    sequential = load_manifest_file(MANIFESTS / "sequential.yaml")
    parallel = load_manifest_file(MANIFESTS / "parallel.yaml")
    ctx = FakeContext({"support": support})

    sequential_result = await execute(sequential, {"userQuery": "Refund request"}, ctx)
    assert sequential_result.output == {
        "answer": "Use the refund workflow.",
        "confidence": 0.82,
    }
    assert sequential_result.state["classify"] == {
        "answer": "Use the refund workflow.",
        "confidence": 0.82,
    }

    parallel_result = await execute(parallel, {"userQuery": "Refund request"}, ctx)
    assert parallel_result.output == {
        "support": "Use the refund workflow.",
        "tone": "clear",
    }
