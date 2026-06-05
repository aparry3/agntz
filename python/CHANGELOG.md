# agntz

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
