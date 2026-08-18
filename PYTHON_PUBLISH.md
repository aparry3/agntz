# Publishing `agntz` to PyPI

The Python SDK is published as a single PyPI package.

| Directory | Package name | Local version | Published version | Publish status |
|---|---|---:|---:|---|
| `python` | `agntz` | 0.5.1 | 0.2.0 | publishable |

The package includes the hosted client, local SDK/runtime, manifest execution,
memrez resources, namespace grant security, SQLite/Postgres stores, and the
Python store adapters.

The `0.5.1` package is the next public Python SDK release; `0.2.0` is currently
published. Earlier PyPI releases were experimental pre-baseline iterations.
Publishing is automated through Trusted Publishing. Yanking an earlier release
requires a PyPI project owner in the PyPI UI, or a future PyPI API token if we
choose to automate that maintenance action.

## Prerequisites

- A PyPI account that can manage the `agntz` project.
- A PyPI Trusted Publisher configured for this repository:
  - PyPI project name: `agntz`
  - Owner: `aparry3`
  - Repository: `agntz`
  - Workflow name: `python-release.yml`
  - Environment name: `pypi`

## Release flow

1. Confirm `python/pyproject.toml` has the next version.
2. Move `python/CHANGELOG.md` entries from `Unreleased` into that version.
3. Run local validation:
   ```sh
   cd python
   python -m pip install -e '.[dev]'
   python -m pytest
   python -m ruff check .
   python -m basedpyright
   python -m build
   ```
   The test suite includes the shared
   `contracts/hosted-client-parity.json` gate. Confirm it covers all six
   manifest kinds, rich content/artifacts, retention, normalized results, and
   durable starts.
4. Merge the version and documentation PR.
5. Run the release workflow:
   ```sh
   gh workflow run python-release.yml --ref main --repo aparry3/agntz
   ```
6. Watch the run:
   ```sh
   gh run list --workflow "Python Release" --limit 1 --repo aparry3/agntz
   ```

## Verify a release

```sh
python3 -m pip index versions agntz

tmpdir="$(mktemp -d)"
cd "$tmpdir"
python3 -m venv .venv
. .venv/bin/activate
python -m pip install "agntz[postgres,litellm]"
python - <<'PY'
from agntz import AgntzClient, AsyncAgntzClient, agntz
from agntz.resources.memrez import create_memrez

print(AgntzClient, AsyncAgntzClient, agntz, create_memrez)
print("ok")
PY
```

Smoke-test the packaged hosted contract without making a provider call:

```sh
python - <<'PY'
from agntz import AgntzClient
from agntz.client.models import RetentionRequest, RunResult

result = RunResult.model_validate({
    "output": {"text": "ok"},
    "runId": "run_smoke",
    "model": "test-model",
    "usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
    "retention": {"mode": "result"},
})
assert result.retention == RetentionRequest(mode="result")
print(AgntzClient, result.run_id, result.usage.total_tokens)
PY
```

## Manual publish escape hatch

Only use this if Trusted Publishing is unavailable.

```sh
cd python
python -m pip install -e '.[dev]'
python -m pytest
python -m ruff check .
python -m basedpyright
python -m build
python -m pip install twine
python -m twine upload dist/*
```
