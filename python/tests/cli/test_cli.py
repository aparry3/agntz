from __future__ import annotations

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
    assert "Validated 4 agent manifest(s)." in captured.out


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


def test_cli_run_rejects_invalid_json(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    agents = _copy_agents(tmp_path)

    status = run_cli(["run", str(agents), "support", "--input", "{bad"])

    captured = capsys.readouterr()
    assert status == 1
    assert "Invalid --input JSON" in captured.out
