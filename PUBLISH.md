# Publishing `@agntz/*` to npm

This is the npm package release checklist. Runtime/service deployment is covered
in [`DEPLOY.md`](./DEPLOY.md).

## Current package graph

| Directory | Package name | Version | Publish status |
|---|---|---:|---|
| `packages/contracts` | `@agntz/contracts` | 0.0.0 | publishable |
| `packages/db` | `@agntz/db` | 0.0.0 | publishable |
| `packages/client` | `@agntz/client` | 0.0.0 | publishable |
| `packages/core` | `@agntz/core` | 0.0.0 | publishable |
| `packages/stores` | `@agntz/stores` | 0.0.0 | publishable |
| `packages/memrez` | `@agntz/memrez` | 0.0.0 | publishable |
| `packages/sdk` | `@agntz/sdk` | 0.0.0 | publishable |
| `packages/app` | `@agntz/app` | 0.1.10 | private service |
| `packages/worker` | `@agntz/worker` | 0.2.1 | private service |
| `packages/site` | `@agntz/site` | 0.1.0 | private site |

The standalone `@agntz/manifest` package has been merged into
`@agntz/core/manifest`.

The `0.0.0` package versions are the public baseline. Earlier npm releases were
experimental pre-baseline iterations and should remain deprecated on the npm
registry.

## Prerequisites

- npm account with 2FA enabled.
- Membership in the `@agntz` npm organization.
- `NPM_TOKEN` automation token configured as a GitHub Actions secret on
  `aparry3/agntz`.

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
3. Merge the PR to `main`.
4. The release workflow opens a "chore: release packages" PR that bumps package
   versions and rewrites workspace dependencies.
5. Merge the release PR. The workflow runs `pnpm changeset publish`.

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
Use `--tag latest` for the `0.0.0` baseline because npm will not implicitly move
`latest` from a higher historical version to a lower baseline version.

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
