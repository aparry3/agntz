# agntz

## 0.4.0

- Remove agent-level memrez topic taxonomy config from the Python memory
  resource provider. Agent manifests now control preload/read/write behavior;
  taxonomy and reasoner policy are reserved for Memrez-level configuration.
- Add memrez delete primitives: `delete_entry`, `delete_scope`, and
  `list_entries` on the memory stores (in-memory, SQLite, Postgres);
  grant-authorized `Memrez.delete_entry`/`Memrez.delete_scope`; and a
  `MemoryResourceProvider.purge_scope` cascade hook.
- Add a `memory` resource to the local SDK (`LocalClient.memory`,
  `agntz(..., memrez=...)`) exposing scan/read/list/delete_entry/delete_scope/
  curate/correct, mirroring the TypeScript `@agntz/sdk` surface.
- Add a `memory` resource to the sync and async hosted clients
  (`AgntzClient.memory`/`AsyncAgntzClient.memory`) plus TypeScript-compatible
  memory wire models (`MemoryEntry`, `MemoryScanResult`, `ScopeDeleteResult`,
  and friends).
- Add per-tenant namespace roots: `NamespaceRootStore` methods on the
  in-memory/SQLite/Postgres stores (and a `tenant_namespace_roots` table) plus
  `GET/POST/DELETE /namespace-roots` on `agntz.server`.
- Add `/memory/*` and `/scopes/delete` routes to `agntz.server.create_app`
  (with a new `memrez=` parameter), bounding every memory/scope request to the
  caller's registered roots and disabling memrez ancestor expansion for bounded
  (non-super-admin) callers so ancestor-scope entries never leak across tenants.

## 0.3.0

- Add memrez's built-in LLM reasoner default, content-only memory write tool,
  preload/topic-policy config, dirty-topic tracking, correction, audit listing,
  and multi-topic reads to the Python SDK.

## 0.2.0

- Add versioned agent storage and resolution for bare ids, `@latest`, exact
  timestamps, and aliases across local and hosted Python execution.
- Add agent, version, alias, dataset, eval, eval-run, cancellation, and latest
  score resources to the sync and async hosted clients and the local SDK.
- Add eval definition, dataset, run, case-result, summary, and latest-score
  models with TypeScript-compatible wire aliases.
- Add eval execution helpers for pass thresholds, weighted criteria, judge JSON
  parsing, summaries, latest-score derivation, and append-only run history.
- Extend MemoryStore and SQLiteStore with hosted-service data surfaces,
  including agents, aliases, evals, datasets, eval runs, latest scores, and API
  keys.
- Add PostgresStore for Python hosted deployments using the existing
  `postgres` extra and hosted-compatible table names.
- Add the optional `server` extra and `agntz.server.create_app` FastAPI/ASGI
  service factory for Python backends.

## 0.1.1

- Preserve detailed LiteLLM token usage fields, including reasoning and cached-token metadata.
- Enable OpenRouter parallel tool calls when tools are present so runtime parallel-tool smoke tests execute through the Python SDK.
- Verify shared local sessions stay portable when different providers read the same session history.
