# Library vs. Application Separation

**Status:** mostly implemented; use this as a remaining-work tracker only.
**Last refreshed:** 2026-06-18

## Current boundary

The TypeScript package split is now:

| Layer | Package | Owns |
|---|---|---|
| Runtime | `@agntz/core` | Runner, runtime tool execution, model providers, telemetry, MCP helpers, `@agntz/core/manifest` |
| Contracts | `@agntz/contracts` | Store/resource ports, shared entities, namespace grants, agent refs, base errors, leaf utilities |
| Database plumbing | `@agntz/db` | SQLite/Postgres connection and migration helpers |
| Platform | `@agntz/platform` | API-key, namespace-root, webhook-delivery, and hosted platform store contracts |
| Resources | `@agntz/memrez` | Memory provider, memory stores, reasoners |
| Stores | `@agntz/store-sqlite`, `@agntz/store-postgres` | Concrete runtime + platform store implementations |
| Embedded host | `@agntz/sdk` | Local client, CLI, manifest loading, local execution wiring |
| Hosted host | `@agntz/worker`, `@agntz/app`, `@agntz/client` | Transport, identity, tenant policy, UI, hosted API |

The old standalone manifest package has been merged into the core manifest
subpath. Store and resource adapters should depend on contracts/db/platform, not
on runtime execution internals.

## Rules to preserve

- Libraries own capabilities and contracts; applications own identity,
  transport, tenant policy, rate limits, and UI.
- Runtime tools can receive full `ToolContext`; resource providers should stay
  on the pure-data `ResourceToolContext`.
- Store adapters should not pull in model-provider dependencies.
- Hosted tenant isolation belongs in app/worker/platform layers; embedded SDKs
  stay transport-free and identity-free.
- Python may mirror behavior without mirroring every TypeScript package if the
  Python layering already avoids the same dependency problem.

## Remaining checks

- Keep docs and package metadata aligned with the current package map before
  every release.
- Re-check any new resource package against the same boundary: contracts first,
  concrete adapter second, host wiring last.
- If platform APIs grow beyond store contracts, keep user-facing HTTP concerns in
  app/worker docs and keep package docs focused on the library boundary.
- Convert any active HTML-only planning artifact to markdown before
  implementation so it can be reviewed and searched cleanly.
