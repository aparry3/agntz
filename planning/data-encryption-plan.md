# Data Encryption at Rest for agntz + memrez

**Status:** Draft for review
**Date:** 2026-06-12
**Scope:** `@agntz/memrez`, `@agntz/core`, `@agntz/store-postgres`, `@agntz/store-sqlite`, `@agntz/manifest`, `@agntz/worker`

---

## 1. Summary

Add optional, config-driven encryption at rest for memory entries (memrez) and chat history (agntz sessions), using **envelope encryption with service-held master keys and per-scope data keys**. Alongside it, expose a permission-gated way to read a user's memories (the "memory viewer" use case).

The design has three independent layers that compose without knowing about each other:

```
identity → grants     auth layer: Clerk session / API key / scoped token decides what a caller may assert
grants   → scopes     memrez grants.ts: visibleScopes / assertReadableScope (already built)
scope    → DEK        encryption layer: scope_keys table maps a namespace root to a wrapped data key
```

**Trust posture (explicit):** this is encryption *at rest* with service-held keys — the same posture as OpenAI/Anthropic. It defends against database dumps, stolen backups, and infrastructure-level snooping. It does **not** defend against the service operator: agntz can always decrypt. Who-may-read is enforced by grants at the API layer; keys decide blast radius, shredding, and what a leaked dump exposes. True user-held (E2E) keys are explicitly parked (§12) because they would break offline curation, operator debugging, and create key-loss-equals-data-loss.

## 2. Current state (verified findings)

What already exists and shapes the design:

- **AES-256-GCM primitives exist.** `packages/core/src/utils/crypto.ts` — `encryptSecret`/`decryptSecret` with a master key from `AGNTZ_SECRET_KEY`, format `base64(iv):base64(tag):base64(ct)` (no version prefix). Used today for `ar_secrets`. The primitives need generalizing to accept a key argument instead of closing over the global secret.
- **Memrez partitions purely by scope.** No `user_id` column anywhere — `scope` (namespace string) is the partition. Verified: every SQL query in `packages/memrez/src/postgres.ts` filters on `scope`/`topic`/`status` only; **`content` and `blurb` are never filtered or searched** — they are pure read/write blobs. This makes them encryptable with zero query changes.
- **`MemoryStore` is an 8-method interface** (`packages/memrez/src/types.ts:115-138`) with in-memory, SQLite, and Postgres implementations — so encryption can be a decorator over any of them, not a fork of three.
- **Dedup and curation operate above the store.** `Memrez.write()` compares content for dedup *after* the store returns entries; the curator reads via `listScopeSlice` and writes via `putEntry`. Both work unchanged through a decrypting decorator.
- **Sessions are clean too.** `ar_messages` carries sensitive payload in three columns: `content` (TEXT, legacy dual-write), `content_blocks` (JSONB), `tool_calls` (JSONB). `SessionSummary` (`packages/core/src/types.ts:505-511`) has **no content-derived fields** (no title/preview), and nothing in `postgres-store.ts` searches message content. Decorator-compatible.
- **`user_id` is the tenant.** In the hosted worker, `user_id` is the agntz account (Clerk id / API-key owner) — end users of a customer app (e.g. trainees in the personal-trainer app) are invisible to agntz except through sessionIds and namespace strings.
- **The worker hosts memrez (as of `9b5792e`).** `packages/worker/src/resources.ts` builds one process-wide provider — `createMemrez({ store })` exposed as `resources.memory` — and every runner the worker creates receives it. The store follows `MEMREZ_STORE`/`STORE` (postgres in prod) and connects via `MEMREZ_DATABASE_URL ?? DATABASE_URL`, i.e. **memrez tables live in the worker's own database by default**, beside `ar_sessions`/`ar_messages`. Manifests declaring `resources.memory` activate it (`bridge.ts` passes `manifest.resources` through). Hosted memrez currently runs the deterministic reasoner — no LLM tagger/curator is wired server-side; embedding apps still point `memrez/src/reasoner.ts` at the worker via `client.agents.run()`.
- **Grants are caller-supplied and unprefixed.** Run requests carry namespace grants as `context: string[]`; `WorkerAPIOptions.namespacePolicy` exists but `server.ts` sets none. The hosted memrez store is shared across tenants with scope as the only partition — nothing today stops two tenants from asserting the same scope string. See §5 for why encryption turns this from an isolation bug into a key-sharing hazard.
- **The integration seams for manifest-level config exist.** The manifest parser already handles a `resources` block (`packages/manifest/src/parser.ts:72-102`), and the worker's execution bridge threads namespace grants for resource providers (`packages/worker/src/bridge.ts:50` — `context?: string[]`).

