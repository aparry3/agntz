# @agntz/stores

Storage contracts and store implementations for agntz.

```ts
import type { AgntzStore } from "@agntz/stores/contracts";
import { MemoryStore } from "@agntz/stores/memory";
import { PostgresStore } from "@agntz/stores/postgres";
import { SqliteStore } from "@agntz/stores/sqlite";
```

## Subpaths

| Subpath | Purpose |
|---|---|
| `@agntz/stores/contracts` | Runtime store contracts plus hosted API-key, namespace-root, and webhook-delivery contracts |
| `@agntz/stores/memory` | In-memory implementation for tests, demos, and local development |
| `@agntz/stores/postgres` | Postgres implementation for multi-process deployments |
| `@agntz/stores/sqlite` | SQLite implementation for embedded and single-process deployments |

The root export is intentionally lightweight. Driver-specific code is isolated
behind the `postgres` and `sqlite` subpaths.
