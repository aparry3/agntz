"""Condition expression evaluation for manifest pipelines."""

from __future__ import annotations

from typing import Any, Literal

from .template import _js_equal, _number_or_none, is_truthy, resolve_path
from .types import AgentState

_Comparison = Literal[">=", "<=", "!=", "==", ">", "<"]


def evaluate_condition(expression: str, state: AgentState) -> bool:
    if "||" in expression:
        return any(evaluate_condition(part.strip(), state) for part in _split(expression, "||"))
    if "&&" in expression:
        return all(evaluate_condition(part.strip(), state) for part in _split(expression, "&&"))
    return _evaluate_single(expression.strip(), state)


def _evaluate_single(expression: str, state: AgentState) -> bool:
    for op in (">=", "<=", "!=", "==", ">", "<"):
        index = expression.find(op)
        if index != -1:
            left = _resolve_value(expression[:index].strip(), state)
            right = _resolve_value(expression[index + len(op) :].strip(), state)
            return _compare(left, right, op)  # type: ignore[arg-type]
    return is_truthy(_resolve_value(expression, state))


def _resolve_value(expression: str, state: AgentState) -> Any:
    if expression.startswith("{{") and expression.endswith("}}"):
        return resolve_path(state, expression[2:-2].strip())
    return _parse_literal(expression)


def _parse_literal(value: str) -> Any:
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null":
        return None
    number = _number_or_none(value)
    return number if number is not None else value


def _compare(left: Any, right: Any, op: _Comparison) -> bool:
    if op == "==":
        return _js_equal(left, right)
    if op == "!=":
        return not _js_equal(left, right)
    left_num = _number_or_none(str(left))
    right_num = _number_or_none(str(right))
    if left_num is None or right_num is None:
        return False
    if op == ">":
        return left_num > right_num
    if op == "<":
        return left_num < right_num
    if op == ">=":
        return left_num >= right_num
    return left_num <= right_num


def _split(expression: str, op: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    current = ""
    index = 0
    while index < len(expression):
        if expression[index : index + 2] == "{{":
            depth += 1
            current += "{{"
            index += 2
        elif expression[index : index + 2] == "}}":
            depth -= 1
            current += "}}"
            index += 2
        elif depth == 0 and expression[index : index + len(op)] == op:
            parts.append(current)
            current = ""
            index += len(op)
        else:
            current += expression[index]
            index += 1
    parts.append(current)
    return parts
