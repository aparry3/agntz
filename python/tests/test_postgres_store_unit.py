from __future__ import annotations

from agntz.stores.postgres import _json_loads


def test_json_loads_preserves_already_decoded_jsonb_strings() -> None:
    assert _json_loads("hello") == "hello"
    assert _json_loads('{"ok":true}') == {"ok": True}
