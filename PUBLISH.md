# Publishing `@agntz/*` to npm

This is the npm package release checklist. Runtime/service deployment is covered
in [`DEPLOY.md`](./DEPLOY.md).

## Current package graph

| Directory | Package name | Current | Release target | Publish status |
|---|---|---:|---:|---|
| `packages/contracts` | `@agntz/contracts` | 0.1.0 | 0.2.0 | publishable |
| `packages/db` | `@agntz/db` | 0.1.0 | 0.2.0 | publishable |
| `packages/client` | `@agntz/client` | 0.1.0 | 0.2.0 | publishable |
| `packages/core` | `@agntz/core` | 0.1.0 | 0.2.0 | publishable |
| `packages/stores` | `@agntz/stores` | 0.1.0 | 0.2.0 | publishable |
| `packages/memrez` | `@agntz/memrez` | 0.1.0 | 0.2.0 | publishable |
| `packages/sdk` | `@agntz/sdk` | 0.1.0 | 0.2.0 | publishable |
| `packages/app` | `@agntz/app` | 0.1.10 | - | private service |
| `packages/worker` | `@agntz/worker` | 0.2.1 | - | private service |
| `packages/site` | `@agntz/site` | 0.1.0 | - | private site |

The standalone `@agntz/manifest` package has been merged into
`@agntz/core/manifest`.

Version `0.2.0` is the coordinated public-beta line. Earlier npm releases were
experimental iterations and remain deprecated on the npm registry.
The checked-in changesets generate the target versions and changelog entries in
the release PR; do not publish the staging `0.1.0` package manifests directly.

## Prerequisites

- npm account with 2FA enabled.
- Membership in the `@agntz` npm organization.
- npm Trusted Publisher entries for every public package, restricted to
  `aparry3/agntz`, workflow `release.yml`, environment `npm`, and the
  `npm publish` action.
- A GitHub `npm` environment restricted to the `main` branch.

## Release flow

Releases are driven by Changesets through `.github/workflows/release.yml`.

1. Add a changeset for every publishable package whose code or npm README
   changed:
   ```sh
   pnpm changeset
   ```
2. Check the projected versions:
   ```sh
   pnpm changeset status
   ```
   For the hosted AI release, confirm the projection includes
   `@agntz/client`, `@agntz/contracts`, `@agntz/core`, and
   `@agntz/stores`; `@agntz/sdk` is also part of the coordinated `0.2.0`
   beta line.
3. Run the release gate locally:
   ```sh
   pnpm lint
   pnpm build
   pnpm test
   pnpm test:packed
   pnpm --filter @agntz/site build
   ```
   The packed-consumer check must import `@agntz/core/schema` from the tarball
   and typecheck the public hosted-client surface. The site build validates the
   canonical documentation route manifest.
4. Merge the PR to `main`.
5. The release workflow opens a "chore: release packages" PR that bumps package
   versions and rewrites workspace dependencies.
6. Merge the release PR. The workflow runs `pnpm changeset publish`.

## Manual publish order

Only use this if the release workflow is broken. Build first:

```sh
pnpm build
```

Publish in dependency order:

```sh
pnpm --filter @agntz/contracts publish --access public --tag latest --no-git-checks
pnpm --filter @agntz/db publish --access public --tag latest --no-git-checks
pnpm --filter @agntz/client publish --access public --tag latest --no-git-checks
pnpm --filter @agntz/core publish --access public --tag latest --no-git-checks
pnpm --filter @agntz/stores publish --access public --tag latest --no-git-checks
pnpm --filter @agntz/memrez publish --access public --tag latest --no-git-checks
pnpm --filter @agntz/sdk publish --access public --tag latest --no-git-checks
```

Do not publish private service packages (`@agntz/app`, `@agntz/worker`,
`@agntz/site`) unless their package metadata is intentionally changed first.

Use pnpm for manual publishing so `workspace:*` dependencies are converted to
concrete registry versions in the published tarballs.
Manual publishing requires an interactive npm session with 2FA. CI uses OIDC
trusted publishing and emits provenance attestations without an npm token.

## Verify a release

```sh
npm view @agntz/core version
npm view @agntz/sdk version
npm view @agntz/client version
npm view @agntz/contracts version
npm view @agntz/db version
npm view @agntz/stores version
npm view @agntz/memrez version
```

Smoke test published packages in a clean project:

```sh
tmpdir="$(mktemp -d)"
cd "$tmpdir"
npm init -y
npm i @agntz/core @agntz/sdk @agntz/stores @agntz/memrez
node -e 'import("@agntz/core").then(() => import("@agntz/sdk")).then(() => console.log("ok"))'
```

For this release, also verify the provider-replacement exports:

```sh
node --input-type=module <<'JS'
import { AgntzClient } from "@agntz/client";
import { parseManifest } from "@agntz/core/manifest";
import schema from "@agntz/core/schema" with { type: "json" };

parseManifest(`
id: generated-cover
kind: image
model: { provider: openai, name: gpt-image-1.5 }
prompt: "{{userQuery}}"
retention: { mode: result, artifactTtlSeconds: 3600 }
`);
console.log(typeof AgntzClient, schema.$id);
JS
```
