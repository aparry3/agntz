export default `# Package architecture

Agntz is a monorepo, but the packages have distinct jobs. Use the smallest package that matches your use case.

## Public package map

| Package | Use when you need |
|---|---|
| \`@agntz/sdk\` | Embedded TypeScript execution, local client resources, CLI, local SQLite helper |
| \`@agntz/client\` | Hosted or self-hosted HTTP client for agents, runs, sessions, memory, traces, datasets, and evals |
| \`@agntz/core\` | Low-level runner, tool definitions, model providers, telemetry, MCP helpers, and \`@agntz/core/manifest\` |
| \`@agntz/contracts\` | Shared store/resource ports, entity types, namespace grants, agent refs, errors, and leaf utilities |
| \`@agntz/db\` | Shared SQLite/Postgres connection and migration plumbing |
| \`@agntz/stores\` | Store contracts plus in-memory, SQLite, and Postgres implementations |
| \`@agntz/memrez\` | Durable memory resource provider, memory stores, reasoners, curation |
| \`agntz\` | Python hosted client, embedded runtime, stores, and memrez resources |

The old standalone manifest package has been merged into \`@agntz/core/manifest\`.

## Boundary rules

- Runtime execution belongs in \`@agntz/core\`.
- Shared data contracts and pure helpers belong in \`@agntz/contracts\`.
- Database connection/migration helpers belong in \`@agntz/db\`.
- Hosted identity and tenant policy belong in app/worker code, not in resource libraries.
- Resource packages such as memrez depend on contracts and accept host-provided model providers instead of constructing the runtime.
- Store adapters implement contracts without depending on core runtime internals.

## Which package should I import?

For most applications:

\`\`\`ts
import { agntz } from "@agntz/sdk";
import { AgntzClient } from "@agntz/client";
\`\`\`

Use \`@agntz/core\` directly when you are building a custom runtime host or need the low-level runner. Use \`@agntz/stores\` when you need persistent runtime or hosted control-plane storage.
`;
