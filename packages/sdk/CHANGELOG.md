# @agntz/sdk

## 3.0.1

### Patch Changes

- Updated dependencies [[`c43b184`](https://github.com/aparry3/agntz/commit/c43b184ee004bd7298fa8a48ba1d465048c5b96b)]:
  - @agntz/core@1.2.1
  - @agntz/manifest@3.0.0
  - @agntz/store-sqlite@3.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [[`2d098f4`](https://github.com/aparry3/agntz/commit/2d098f4713151a120b12f85d4abd630835840b56)]:
  - @agntz/core@1.2.0
  - @agntz/manifest@3.0.0
  - @agntz/store-sqlite@3.0.0

## 2.0.0

### Major Changes

- Renamed from `@agntz/runner`. Same code, new name. `@agntz/sdk` is now the canonical name for the embedded YAML agent runner — the library you build agntz apps with. The old `@agntz/sdk` (the HTTP client) has been renamed to `@agntz/client`. The old `@agntz/runner` package on npm is deprecated; new work goes here.

  Migration:

  ```diff
  - import { agntz } from "@agntz/runner";
  + import { agntz } from "@agntz/sdk";

  - import { sqliteStore } from "@agntz/runner/sqlite";
  + import { sqliteStore } from "@agntz/sdk/sqlite";
  ```

  Also adds a CLI: `agntz create "description"` (generate YAML via the hosted agent-builder) and `agntz run path/to.yaml` (run a manifest locally). See README.

## 1.0.0 (as @agntz/runner)

### Minor Changes

- [#38](https://github.com/aparry3/agntz/pull/38) [`44a8bd0`](https://github.com/aparry3/agntz/commit/44a8bd0feebfffb6cdf4e22a6aa4b326244bf166) Thanks [@aparry3](https://github.com/aparry3)! - Introduce `@agntz/runner` — embedded library for running agntz agents in-process from local YAML files.

  The five-line-of-code path:

  ```ts
  import { agntz } from "@agntz/runner";
  const client = await agntz({ agents: "./agents" });
  const result = await client.agents.run({ agentId: "support", input: "..." });
  ```

  SDK-shaped surface (`.agents.run/stream`, `.runs.list/get`, `.traces.list/get`) so user code graduates to the hosted client with a single import-line change. Supports all four agent kinds (LLM, tool, sequential, parallel), local + HTTP + MCP tools, subagents, in-memory sessions, and `@agntz/runner/sqlite` for persistent storage. Real span hierarchy from `@agntz/manifest`'s executor feeds the in-memory `TracesBuffer`.

  **`@agntz/core`** and **`@agntz/manifest`** gain `{{env.NAME}}` template support for resolving env vars (typically `process.env`) in HTTP/MCP tool credentials, parallel to the existing `{{secrets.X}}` machinery. Embedded mode wires this on by default; hosted servers leave the new `RunnerConfig.envProvider` unset so user manifests can't read server env. The manifest validator emits warnings (never errors) on missing env refs.

  **`@agntz/core`** also adds `Runner.deregisterAgent()` for cleaning up in-memory temp agents — used by `@agntz/runner` for the per-LLM-step temp-agent dance during pipeline execution.

### Patch Changes

- Updated dependencies [[`44a8bd0`](https://github.com/aparry3/agntz/commit/44a8bd0feebfffb6cdf4e22a6aa4b326244bf166)]:
  - @agntz/core@1.1.0
  - @agntz/manifest@2.0.0
  - @agntz/store-sqlite@2.0.0
