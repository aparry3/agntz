from __future__ import annotations

import json
import shutil
from pathlib import Path

from agntz.cli import run_cli

ROOT = Path(__file__).resolve().parents[3]
MANIFESTS = ROOT / "contracts" / "python-port" / "manifests"


def _copy_agents(tmp_path: Path) -> Path:
    target = tmp_path / "agents"
    target.mkdir()
    for path in MANIFESTS.glob("*.yaml"):
        shutil.copy(path, target / path.name)
    return target


def test_cli_validate_success(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    agents = _copy_agents(tmp_path)

    status = run_cli(["validate", str(agents)])

    captured = capsys.readouterr()
    assert status == 0
    assert "Validated 5 agent manifest(s)." in captured.out


def test_cli_validate_reports_missing_ref(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    agents = tmp_path / "agents"
    agents.mkdir()
    (agents / "bad.yaml").write_text(
        """
id: bad-flow
kind: sequential
steps:
  - ref: missing-agent
""",
        encoding="utf-8",
    )

    status = run_cli(["validate", str(agents)])

    captured = capsys.readouterr()
    assert status == 1
    assert "missing-agent" in captured.out


def test_cli_validate_json_accepts_a_single_file(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    agents = _copy_agents(tmp_path)

    status = run_cli(["validate", str(agents / "simple-llm.yaml"), "--json"])

    payload = json.loads(capsys.readouterr().out)
    assert status == 0
    assert payload["valid"] is True
    assert payload["counts"] == {"errors": 0, "files": 1, "warnings": 0}


def test_cli_validate_fails_for_an_empty_directory(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    agents = tmp_path / "agents"
    agents.mkdir()

    status = run_cli(["validate", str(agents), "--json"])

    payload = json.loads(capsys.readouterr().out)
    assert status == 1
    assert payload["valid"] is False
    assert payload["counts"] == {"errors": 1, "files": 0, "warnings": 0}
    assert "No YAML agent manifests" in payload["errors"][0]["message"]


def test_cli_validate_defaults_to_agents_and_ignores_dependencies(
    tmp_path: Path, capsys, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    agents = tmp_path / "agents"
    dependency_dir = agents / "node_modules"
    dependency_dir.mkdir(parents=True)
    (agents / "hello.yaml").write_text(
        "id: hello\nkind: llm\nmodel: {provider: openai, name: gpt-5.4}\ninstruction: Hello",
        encoding="utf-8",
    )
    (dependency_dir / "not-an-agent.yaml").write_text("lockfileVersion: 9", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    status = run_cli(["validate", "--json"])

    payload = json.loads(capsys.readouterr().out)
    assert status == 0
    assert payload["valid"] is True
    assert payload["counts"] == {"errors": 0, "files": 1, "warnings": 0}
    assert payload["files"][0]["path"] == "agents/hello.yaml"


def test_cli_run_rejects_invalid_json(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    agents = _copy_agents(tmp_path)

    status = run_cli(["run", str(agents), "support", "--input", "{bad"])

    captured = capsys.readouterr()
    assert status == 1
    assert "Invalid --input JSON" in captured.out
