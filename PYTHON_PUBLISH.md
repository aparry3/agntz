# Publishing `agntz` to PyPI

The Python SDK is published as a single PyPI package.

| Directory | Package name | Local version | Published version | Publish status |
|---|---|---:|---:|---|
| `python` | `agntz` | 0.5.0 | 0.1.0 | publishable |

The package includes the hosted client, local SDK/runtime, manifest execution,
memrez resources, namespace grant security, SQLite/Postgres stores, and the
optional FastAPI server.

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
python -m pip install "agntz[postgres,litellm,server]"
python - <<'PY'
from agntz import AgntzClient, AsyncAgntzClient, agntz
from agntz.resources.memrez import create_memrez

print(AgntzClient, AsyncAgntzClient, agntz, create_memrez)
print("ok")
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