## 3. Threat model

| Threat | Mitigated? | How |
|---|---|---|
| Stolen DB dump / SQL injection exfiltration | ✅ | Content columns are AES-256-GCM ciphertext; DEKs in the dump are wrapped by a KEK that is not in the database |
| Stolen/leaked backup | ✅ (with caveat) | Same as above; see §10 backup-retention nuance — a backup also contains the wrapped-key table |
| Curious/compromised DB credentials (read-only infra access) | ✅ | Plaintext never stored; decryption requires the KEK held only by the app runtime |
| Cross-user exposure in a leaked dump | ✅ | Per-scope DEKs: one unwrapped key exposes one scope, not the table |
| "Delete my data" with backups you can't rewrite | ✅ | Crypto-shredding: delete the scope's wrapped DEK (§10) |
| Compromised app server / env with KEK access | ❌ | Holder of the KEK can unwrap any DEK. Mitigate later with KMS + IAM (parked, §11 P5) |
| The service operator (agntz itself) | ❌ by design | The hybrid bargain — required for offline curation and operator debugging |
| AuthZ bugs (caller reads a scope they shouldn't) | ❌ (not this layer) | Access control is grants at the API layer; encryption is not an access-control mechanism |
| Plaintext copies in runs/traces/logs | ❌ until parked phase | Message content is duplicated in trace/run records; see §12 — encrypting messages alone is incomplete |

## 4. Design decisions

**D1 — Envelope encryption with a service-held KEK and per-scope DEKs (the "hybrid").**
One master key (KEK) held by the service (`AGNTZ_DATA_KEY` env var now, KMS later). Each scope gets a random 32-byte DEK, stored only *wrapped* (encrypted by the KEK). Per-scope keys give isolation, blast-radius control, individual shredding, and cheap rotation. Service-held KEK keeps `curate()` (which runs offline with no user present), the operator memory-viewer use case, and account recovery all working. The user's token is never a cryptographic ingredient — it is an authorization gate only.
*Rejected alternative:* user-held / token-derived keys — breaks offline curation, locks the operator out, and makes key loss data loss. Parked as an opt-in "vault" tier (§12).

**D2 — The key unit is the scope (namespace string), not a user or org.**
"User" and "org" mean nothing to agntz/memrez — `user_id` is the tenant and memrez only knows scopes. Those distinctions live in the *string the caller passes*: `app/user/u123` vs `app/org/acme` vs `app/org/acme/u123`. The DEK hangs off the scope root. Sessions gain an optional scope stamp so the same key serves chats and memories of one data subject; shared scopes (coach+client pairs, teams) get their own DEKs with the semantically right shredding behavior (deleting a member doesn't shred the team).

**D3 — Encryption is a store decorator, not a store fork.**
`withEncryption(inner, opts)` implements the same `MemoryStore` / `SessionStore` interface and wraps any backend. SQL below never sees plaintext; logic above (dedup, curation, tools, viewer API) never sees ciphertext. Encrypted fields are exactly the ones SQL never filters: memrez `content` + topic-meta `blurb`; session `content`, `content_blocks`, `tool_calls`.

**D4 — Config field is named `encryption`, enum `none | tenant | session | scope`.**
Declared on the **root agent object** (governs sessions) and on the **memory resource object** (governs entries). `security` was rejected as a grab-bag name; `user`/`org` rejected as enum values per D2. The enum names only derivation sources agntz natively has:

| Value | Key unit | Needs caller cooperation? | Use |
|---|---|---|---|
| `none` | — (plaintext) | no | dev, non-sensitive agents |
| `tenant` | agntz account (`user_id`) | no | coarse floor: "encrypted at rest, period" |
| `session` | sessionId | no | finest no-cooperation unit; fallback |
| `scope` | caller-supplied namespace root | **yes** | the workhorse — user/org/team distinctions encoded in the string |

**D5 — Fail closed.**
An agent declaring `key: scope` **rejects** runs that arrive without a scope. No silent fallback to tenant keys — a forgotten parameter must be an error, not a quiet isolation downgrade. This is the main reason the declaration lives on the agent definition at all.

**D6 — Manifests pick the unit; the runner holds the keys and the floor.**
Manifests are semi-trusted content (user-editable; rewritten by the `agent-editor` LLM). They may select among policies (`key: scope`) but never carry key material, key sources, or KMS ids. Runner/worker config holds `keySource` and a `minimum` floor (e.g. prod refuses `none` even if a manifest asks).

**D7 — Dev default: encryption ON with a static throwaway key.**
If the encrypt path only runs in prod, its bugs ship blind. Dev uses `{ kind: "static" }` with a checked-in dummy key so the path is exercised constantly; `none` remains available explicitly for debugging raw rows.

**D8 — Stamp the key scope at creation; never re-derive from current config.**
Entries already carry `scope`; sessions get a `key_scope` column written at session creation. Reads are self-describing, so changing an agent's declared unit later affects only new data and never orphans old ciphertext.

## 5. Key hierarchy & storage

```
AGNTZ_DATA_KEY / KMS  (service-held KEK, versioned)
  └─ wraps → DEK('app/user/u123')   ── encrypts ─▶ u123's memory content + chat payloads
  └─ wraps → DEK('app/user/u456')   ── encrypts ─▶ u456's …
  └─ wraps → DEK('app/org/acme')    ── encrypts ─▶ shared org memory
```

```sql
CREATE TABLE scope_keys (
  scope_root   TEXT PRIMARY KEY,        -- 'app/user/u123'
  wrapped_dek  TEXT NOT NULL,           -- enc:v1:k<kek_version>:<iv>:<tag>:<ct>
  kek_version  INT  NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- One `scope_keys` table lives **beside each store**. In the hosted worker, memrez and sessions share the worker's database by default (post-`9b5792e`), so one table — and one shred delete — covers a subject's chats *and* memories. Split deployments (an embedding app's own memrez DB) get their own table; same format everywhere.
- DEK creation is race-safe: generate → wrap → `INSERT … ON CONFLICT DO NOTHING` → re-read.
- **DEK cache:** unwrapped DEKs cached in-process (small LRU, short TTL). With an env KEK this is a micro-optimization; with KMS it is essential — one billed unwrap call per scope per process instead of per row.

**Precondition for the hosted worker — tenant-prefixed key roots.** The hosted memrez store is multi-tenant with scope as the only partition, and grants are caller-supplied (§2). Under scope-keyed encryption, two tenants asserting `app/user/u123` would silently **share a DEK** — a cross-tenant blast-radius leak, where the current plaintext store merely has a data-isolation bug. Before encryption is enabled on the hosted worker, the effective key root must be `{tenantId}/{scope}` (and ideally the same prefix should be enforced on grants themselves via `namespacePolicy` or route-layer rewriting). Library deployments are single-tenant by construction and unaffected.

### Ciphertext formats

| Location | Format |
|---|---|
| TEXT columns (`content`, `blurb`) | `enc:v1:<b64 iv>:<b64 tag>:<b64 ct>` |
| JSONB columns (`content_blocks`, `tool_calls`) | `{"enc":"v1","ct":"<iv:tag:ct>"}` (column type survives) |
| Legacy plaintext | no `enc:` prefix / no `enc` key → passed through as-is |

Fresh random 12-byte IV per value; AES-256-GCM throughout (reuse the core primitives). The version prefix is new — the existing `crypto.ts` format has none and should gain one when generalized.

## 6. Data paths

**Write (memrez):** `memrez.write(grants, content)` is untouched — content arrives plaintext in the live request; the tagger runs on it as normal. The decorator intercepts `putEntry`:

1. `keyScope(entry.scope)` → key root (default: the grant root, e.g. `app/user/u123`).
2. Fetch wrapped DEK; on miss, generate + wrap + insert (race-safe).
3. Unwrap with KEK (cached), encrypt `content` with the DEK.
4. Inner store writes ciphertext, fully unaware. `scope`, `topics`, `type`, `status`, timestamps stay plaintext so every existing query works.

**Read:** inner store runs its normal SQL → decorator sniffs the `enc:` prefix on returned values → unwraps the scope's DEK → decrypts → callers receive plaintext `MemoryEntry`s. No prefix = legacy row, passed through (the migration story).

**Why curation just works:** the curator calls `listScopeSlice` → decorator decrypts → LLM consolidates plaintext → replacements flow back through `putEntry` → re-encrypted under the same DEK. No user present, none needed — the KEK is the service's.

**Sessions:** identical shape on `SessionStore.append`/`getMessages`, keyed by the session's stamped `key_scope`. Three payload columns are encrypted — forgetting the legacy dual-write `content` TEXT column would leak everything, so the decorator handles all three or refuses to construct.

## 7. What is encrypted vs. plaintext

| Store | Encrypted | Plaintext (queryability) |
|---|---|---|
| memrez `entries` | `content` | `scope`, `topics` (join table), `type`, `status`, `superseded_by`, timestamps |
| memrez `topic_meta` | `blurb` | `scope`, `topic`, `last_updated_at` |
| `ar_messages` | `content` (TEXT), `content_blocks` (JSONB), `tool_calls` (JSONB) | `role`, `session_id`, `tool_call_id`, `timestamp` |
| `ar_sessions` | — | `id`, `agent_id`, `user_id`, **new:** `key_scope`, timestamps |

Topic names stay plaintext deliberately — `listTopics`/`getByTopic` need them indexable, and they're low-sensitivity labels. If a deployment ever needs sensitive topic names, the upgrade path is a blind index (per-scope HMAC in the index column + encrypted display name). Parked (§12).

## 8. Configuration surface

### Agent manifest (semi-trusted; selects policy only)

```yaml
# personal agent — every trainee keyed to themselves
name: personal-trainer
encryption:
  key: scope                 # sessions keyed to the scope each run supplies
resources:
  memory:
    kind: memrez
    encryption:
      key: scope             # DEKs at the grant root; entries carry scopes natively

# org agent — private member chats, shared org memory
name: acme-assistant
encryption:
  key: scope                 # runs invoked with scope app/org/acme/u123 → per-member chat keys
resources:
  memory:
    kind: memrez
    encryption:
      key: scope             # runs grant app/org/acme → one org memory key
```

Note both agents use `key: scope` — *user vs org is data, not config*: it lives in the namespace string the caller passes at invocation.

### Runner / worker config (trusted; holds key material and the floor)

```ts
createRunner({
  store,
  encryption: {
    keySource: { kind: "env", var: "AGNTZ_DATA_KEY" },
    // | { kind: "static", key }   (dev)
    // | { kind: "kms", keyId }    (P5)
    default: "tenant",     // when a manifest is silent
    minimum: "tenant",     // refuse manifests below this (prod refuses `none`)
  },
});
```

### Memrez (library embedding, e.g. the trainer backend)

```ts
createMemrez({
  store: withEncryption(new PostgresMemoryStore(pool), {
    kek: { kind: "env", var: "AGNTZ_DATA_KEY" },
    keyStore: new PostgresScopeKeyStore(pool),
    keyScope: grantRoot,        // default: map entry scope → grant root
  }),
});
```

### Resolution & precedence

1. Manifest declares the *shape* (`key: scope`); the run supplies the *value* (`scope: app/user/u123`, alongside existing grants).
2. Worker resolves shape + value → concrete key root → threads it to the session/memory decorators.
3. Manifest setting overrides runner `default`; runner `minimum` overrides everything downward.
4. `key: scope` + no scope on the run → **reject the run** (D5).

## 9. Migration & compatibility

- **Coexistence by prefix:** plaintext and ciphertext rows live side by side; reads sniff `enc:`/`"enc"` and pass legacy rows through. Enabling encryption is zero-downtime — new writes encrypt immediately.
- **Backfill (optional):** either lazy (re-encrypt on read-then-write paths like curation, which naturally launders old rows) or a one-shot job per scope. A metric counting legacy plaintext rows tracks progress (P5).
- **Disabling later:** decorator-with-decrypt-only mode reads ciphertext but writes plaintext; mostly a dev/debug affordance.
- **`crypto.ts` generalization is additive:** existing `encryptSecret`/`decryptSecret` keep working for `ar_secrets`; new keyed + versioned functions sit beside them.

## 10. Key lifecycle

- **KEK rotation:** mint KEK v2 → background job re-wraps each `scope_keys` row (decrypt wrapped DEK with v1, encrypt with v2; `kek_version` tracks progress). Data rows untouched — the envelope win. Keep v1 available until the table reports fully re-wrapped.
- **Single-scope compromise:** rotate that scope's DEK and re-encrypt just its rows.
- **Crypto-shredding:** `DELETE FROM scope_keys WHERE scope_root = 'app/user/u123'` renders that subject's ciphertext permanently unreadable on live systems — chats and memories in one operation (per database, see §5).
- **Backup nuance (honest):** a full-database backup contains the wrapped-key table, so a restored backup can still decrypt. Standard fix: shorter retention on `scope_keys` backups than on data backups. The deletion story becomes: *unreadable immediately on live systems; unreadable everywhere once key backups age out (e.g. 7 days), even though data backups persist (e.g. 90 days).* For a fitness app holding health-adjacent data this is a genuinely good GDPR posture.

## 11. Rollout phases

| Phase | Title | Packages | Outcome |
|---|---|---|---|
| **P1** | Crypto core & scope keys | `core` | Keyed+versioned AES-GCM, `KeySource` (env/static), DEK cache, `ScopeKeyStore` interface |
| **P2** | Memrez encryption | `memrez`, `worker` | `withEncryption(MemoryStore)`, key-store impls (pg/sqlite/memory), `MemrezOptions.encryption`; memories encrypted in library *and* hosted deployments |
| **P3** | Session encryption | `core`, `store-postgres`, `store-sqlite`, `worker`, `app` | `key_scope` column (migration v10), `withEncryption(SessionStore)`, scope threading on run requests |
| **P4** | Manifest config & enforcement | `manifest`, `worker` | `encryption` blocks parsed + validated; fail-closed (D5); runner floor (D6) |
| **P5** | Operations | `worker`, `core`, docs | KMS `keySource`, KEK-rotation job, shred admin API, legacy-row metric, deployment docs |

### Phase details

**P1 — Crypto core & scope keys** (`packages/core`)
- `utils/crypto.ts`: add `encryptWithKey(key, plaintext)` / `decryptWithKey(key, value)` emitting/parsing the versioned `enc:v1:` format; JSONB wrapper helpers.
- New `utils/keyring.ts`: `KeySource` (`env | static`), `wrapDek`/`unwrapDek`, in-process DEK cache (LRU + TTL).
- `ScopeKeyStore` interface in core types: `get(scopeRoot)`, `put(scopeRoot, wrapped)` (conflict-safe), `delete(scopeRoot)` (shred).
- Unit tests: round-trip, tamper detection (GCM tag), version/prefix sniffing, cache behavior.

**P2 — Memrez encryption** (`packages/memrez`, `packages/worker`)
- `src/encryption.ts`: `withEncryption(inner, { kek, keyStore, keyScope? })` implementing all 8 `MemoryStore` methods; encrypts `content` + `blurb`.
- `ScopeKeyStore` impls beside each store: `keys-postgres.ts`, `keys-sqlite.ts`, in-memory; `scope_keys` DDL added to each store's schema migration.
- `MemrezOptions.encryption` sugar so `createMemrez` can wire the decorator itself.
- Worker `resources.ts`: wrap the hosted store with `withEncryption` when `AGNTZ_DATA_KEY` is set, with `keyScope` prefixing the tenant id — gated on the §5 hosted precondition.
- Tests: write/read round-trip, dedup through decryption, curate round-trip, legacy plaintext coexistence, scope-key isolation (scope A's DEK can't decrypt scope B), shred-then-read fails closed.

**P3 — Session encryption** (`core`, `store-postgres`, `store-sqlite`, `worker`, `app`)
- Migration v10: `ALTER TABLE ar_sessions ADD COLUMN key_scope TEXT` (nullable = legacy/plaintext era); sqlite equivalent.
- `stores/encrypted-session-store.ts` in core: decorator over `SessionStore` encrypting `content`, `content_blocks`, `tool_calls`; stamps/reads `key_scope`.
- Run requests accept an optional `scope` (worker routes + app worker-client passthrough); session creation stamps it (D8).
- Tests: three-column coverage (including the legacy dual-write column), mixed legacy/encrypted history reads, scope stamping.

**P4 — Manifest config & enforcement** (`manifest`, `worker`)
- Parser + types: `encryption: { key }` on the root agent object and on `resources.<name>` entries; enum validation `none|tenant|session|scope`; clear errors.
- Worker: resolve declared unit + run-supplied scope → key root; **fail closed** when `scope` is declared but absent; enforce runner `minimum`; thread resolved key roots into the decorators.
- Worker: enforce tenant-prefixed grants/key roots (`namespacePolicy` or route-layer rewrite) — the §5 hosted precondition becomes mandatory here.
- Validation tests: silent-fallback regression (must error), floor enforcement, precedence, cross-tenant scope-collision isolation.

**P5 — Operations**
- `{ kind: "kms", keyId }` `KeySource` (AWS/GCP), with the DEK cache earning its keep.
- KEK rotation job (re-wrap `scope_keys`, bump `kek_version`); per-scope DEK rotation utility.
- Admin shred endpoint (internal-only auth): delete scope key + optionally hard-delete rows.
- Metric: count of legacy (unprefixed) rows remaining per store; deployment docs (key generation, backup-retention guidance per §10).

## 12. Parked (explicit non-goals for now)

- **Traces/runs/logs encryption** — message content is duplicated in trace and run records; until addressed, v1's honest posture is "memories + messages encrypted; traces are operational data with N-day retention." Same decorator pattern applies when prioritized.
- **Blind-indexed topics** — per-scope HMAC index + encrypted display names, only if sensitive topic names become real.
- **User-held "vault" tier (BYOK)** — a scope whose DEK is additionally wrapped by a user-supplied key and excluded from curation; clean landing spot exists (`keyHolder: service | user` beside `key:`), build when a customer demands it.
- **Hosted memory *read* endpoints + scoped tokens** — hosted agents now get memory tools (the provider ships in the worker as of `9b5792e`), but there is still no out-of-band viewer API: mint grant-bound, capability-bound short-lived tokens; `GET /memory/topics`, `GET /memory/entries`. The library path (`memrez.scan()/read()` from an embedding backend) works today and needs no new infra.

## 13. Open questions

1. **Run-request field name** for the data subject: `scope`, `subject`, or reuse/extend the existing grants (`context`)? Leaning explicit `scope` (grants may be plural; the key root must be singular and unambiguous — multi-grant runs must not guess).
2. **`keyScope` default depth** for memrez: grant root is the proposal; confirm against real namespace shapes (`app/user/u123/...`).
3. **Key-table backup retention** — pick the actual number (7 days?) and document it as part of the deletion story.
4. **Where `scope_keys` lives for split deployments** (trainer app's memrez DB vs worker DB) — confirmed two tables/one format; any need for a shared shredding orchestration helper?
5. **Per-message vs per-session encryption granularity** — current design encrypts per value with the scope DEK; is per-session sub-keying (HKDF from scope DEK + sessionId) worth it for forward-ish secrecy? Default: no, keep it simple.
6. **Tenant-prefixing mechanics for the hosted worker** (§5 precondition) — rewrite caller grants to `{tenantId}/…` at the route layer, or enforce-and-reject via `namespacePolicy`? Rewriting is transparent but changes scope strings callers see; rejecting is explicit but breaks existing unprefixed data written since `9b5792e`.
