from __future__ import annotations

from datetime import UTC, datetime

from agntz.stores.postgres import _json_loads, _pg_iso


def test_json_loads_preserves_already_decoded_jsonb_strings() -> None:
    assert _json_loads("hello") == "hello"
    assert _json_loads('{"ok":true}') == {"ok": True}


def test_pg_iso_normalizes_datetime_and_text_offsets_to_utc() -> None:
    expected = "2026-07-10T17:06:45.505Z"

    assert _pg_iso("2026-07-10 13:06:45.505-04") == expected
    assert _pg_iso(datetime.fromisoformat("2026-07-10T13:06:45.505-04:00")) == expected
    assert _pg_iso(datetime(2026, 7, 10, 17, 6, 45, 505000, tzinfo=UTC)) == expected
