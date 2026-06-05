"""Helpers for parsing versioned agent references."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime

_ALIAS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_ISO_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$")


@dataclass(frozen=True)
class ParsedAgentRef:
    agent_id: str
    version: str | None = None


class InvalidAgentRefError(ValueError):
    def __init__(self, value: str, reason: str) -> None:
        super().__init__(f'Invalid agent reference "{value}": {reason}')
        self.value = value
        self.reason = reason


def is_iso_timestamp(value: str) -> bool:
    if not _ISO_TIMESTAMP_RE.match(value):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return _to_iso_z(parsed) == _normalize_iso_for_compare(value)


def is_alias_name(value: str) -> bool:
    return value != "latest" and not is_iso_timestamp(value) and bool(_ALIAS_RE.match(value))


def parse_agent_ref(value: str) -> ParsedAgentRef:
    if not isinstance(value, str):
        raise InvalidAgentRefError(str(value), "must be a string")
    if not value:
        raise InvalidAgentRefError(value, "agent id is empty")
    if value != value.strip() or any(ch.isspace() for ch in value):
        raise InvalidAgentRefError(value, "must not contain whitespace")
    if "@" not in value:
        return ParsedAgentRef(agent_id=value)
    agent_id, version = value.split("@", 1)
    if not agent_id:
        raise InvalidAgentRefError(value, "agent id is empty")
    if not version:
        raise InvalidAgentRefError(value, "version is empty after '@'")
    if "@" in version:
        raise InvalidAgentRefError(value, "more than one '@' is not allowed")
    if version != "latest" and not is_iso_timestamp(version) and not is_alias_name(version):
        raise InvalidAgentRefError(
            value,
            f'version must be "latest", an ISO 8601 timestamp, or an alias (got "{version}")',
        )
    return ParsedAgentRef(agent_id=agent_id, version=version)


def format_agent_ref(ref: ParsedAgentRef) -> str:
    return f"{ref.agent_id}@{ref.version}" if ref.version else ref.agent_id


def _normalize_iso_for_compare(value: str) -> str:
    if "." not in value:
        return value.replace("Z", ".000Z")
    prefix, fraction = value[:-1].split(".", 1)
    return f"{prefix}.{(fraction + '000')[:3]}Z"


def _to_iso_z(value: datetime) -> str:
    normalized = value.astimezone(UTC)
    return normalized.isoformat(timespec="milliseconds").replace("+00:00", "Z")
