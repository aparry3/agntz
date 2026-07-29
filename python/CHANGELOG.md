# agntz

## Unreleased

## 0.3.0 - 2026-07-28

- Add hosted rich-content and managed-artifact APIs with automatic local-file
  upload in both synchronous and asynchronous clients.
- Add `none`, `result`, and `session` retention requests, normalized
  provider/model/usage/version results, and `agents.start()` parity.
- Gate the migration-critical hosted surface against the shared TypeScript
  contract in `contracts/hosted-client-parity.json`.
- Normalize hosted streaming events for all six manifest kinds and preserve
  retention metadata for sessionless `none` and `result` runs.
- Rename the local Python command to `agntz-py` so it no longer collides with
  the full `agntz` CLI distributed by `@agntz/sdk`.
- Add file-or-directory validation with canonical JSON reports, a safe
  `./agents` default, ignored generated directories, and empty-set failure.
- Normalize Postgres timestamps to UTC and align step/reply parsing with the
  shared manifest contract.
- Expand PyPI project metadata and installed-wheel verification.

## 0.2.0 - 2026-06-29

- Promote the current Python SDK baseline above the earlier `0.1.0` PyPI
  release so default installs resolve to the current package.
- Keeps the June 2026 hosted client, local manifest execution, resources,
  memrez integration, namespace grants, eval helpers, in-memory/SQLite/Postgres
  stores, and typed package exports in the latest PyPI release line.

## 0.0.0 - 2026-06-26

- Establish the public baseline for the Python SDK.
- Includes hosted sync/async clients, local manifest execution, resources, memrez integration, namespace grants, eval helpers, in-memory/SQLite/Postgres stores, and typed package exports.
- Earlier PyPI releases were experimental pre-baseline iterations.
