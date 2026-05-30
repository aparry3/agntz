# Publishing `agntz` to PyPI

The Python SDK is published as a single PyPI package:

| Directory | Package name | Version | Publish status |
|---|---|---:|---|
| `python` | `agntz` | 0.1.0 | publishable |

The package includes the hosted client, local SDK/runtime, memrez, namespace
grant security, SQLite memory support, and Postgres memory support.

## Prerequisites

- A PyPI account that can manage the `agntz` project.
- A PyPI Trusted Publisher configured for this repository:
  - PyPI project name: `agntz`
  - Owner: `aparry3`
  - Repository: `agntz`
  - Workflow name: `python-release.yml`
  - Environment name: `pypi`

For the first release, configure this as a pending publisher from the PyPI
account publishing settings. The pending publisher creates the `agntz` project
when the workflow publishes the first distribution.

## Release flow

1. Update `python/pyproject.toml` with the next version.
2. Update the Python release notes. Use `python/README.md` for the first release;
   add `python/CHANGELOG.md` when release notes need more structure.
3. Open and merge a PR with the version and documentation changes.
4. Run the release workflow:

   ```sh
   gh workflow run python-release.yml --ref main --repo aparry3/agntz
   ```

5. Watch the run:

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
from agntz.memrez import create_memrez

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
