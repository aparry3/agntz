# Embedded Runner (`@agntz/sdk`)

**Status:** Proposed
**Author:** Aaron + Claude
**Date:** 2026-05-19

## Problem

Today, the only way to run an agntz agent from your own code is via `@agntz/client`, which is a thin HTTP/SSE client to a hosted (or self-hosted) agntz server. That's right for production but heavy for "I want to try this in 5 lines of code." We want an embedded, in-process path:

1. Install one package.
2. Drop a YAML file in a directory.
3. Five lines of TypeScript later, your agent runs.

When the developer eventually wants persistence, observability beyond a local buffer, a real agent registry, or multi-user isolation, they graduate to the hosted SDK by changing one import line — the call surface is identical.

## Decisions snapshot

| Choice | Decision |
|---|---|
| Package shape | Separate `@agntz/sdk` package, not a mode of `@agntz/client` |
| Why separate | SDK is 76 KB / 0 runtime deps / universal; runner pulls ~60 MB of AI SDK providers (Node-only). Folding would destroy SDK's lightness and break its browser story. |
| API surface | Parity with SDK on `.agents.run/stream`, `.runs.list/get`, `.traces.list/get`. No evals, no agent CRUD, no secrets vault. |
| Type parity | Re-export `RunInput` / `RunResult` / `StreamEvent` / `TraceDetail` from `@agntz/client`. Graduation = one import line. |
| Tool wiring | YAML lists tool names (`kind: local`); init passes `{ name: handler }` map. Fail-fast at load time on missing names. |
| Sessions | In-memory by default. Optional sqlite via `@agntz/sdk/sqlite` subpath. |
| Traces | In-memory ring buffer + optional `onEvent` callback at init. |
| YAML reload | Load-once at init. Dev restart picks up changes. |
| Model auth | Env vars (AI SDK default: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.). |
| Env in templates | New `{{env.NAME}}` syntax parallel to `{{secrets.NAME}}`. Local-only default; hosted opt-in. |
| Env scope | HTTP `headers`/`params` + MCP `headers` (same surface as secrets). Not instruction text. |
| Env resolution | Explicit collection + fail-fast on missing (mirrors secret machinery). |

## Architecture

```
   user code
       │
       │  agntz({ agents: "./agents", tools: {...} })
       ▼
   @agntz/sdk ── LocalClient ────────────────┐
       │                                         │
       │  loads YAML files                       │  re-exports types
       ▼                                         │
   @agntz/manifest (parser, schema)              │
       │                                         │
       ▼                                         ▼
   @agntz/core (engine: runner.run/invoke/stream, version refs, timeouts)
       │
       ├─► sessions (memory or sqlite)
       ├─► traces (in-memory ring buffer)
       ├─► onEvent callback (user-supplied)
       └─► AI SDK providers (anthropic, openai, ...) — auth from process.env
```

## Public API

```ts
import { agntz } from "@agntz/sdk";

const client = agntz({
  agents: "./agents",                            // dir of .yaml files (or array)
  tools: { calculator, dateFormatter },          // YAML name → handler map
  sessions: memoryStore(),                       // optional, default memory
  traces: { capacity: 1000 },                    // optional ring buffer
  onEvent: (e) => console.log(e),                // optional event tap
});

// Identical surface to AgntzClient:
await client.agents.run({ agentId: "support", input: "..." });
for await (const e of client.agents.stream({ agentId: "support", input: "..." })) { /* ... */ }
await client.runs.list({ limit: 20 });
await client.traces.list();
await client.traces.get(traceId);
```

## Get-started target

YAML:

```yaml
# agents/support.yaml
id: support
kind: llm
model: { provider: anthropic, name: claude-sonnet-4-6 }
instruction: |
  You are a customer support agent. Answer concisely.
  {{userQuery}}
```

TypeScript:

```ts
import { agntz } from "@agntz/sdk";

const client = agntz({ agents: "./agents" });
const out = await client.agents.run({ agentId: "support", input: "How do I reset my password?" });
console.log(out.output);
```

`ANTHROPIC_API_KEY` in env → it runs. Five lines of code, one YAML file.

## Env vars in templates

Today, `{{secrets.NAME}}` is resolved by the runner pre-fetching values from a `SecretStore` and populating `state.secrets`. The template engine itself does dotted-path lookup and knows nothing about secrets specifically.

Add a parallel path for env vars:

