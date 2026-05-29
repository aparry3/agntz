"""Async manifest executor matching the TypeScript manifest package."""

from __future__ import annotations

import asyncio
from typing import Any

from .conditions import evaluate_condition
from .state import (
    apply_input_transform,
    apply_output_mapping,
    create_initial_state,
    get_state_key,
)
from .template import interpolate, render_template
from .types import (
    AgentManifest,
    AgentState,
    ExecutionContext,
    ExecutionResult,
    LLMAgentManifest,
    ParallelAgentManifest,
    SequentialAgentManifest,
    ToolAgentManifest,
)


async def execute(
    manifest: AgentManifest,
    input_value: Any,
    ctx: ExecutionContext,
) -> ExecutionResult:
    state = create_initial_state(input_value, manifest.input_schema)
    return await execute_with_state(manifest, state, ctx, input_value)


async def execute_with_state(
    manifest: AgentManifest,
    state: AgentState,
    ctx: ExecutionContext,
    parent_input: Any,
) -> ExecutionResult:
    if isinstance(manifest, LLMAgentManifest):
        return await _execute_llm(manifest, state, ctx)
    if isinstance(manifest, ToolAgentManifest):
        return await _execute_tool(manifest, state, ctx)
    if isinstance(manifest, SequentialAgentManifest):
        return await _execute_sequential(manifest, state, ctx, parent_input)
    if isinstance(manifest, ParallelAgentManifest):
        return await _execute_parallel(manifest, state, ctx, parent_input)
    raise TypeError(f"Unknown agent manifest type: {type(manifest).__name__}")


async def _execute_llm(
    manifest: LLMAgentManifest,
    state: AgentState,
    ctx: ExecutionContext,
) -> ExecutionResult:
    instruction = render_template(manifest.instruction, state)
    prompt = render_template(manifest.prompt, state) if manifest.prompt else None
    output = await ctx.invoke_llm(manifest, instruction, prompt, state)
    return ExecutionResult(output=output, state={**state})


async def _execute_tool(
    manifest: ToolAgentManifest,
    state: AgentState,
    ctx: ExecutionContext,
) -> ExecutionResult:
    resolved = manifest.tool.model_copy(deep=True)
    if resolved.params:
        resolved.params = {
            key: interpolate(str(template), state) for key, template in resolved.params.items()
        }
    output = await ctx.invoke_tool(resolved, state)
    return ExecutionResult(output=output, state={**state})


async def _execute_sequential(
    manifest: SequentialAgentManifest,
    state: AgentState,
    ctx: ExecutionContext,
    parent_input: Any,
) -> ExecutionResult:
    is_loop = bool(manifest.until)
    max_iterations = manifest.max_iterations or 100
    iteration = 0
    previous_output = parent_input

    while True:
        for step in manifest.steps:
            if step.when and not evaluate_condition(step.when, state):
                key = get_state_key(step)
                state[key] = None
                previous_output = None
                continue

            child = await _resolve_step_agent(step.agent, step.ref, ctx)
            child_input = apply_input_transform(step.input, state, previous_output)
            child_state = create_initial_state(child_input, child.input_schema)
            result = await execute_with_state(child, child_state, ctx, child_input)
            key = get_state_key(step)
            state[key] = result.output
            previous_output = result.output

        iteration += 1
        if not is_loop:
            break
        if manifest.until and evaluate_condition(manifest.until, state):
            break
        if iteration >= max_iterations:
            break

    if manifest.output:
        output = apply_output_mapping(manifest.output, state)
    elif manifest.steps:
        output = state[get_state_key(manifest.steps[-1])]
    else:
        output = None
    return ExecutionResult(output=output, state=state)


async def _execute_parallel(
    manifest: ParallelAgentManifest,
    state: AgentState,
    ctx: ExecutionContext,
    parent_input: Any,
) -> ExecutionResult:
    async def run_branch(step_index: int) -> tuple[str, Any]:
        step = manifest.branches[step_index]
        child = await _resolve_step_agent(step.agent, step.ref, ctx)
        child_input = apply_input_transform(step.input, state, parent_input)
        child_state = create_initial_state(child_input, child.input_schema)
        result = await execute_with_state(child, child_state, ctx, child_input)
        return get_state_key(step), result.output

    results = await asyncio.gather(*(run_branch(index) for index in range(len(manifest.branches))))
    for key, output in results:
        state[key] = output

    if manifest.output:
        output = apply_output_mapping(manifest.output, state)
    else:
        output = {key: value for key, value in results}
    return ExecutionResult(output=output, state=state)


async def _resolve_step_agent(
    agent: AgentManifest | None,
    ref: str | None,
    ctx: ExecutionContext,
) -> AgentManifest:
    if agent is not None:
        return agent
    if ref:
        return await ctx.resolve_agent(ref)
    raise ValueError("Step must have either 'ref' or inline 'agent'")
