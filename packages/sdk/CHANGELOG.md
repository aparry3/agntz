# @agntz/sdk

## 6.0.0

### Minor Changes

- 4692c35: Add CLI publish support for migrating local agents, sessions, and memory into hosted agntz. Includes authenticated worker import endpoints, client import methods, session snapshot import support, and memory entry enumeration/import support.

### Patch Changes

- Updated dependencies [4692c35]
  - @agntz/client@1.2.0
  - @agntz/core@1.5.0
  - @agntz/memrez@3.0.0
  - @agntz/store-sqlite@6.0.0
  - @agntz/manifest@6.0.0

## 5.0.0

### Minor Changes

- 23d5cc9: Add manifest selection helpers and CLI support for AI-assisted agent edits.

### Patch Changes

- Updated dependencies [23d5cc9]
- Updated dependencies [a357dd1]
  - @agntz/manifest@5.0.0
  - @agntz/core@1.4.0
  - @agntz/store-sqlite@5.0.0

## 4.0.0

### Minor Changes

- 2879d18: Complete the first-class eval system with agent-scoped datasets, async hosted eval runs, cancellation, and latest-score persistence for version comparisons.

  Datasets now carry an `agentId`, evals validate that their default dataset belongs to the same agent, and failed cases with zero scores are included in aggregate scoring. Hosted eval runs now return immediately in a running state, persist progress case-by-case, support cancellation, and update a latest-score cache keyed by eval, dataset, and resolved agent version while preserving immutable run history.

### Patch Changes

- Updated dependencies [2879d18]
  - @agntz/core@1.3.0
  - @agntz/client@1.1.0
  - @agntz/store-sqlite@4.0.0
  - @agntz/manifest@4.0.0

## 3.0.5

### Patch Changes

- Updated dependencies [665142b]
  - @agntz/core@1.2.3
  - @agntz/manifest@3.0.0
  - @agntz/store-sqlite@3.0.0

## 3.0.4

### Patch Changes

- Updated dependencies [[`8b11015`](https://github.com/aparry3/agntz/commit/8b1101595af7c7b1277707a6a377c4c62a7559e6)]:
  - @agntz/core@1.2.2
  - @agntz/manifest@3.0.0
  - @agntz/store-sqlite@3.0.0

## 3.0.3

### Patch Changes

- [#70](https://github.com/aparry3/agntz/pull/70) [`7c554c0`](https://github.com/aparry3/agntz/commit/7c554c0e45d00425ecbd56cf0b5000ccc3802630) Thanks [@aparry3](https://github.com/aparry3)! - Improve CLI help output and document the local-first create, edit, and run workflow.

## 3.0.2

### Patch Changes

- Updated dependencies []:
  - @agntz/client@1.0.1

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
