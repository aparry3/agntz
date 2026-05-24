"""Template helpers matching the TypeScript manifest package."""

from __future__ import annotations

import json
import re
from typing import Any

from .types import AgentState

_INTERPOLATION_RE = re.compile(r"\{\{([^#/}][^}]*?)\}\}")


def resolve_path(state: AgentState, path: str) -> Any:
    current: Any = state
    for segment in path.split("."):
        if not isinstance(current, dict):
            return None
        if segment not in current:
            return None
        current = current[segment]
    return current


def interpolate(template: str, state: AgentState) -> str:
    def replace(match: re.Match[str]) -> str:
        value = resolve_path(state, match.group(1).strip())
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, dict | list):
            return json.dumps(value, separators=(",", ":"))
        return str(value)

    return _INTERPOLATION_RE.sub(replace, template)


def render_template(template: str, state: AgentState) -> str:
    return interpolate(_process_conditionals(template, state), state)


def is_truthy(value: Any) -> bool:
    return value not in (None, "", 0, False)


def _process_conditionals(template: str, state: AgentState) -> str:
    open_tag = "{{#if "
    close_tag = "{{/if}}"
    result = ""
    index = 0

    while index < len(template):
        open_index = template.find(open_tag, index)
        if open_index == -1:
            result += template[index:]
            break

        result += template[index:open_index]
        condition_end = template.find("}}", open_index + len(open_tag))
        if condition_end == -1:
            result += template[open_index:]
            break

        condition = template[open_index + len(open_tag) : condition_end].strip()
        body_start = condition_end + 2
        depth = 1
        cursor = body_start

        while cursor < len(template) and depth > 0:
            next_open = template.find(open_tag, cursor)
            next_close = template.find(close_tag, cursor)
            if next_close == -1:
                break
            if next_open != -1 and next_open < next_close:
                depth += 1
                cursor = next_open + len(open_tag)
            else:
                depth -= 1
                if depth == 0:
                    body = template[body_start:next_close]
                    if _evaluate_if_condition(condition, state):
                        result += _process_conditionals(body, state)
                    index = next_close + len(close_tag)
                    break
                cursor = next_close + len(close_tag)

        if depth > 0:
            result += template[open_index:]
            break

    return result


def _evaluate_if_condition(condition: str, state: AgentState) -> bool:
    match = re.match(r"^(.+?)\s*(==|!=)\s*(.+)$", condition)
    if match:
        left = _resolve_condition_value(match.group(1).strip(), state)
        right = _parse_condition_literal(match.group(3).strip())
        equal = _js_equal(left, right)
        return equal if match.group(2) == "==" else not equal
    return is_truthy(resolve_path(state, condition))


def _resolve_condition_value(expr: str, state: AgentState) -> Any:
    if not expr.startswith(('"', "'")):
        return resolve_path(state, expr)
    return _parse_condition_literal(expr)


def _parse_condition_literal(value: str) -> Any:
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
    try:
        return float(value) if "." in value else int(value)
    except ValueError:
        return value


def _js_equal(left: Any, right: Any) -> bool:
    if type(left) is type(right):
        return left == right
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, bool):
        return _js_equal(1 if left else 0, right)
    if isinstance(right, bool):
        return _js_equal(left, 1 if right else 0)
    if isinstance(left, str) and isinstance(right, int | float):
        return _number_or_none(left) == right
    if isinstance(right, str) and isinstance(left, int | float):
        return left == _number_or_none(right)
    return left == right


def _number_or_none(value: str) -> int | float | None:
    try:
        return float(value) if "." in value else int(value)
    except ValueError:
        return None
