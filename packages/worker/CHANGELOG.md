# @agntz/worker

## 0.2.2

### Patch Changes

- cfae485: Deduplicate the manifest→runner execution bridge shared by the embedded SDK and the hosted worker.

  - **@agntz/core** gains `createManifestExecutionContext(runner, opts)` (+ `ManifestExecutionContextOptions`, `ManifestBridgeHooks`) — the single shared implementation of the manifest `ExecutionContext` (`invokeLLM`/`invokeTool`, output parsing, temp-agent lifecycle). Both hosts previously re-implemented this; they now supply only their environment-specific seams (`resolveAgent` source, temp-agent cleanup, `spawnable` pre-registration, local-tool dispatch, observability hooks) and delegate the shared mechanics here. The exported `createExecutionContext` signatures in `@agntz/sdk` and `@agntz/worker` are unchanged, so call sites are untouched.
  - **@agntz/worker** — parity/bug fix: `http` **pipeline tool steps** now forward `body`/`body_type`/`auth` and the runner's `tokenResolver`/`tokenCache`, which the worker previously dropped (authed or bodied http pipeline steps worked in the embedded SDK but silently misfired hosted). The `[llm]`/`[tool]` console breadcrumbs are preserved via the new hooks. Minor edge-case alignment: an explicit empty `state.userQuery` is now used verbatim as the user message (matching the SDK) instead of being replaced by the serialized state.
  - **@agntz/sdk** — drops its hand-rolled namespace-grant validators in favor of `@agntz/contracts`' canonical `normalizeNamespaceGrants`/`narrowNamespaceGrants` (re-exported by `@agntz/core`). Validation rules are identical; malformed grants now throw a typed `NamespaceGrantError` instead of a plain `Error`.

  Internal consolidation; no public API changes beyond the new `@agntz/core` exports.

- e97fd52: Merge `@agntz/manifest` into `@agntz/core` and remove the standalone package.

  The YAML manifest engine (parser, validator, template engine, state, and the graph executor) now ships as part of `@agntz/core`, exposed at the **`@agntz/core/manifest`** subpath. Import its API from there instead of `@agntz/manifest` — the standalone package is removed. The DSL itself is unchanged; this is a packaging consolidation (manifest and the runtime are always used together). `@agntz/sdk` and `@agntz/worker` are repointed to the subpath.

- Updated dependencies [cfae485]
- Updated dependencies [5f2a42e]
- Updated dependencies [0ed0d94]
- Updated dependencies [c27f2d9]
- Updated dependencies [e97fd52]
- Updated dependencies [6d35efe]
  - @agntz/core@1.7.0
  - @agntz/store-postgres@7.1.0
  - @agntz/memrez@4.1.0
  - @agntz/platform@1.0.0

## 0.2.1

### Patch Changes

- Updated dependencies [0749711]
  - @agntz/core@1.6.0
  - @agntz/memrez@4.0.0
  - @agntz/store-postgres@7.0.0
  - @agntz/manifest@7.0.0

## 0.2.0

### Minor Changes

- 4692c35: Add CLI publish support for migrating local agents, sessions, and memory into hosted agntz. Includes authenticated worker import endpoints, client import methods, session snapshot import support, and memory entry enumeration/import support.

### Patch Changes

- Updated dependencies [4692c35]
  - @agntz/core@1.5.0
  - @agntz/memrez@3.0.0
  - @agntz/store-postgres@6.0.0
  - @agntz/manifest@6.0.0

## 0.1.10

### Patch Changes

- Updated dependencies [c934126]
  - @agntz/memrez@2.1.1

## 0.1.9

### Patch Changes

- Updated dependencies [2e92a9f]
  - @agntz/memrez@2.1.0

## 0.1.8

### Patch Changes

- Updated dependencies [23d5cc9]
- Updated dependencies [a357dd1]
  - @agntz/manifest@5.0.0
  - @agntz/core@1.4.0
  - @agntz/store-postgres@5.0.0

## 0.1.7

### Patch Changes

- Updated dependencies [2879d18]
  - @agntz/core@1.3.0
  - @agntz/store-postgres@4.0.0
  - @agntz/manifest@4.0.0

## 0.1.6

### Patch Changes

- Updated dependencies [665142b]
  - @agntz/core@1.2.3
  - @agntz/manifest@3.0.0
  - @agntz/store-postgres@3.0.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`8b11015`](https://github.com/aparry3/agntz/commit/8b1101595af7c7b1277707a6a377c4c62a7559e6)]:
  - @agntz/core@1.2.2
  - @agntz/manifest@3.0.0
  - @agntz/store-postgres@3.0.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`c43b184`](https://github.com/aparry3/agntz/commit/c43b184ee004bd7298fa8a48ba1d465048c5b96b)]:
  - @agntz/core@1.2.1
  - @agntz/manifest@3.0.0
  - @agntz/store-postgres@3.0.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`2d098f4`](https://github.com/aparry3/agntz/commit/2d098f4713151a120b12f85d4abd630835840b56)]:
  - @agntz/core@1.2.0
  - @agntz/manifest@3.0.0
  - @agntz/store-postgres@3.0.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`44a8bd0`](https://github.com/aparry3/agntz/commit/44a8bd0feebfffb6cdf4e22a6aa4b326244bf166)]:
  - @agntz/core@1.1.0
  - @agntz/manifest@2.0.0
  - @agntz/store-postgres@2.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`5a6a2e5`](https://github.com/aparry3/agntz/commit/5a6a2e533246621319462f204f3e023f1458d678)]:
  - @agntz/core@1.0.0
  - @agntz/manifest@1.0.0
  - @agntz/store-postgres@1.0.0
