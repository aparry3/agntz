"""Small SSE parser matching the TypeScript client behavior."""

from __future__ import annotations

from collections.abc import AsyncIterable, Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class SseFrame:
    data: str
    event: str | None = None
    id: str | None = None


def parse_sse(chunks: Iterable[str]) -> Iterable[SseFrame]:
    buffer = ""
    for chunk in chunks:
        buffer += chunk
        while True:
            boundary = _find_boundary(buffer)
            if boundary is None:
                break
            index, length = boundary
            raw = buffer[:index]
            buffer = buffer[index + length :]
            frame = _parse_frame(raw)
            if frame is not None:
                yield frame

    if buffer:
        frame = _parse_frame(buffer)
        if frame is not None:
            yield frame


async def parse_sse_async(chunks: AsyncIterable[str]) -> AsyncIterable[SseFrame]:
    buffer = ""
    async for chunk in chunks:
        buffer += chunk
        while True:
            boundary = _find_boundary(buffer)
            if boundary is None:
                break
            index, length = boundary
            raw = buffer[:index]
            buffer = buffer[index + length :]
            frame = _parse_frame(raw)
            if frame is not None:
                yield frame

    if buffer:
        frame = _parse_frame(buffer)
        if frame is not None:
            yield frame


def _find_boundary(buffer: str) -> tuple[int, int] | None:
    idx_n = buffer.find("\n\n")
    idx_rn = buffer.find("\r\n\r\n")
    if idx_n == -1 and idx_rn == -1:
        return None
    if idx_rn != -1 and (idx_n == -1 or idx_rn < idx_n):
        return idx_rn, 4
    return idx_n, 2


def _parse_frame(raw: str) -> SseFrame | None:
    event: str | None = None
    frame_id: str | None = None
    data: list[str] = []
    has_field = False

    for line in raw.splitlines():
        if not line or line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if field == "event":
            event = value
            has_field = True
        elif field == "data":
            data.append(value)
            has_field = True
        elif field == "id":
            frame_id = value
            has_field = True

    if not has_field:
        return None
    return SseFrame(event=event, data="\n".join(data), id=frame_id)