| New | Mirror of |
|---|---|
| `ENV_REF_RE` regex in `manifest/src/validate.ts` | `SECRET_REF_RE` |
| `collectEnvReferences()` in `manifest/src/validate.ts` | `collectSecretReferences()` |
| Env pre-fetch in `core/src/runner.ts` | Secret pre-fetch |
| `RunnerOptions.envProvider?: (name: string) => string \| undefined` | `secretStore` |
| `state.env[NAME]` | `state.secrets[NAME]` |
| Validator warning on missing env at parse time | Existing missing-secret warning |

Defaults:
- `@agntz/sdk` factory wires `envProvider = (n) => process.env[n]`.
- Hosted server passes nothing — `{{env.X}}` references throw at runtime.
- Self-host opt-in via server config.

Scope: HTTP `headers`/`params`, MCP `headers`. Not instruction text — keeps credentials out of model context (prompt-injection footgun).

Template engine itself requires no changes.

## What's reused vs. new

| Reused | New in `@agntz/sdk` |
|---|---|
| `@agntz/core` engine (run/invoke/stream, version refs, timeouts) | `agntz()` factory + `LocalClient` |
| `@agntz/manifest` parser + `kind: local` schema | Disk loader (scan dir, parse, build registry) |
| `UnifiedStore` interface + memory backend | Trace ring buffer + `.traces.list/get` adapter |
| Template engine | (unchanged) |
| Existing secret pre-fetch pattern in `core/src/runner.ts` | Env pre-fetch parallel (in `@agntz/core`, useful for self-host too) |

Estimated new code: ~550 LOC + tests.

| Piece | LOC |
|---|---|
| Factory + LocalClient | ~150 |
| Disk loader | ~80 |
| Trace ring buffer | ~60 |
| Env pre-fetch + validation | ~80 |
| Sqlite subpath (optional) | ~100 |
| Type re-exports + plumbing | ~80 |

## Implementation phases

**Phase 1 — Env-var template support in core**
Lives in `@agntz/core` + `@agntz/manifest`. Useful independently for self-host.
- Add `ENV_REF_RE`, `collectEnvReferences()`, validator warning on missing env
- Add `envProvider` to `RunnerOptions`; pre-fetch step parallel to secrets
- Tests: HTTP headers, MCP headers, missing env throws, validator warning fires

**Phase 2 — `@agntz/sdk` package skeleton**
- Package boilerplate (`package.json`, `tsup.config.ts`, exports)
- `agntz()` factory + `LocalClient` class wrapping `@agntz/core` runner
- Disk loader: scan dir, parse YAML, register agents by id
- Local tool resolution: map YAML name → handler, fail-fast on missing
- Wire `envProvider = process.env` by default
- Tests: basic `client.agents.run()` against a fixture YAML dir

**Phase 3 — Sessions + traces parity**
- In-memory session store from `@agntz/core` exposed via `.runs.list/get`
- Trace ring buffer: capture events from invocation, expose via `.traces.list/get`
- `onEvent` callback wiring
- Tests: multi-turn session, trace retrieval, ring-buffer eviction

**Phase 4 — Optional sqlite subpath**
- `@agntz/sdk/sqlite` exports `sqliteStore(path)`
- Tests: persistence across process restarts

**Phase 5 — Get-started docs**
- README in `packages/runner/` with the 5-line example
- Site `/docs/get-started` page pointing to it
- Recipe pages: local tools, sessions, sqlite persistence, traces / `onEvent`

## Open questions

1. **Versioning**: in embedded mode, what does `support@latest` resolve to? Lean: `@latest` = the YAML file as-is. `@<timestamp>` and aliases throw with `"version refs not supported in embedded mode"`. Worth confirming during Phase 2.
2. **Package name**: `@agntz/sdk` vs `@agntz/local` vs other. `runner` for now.
3. **Tool input validation**: do local tool handlers get zod-typed inputs from YAML `inputSchema`? Probably yes for parity with HTTP tool validation — but punt to a follow-up if it slows Phase 2.

## Out of scope

- Evals (script-on-top, not a runner concern)
- Agents CRUD over the runner (YAML files on disk *are* the registry)
- Secrets vault (env vars *are* the vault in embedded mode)
- Telemetry push to a hosted backend (`onEvent` is the hook for anyone who wants it)
- Hot-reload of YAML during dev (decided: load once, dev restart on edits)
- Browser support (Node-only; that's `@agntz/client`'s job)
