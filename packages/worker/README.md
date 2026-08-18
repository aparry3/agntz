# @agntz/worker

Hono HTTP worker that executes YAML-defined agents through the
`@agntz/core/manifest` runtime. Requests resolve to a tenant before they touch
the store, then run with that tenant's agents, sessions, runs, traces, memory,
eval records, API keys, and namespace roots.

## Main endpoint groups

| Group | Examples |
|---|---|
| Health and authoring | `GET /health`, `POST /build-agent`, `POST /edit-agent`, `POST /validate` |
| Agents and sessions | `GET /agents`, `POST /agents/import`, `GET /sessions`, `POST /sessions/import`, `DELETE /sessions/:id` |
| Runs and streams | `POST /run`, `POST /run/stream`, `POST /runs`, `GET /runs/:id`, `GET /runs/:id/stream`, `POST /runs/:id/cancel` |
| Managed artifacts | `POST /artifacts`, `GET /artifacts/:id`, `GET /artifacts/:id/content`, `DELETE /artifacts/:id` |
| Traces | `GET /traces`, `GET /traces/:id`, `GET /traces/:id/stream`, `DELETE /traces/:id` |
| Memory | `POST /memory/import`, `GET /memory/topics`, `GET /memory/entries`, `POST /memory/entries/:id/correct`, `DELETE /memory/entries/:id`, `POST /memory/curate`, `POST /scopes/delete` |
| Evals | `GET/POST /datasets`, `GET/POST /evals`, `POST /eval-runs`, `GET /eval-runs`, `POST /eval-runs/:id/cancel`, `GET /eval-scores` |
| Batches | `GET/POST /batches`, `POST/GET /batch-runs`, cancellation, normalized item/JSONL results, comparisons, and staged dataset imports |
| System/webhooks | `GET /system/agents`, webhook secret routes |

See the [HTTP API reference](https://agntz.co/docs/deploy/http-api) for raw
request shapes. Application code should normally use
[`@agntz/client`](https://agntz.co/docs/sdk-cli/client) or the Python
`AgntzClient`, which normalize results, stream events, local-file uploads, and
errors.

## Authentication

Two modes are accepted:

### Internal app-to-worker calls

```txt
X-Internal-Secret: $WORKER_INTERNAL_SECRET
```

The product app uses this for signed-in users. Current app calls include signed
tenant context so the worker does not rely on browser-provided tenant data.

### External API keys

```txt
Authorization: Bearer ar_live_<token>
```

The worker hashes the key, resolves it through the platform store, and bounds
resource grants to the tenant's namespace roots.

## Environment

```sh
PORT=4001
HOST=0.0.0.0
WORKER_INTERNAL_SECRET=...
CORS_ORIGINS=https://app.example.com,https://www.example.com
STORE=postgres
DATABASE_URL=postgres://...

MEMREZ_STORE=postgres             # postgres | memory | disabled; defaults to STORE
MEMREZ_DATABASE_URL=postgres://... # optional separate DB for memory
MEMREZ_TABLE_PREFIX=              # optional prefix for memrez_* tables
MEMREZ_REASONER=llm               # llm | deterministic
MEMREZ_CURATE_INTERVAL=           # optional, e.g. 30m or 1h

DEFAULT_MODEL_PROVIDER=openai
DEFAULT_MODEL_NAME=gpt-5.6-terra
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
MISTRAL_API_KEY=...

ARTIFACT_STORE=filesystem           # memory | filesystem | s3
ARTIFACT_DIR=.agntz-artifacts       # filesystem only
ARTIFACT_S3_BUCKET=                 # required for s3
ARTIFACT_S3_PREFIX=agntz-artifacts
ARTIFACT_S3_ENDPOINT=               # optional S3-compatible endpoint
ARTIFACT_S3_FORCE_PATH_STYLE=false
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=                   # or another AWS SDK credential source
AWS_SECRET_ACCESS_KEY=

BUILT_IN_AGENTS_DIR=...           # optional extra system agents
```

`MEMREZ_REASONER=llm` uses the configured model provider for tagging and
curation. Set `MEMREZ_REASONER=deterministic` for tests or an emergency kill
switch.

`CORS_ORIGINS` is a comma-separated browser-origin allowlist. It defaults to
`agntz.co` plus local development origins; set it explicitly for self-hosted
browser clients. Wildcard credentialed CORS is not enabled.

Use an S3-compatible artifact store for multi-replica production deployments.
Filesystem storage is intended for a single worker. Artifact metadata remains
tenant-scoped in the configured Agntz store; object keys use a hash of the
owner ID and artifacts expire independently from run records.

Uploads and fetched media are limited to 50 MiB. Explicit artifact uploads
accept lifetimes from 60 seconds through 7 days. Generated artifacts use the
run's `artifactTtlSeconds` policy and may live from 60 seconds through one year.
Use a private bucket and configure its lifecycle policy as a cleanup backstop.

## Hosted model operations

The ordinary run endpoints dispatch by manifest kind:

```yaml
id: transcribe-narration
kind: transcription
model:
  provider: openai
  name: gpt-4o-mini-transcribe
instruction: Preserve amounts, temperatures, and times exactly.
settings:
  language: en
retention:
  mode: none
  artifactTtlSeconds: 3600
```

```yaml
id: create-cover
kind: image
model:
  provider: openai
  name: gpt-image-1.5
  providerOptions:
    openai:
      quality: high
      background: transparent
prompt: "Create a recipe cover for {{userQuery}}"
settings:
  n: 1
  size: 1024x1024
retention:
  mode: result
  artifactTtlSeconds: 86400
```

Generated images are returned as artifact references. Transcription requires
exactly one audio content block. The built-in operation adapter currently
targets OpenAI; the execution boundary is kept separate from the manifest
dispatcher so additional providers and future operation kinds can be added
without changing client request transport.

### Retention

Hosted requests resolve the manifest default and caller override before
execution:

| Mode | Synchronous run | Durable start | Stored data |
|---|---:|---:|---|
| `none` | yes | no | no run, trace, or session record |
| `result` | yes | yes | redacted result record |
| `session` | yes | yes | result, messages, and complete trace |

Callers may tighten but not loosen the manifest policy
(`none < result < session`). Record TTL and artifact TTL are independent.

### Signed callback tools

Hosted LLM agents can call an application endpoint without exposing tenant,
run, or session identifiers to the model:

```yaml
tools:
  - kind: callback
    name: save_recipe
    description: Save a validated recipe.
    url: https://app.example.com/api/agntz/save-recipe
    secret: recipe_callback
    timeoutMs: 15000
    maxRetries: 2
    inputSchema:
      type: object
      properties:
        recipeId: { type: string }
      required: [recipeId]
      additionalProperties: false
```

The worker resolves the named secret from the tenant `SecretStore`, validates
the model arguments, attaches trusted runtime context, and signs
`timestamp.deliveryId.rawBody` with HMAC-SHA256. Receivers must verify
`X-Agntz-Signature` and `X-Agntz-Timestamp`, reject stale requests, and
deduplicate `X-Agntz-Delivery-Id` / `Idempotency-Key`. Callback URLs and remote
media are subject to the outbound SSRF policy.

See the [callback guide](https://agntz.co/docs/tools/callback) for the complete
payload and verification examples.

## System agents

System agents live under `src/defaults/agents/` and are invoked with
`agentId: "system:<name>"`. They bypass the caller's agent store and run with
ephemeral state, while still using the worker's runtime and model provider.

## Run locally

```sh
pnpm --filter @agntz/worker dev
curl http://localhost:4001/health
```
