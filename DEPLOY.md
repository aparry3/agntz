# Deploying Agntz

This checklist covers package publishing plus the hosted runtime stack:
marketing site, product app, worker, and Postgres.

## Release packages

npm packages are released through Changesets and `.github/workflows/release.yml`.
See [`PUBLISH.md`](./PUBLISH.md) for the package graph and manual escape hatch.

1. Confirm every publishable package with code or npm README changes has a
   changeset:
   ```sh
   pnpm changeset status
   ```
2. Merge the feature/docs PR to `main`.
3. Review and merge the generated release PR.
4. Verify the published packages:
   ```sh
   npm view @agntz/core version
   npm view @agntz/sdk version
   npm view @agntz/client version
   npm view @agntz/contracts version
   npm view @agntz/db version
   npm view @agntz/stores version
   npm view @agntz/memrez version
   ```

Python is released separately through `.github/workflows/python-release.yml`.
See [`PYTHON_PUBLISH.md`](./PYTHON_PUBLISH.md).

## Provision Postgres

Use a managed Postgres database for production. The app and worker must share
the same database.

Required value:

```sh
DATABASE_URL=postgres://...
```

If the app is hosted outside the database provider's private network, use the
provider's public connection URL for the app and the private/internal URL for
co-located worker services.

## Deploy worker

The worker is the hosted execution service.

Recommended runtime:

- Root directory: repository root
- Dockerfile: `Dockerfile.worker`
- Port: `4001`
- Health check: `GET /health`

Required environment:

```sh
PORT=4001
DATABASE_URL=postgres://...
WORKER_INTERNAL_SECRET=<shared random secret>
CORS_ORIGINS=https://<app-domain>
DEFAULT_MODEL_PROVIDER=openai
DEFAULT_MODEL_NAME=gpt-4o
OPENAI_API_KEY=<provider key>
```

Optional environment depends on the providers and resources enabled:

```sh
ANTHROPIC_API_KEY=<provider key>
GOOGLE_GENERATIVE_AI_API_KEY=<provider key>
ARTIFACT_STORE=s3
ARTIFACT_S3_BUCKET=<private bucket>
ARTIFACT_S3_PREFIX=agntz-artifacts
ARTIFACT_S3_ENDPOINT=<optional S3-compatible endpoint>
ARTIFACT_S3_FORCE_PATH_STYLE=false
AWS_REGION=<bucket region>
AWS_ACCESS_KEY_ID=<unless using another AWS credential source>
AWS_SECRET_ACCESS_KEY=<unless using another AWS credential source>
```

`ARTIFACT_STORE=filesystem` with `ARTIFACT_DIR` is suitable only for a
single persistent worker. Use S3-compatible storage for multiple replicas and
configure a matching bucket lifecycle policy as a backstop to the worker's
artifact expiry sweep. Keep the bucket private: callers download through the
authenticated worker endpoint, and metadata remains tenant-scoped in Postgres.

Provider-replacement workloads also need:

- every manifest provider credential installed in the worker environment or
  hosted connection store;
- enough request-body capacity for the 50 MiB artifact upload ceiling;
- outbound HTTPS access to provider APIs, public callback endpoints, and any
  remote media referenced by content blocks;
- tenant secrets provisioned for every `tools[].kind: callback` declaration.

Run records and artifacts have independent expiries. Confirm the database
cleanup job and object-store lifecycle policy cover your maximum
`retention.ttlSeconds` and `retention.artifactTtlSeconds` values. The worker
blocks localhost and private-network callback/media destinations by default to
reduce SSRF risk.

Verify:

```sh
curl https://<worker-domain>/health
```

Then exercise the same boundary your application will use:

1. Import a canonical-schema `llm` manifest and run it through an API key.
2. Upload and download a small artifact; confirm it is private in object
   storage and tenant-isolated through the API.
3. Run one `retention.mode: none` request and confirm no durable run/trace row
   is created.
4. If enabled, invoke a signed callback tool and verify signature, timestamp,
   and delivery-id replay protection in the receiver.
5. If enabled, run one transcription and one image manifest and verify the
   normalized output plus artifact expiry metadata.

## Deploy app

The app is the authenticated product UI and API proxy.

Recommended runtime:

- Root directory: `packages/app`
- Framework: Next.js
- Build command from repo root if the platform does not understand pnpm
  workspaces:
  ```sh
  pnpm --filter @agntz/app build
  ```

Required environment:

```sh
DATABASE_URL=postgres://...
WORKER_URL=https://<worker-domain>
WORKER_INTERNAL_SECRET=<same value as worker>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<clerk key>
CLERK_SECRET_KEY=<clerk key>
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/agents
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/agents
```

Provider keys may also be set on the app if app-side validation or authoring
tools need them.

Verify:

- Sign in.
- Create or import an agent.
- Run the agent.
- Confirm worker logs show requests with a valid internal secret and tenant
  context.

## Deploy site

The marketing/docs site is the canonical public documentation surface.

Recommended runtime:

- Root directory: `packages/site`
- Framework: Next.js
- Build command:
  ```sh
  pnpm --filter @agntz/site build
  ```

Verify:

- `/` renders the homepage.
- `/docs` renders the docs index.
- `/docs/quickstart.md` returns the markdown export.
- `/llms.txt` returns the agent-facing docs index.

## DNS

Suggested hostnames:

| Hostname | Target | Purpose |
|---|---|---|
| `agntz.co` | site | marketing and docs |
| `www.agntz.co` | site | marketing alias |
| `app.agntz.co` | app | product UI |
| `api.agntz.co` | worker, optional | direct hosted API |

Add the production app origin to Clerk before launch.

## End-to-end verification

```sh
curl https://agntz.co/llms.txt
curl https://app.agntz.co
curl https://<worker-domain>/health
```

Then run a real agent from the app and verify persisted rows for agents,
sessions, runs, traces, and memory appear in Postgres.

## Operational follow-ups

- Add uptime checks for the site, app, and worker health endpoint.
- Add application error reporting for app and worker.
- Confirm database backup and retention policy.
- Rotate `WORKER_INTERNAL_SECRET` if it has ever been shared outside deploy
  tooling.
- Rotate callback secrets independently and accept both old and new values
  during a controlled receiver rollout.
