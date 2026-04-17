# Publishing `@agntz/*` to npm

This is a focused reference for publishing the npm packages. For the full deployment flow (packages + runtime services + DNS), see [`DEPLOY.md`](./DEPLOY.md).

## Current State

| Directory | Package name | Version | Publish status |
|---|---|---|---|
| `packages/core` | `@agntz/core` | 0.1.2 | publishable |
| `packages/manifest` | `@agntz/manifest` | 0.1.0 | publishable |
| `packages/sdk` | `@agntz/sdk` | 0.1.0 | publishable |
| `packages/store-postgres` | `@agntz/store-postgres` | 0.1.1 | publishable |
| `packages/store-sqlite` | `@agntz/store-sqlite` | 0.1.1 | publishable |
| `packages/worker` | `@agntz/worker` | 0.1.0 | private (deployed service) |
| `packages/app` | `@agntz/app` | 0.1.0 | private (deployed service) |
| `packages/site` | `@agntz/site` | 0.1.0 | private (deployed service) |

All publishable packages:
- Use the `@agntz/*` scope
- Have `"publishConfig": { "access": "public" }`
- Point `repository.url` at `https://github.com/aparry3/agntz.git`

## Prerequisites

- npm account with **2FA enabled** (required for publishing scoped public packages).
- Membership in the `@agntz` npm organization (already owned).
- `NPM_TOKEN` **automation token** set as a GitHub Actions secret on the `aparry3/agntz` repo. The token goes to `.github/workflows/release.yml:48`.

## Release flow (changesets)

Releases are driven by [changesets](https://github.com/changesets/changesets) and run automatically via `.github/workflows/release.yml` when changeset files land on `main`.

1. On a feature branch, create a changeset describing what changed:
   ```sh
   pnpm changeset
   ```
   Select each package that should get a version bump, pick the semver level, and write a short note. This writes a markdown file to `.changeset/`.
2. Commit + open a PR. Merge to `main`.
3. The release workflow opens a **"Version Packages"** PR that bumps versions and rewrites `workspace:*` peer deps to concrete versions. Review it.
4. Merge the Version Packages PR. On merge, the workflow runs `pnpm changeset publish`, which publishes each bumped package to npm in dependency order.

## Manual publish (escape hatch)

Only use this if the CI workflow is broken and you need a release out the door.

```sh
npm login
pnpm build

# From the package directory:
cd packages/core && npm publish
cd ../store-postgres && npm publish
cd ../store-sqlite && npm publish
cd ../manifest && npm publish
cd ../sdk && npm publish
```

Publish order matters for packages with `peerDependencies` on `@agntz/core`: publish core first, then the others.

## Verify a release

```sh
npm view @agntz/core version
npm view @agntz/manifest version
npm view @agntz/sdk version
npm view @agntz/store-postgres version
npm view @agntz/store-sqlite version

# Smoke test install
mkdir /tmp/agntz-test && cd /tmp/agntz-test
npm init -y
npm i @agntz/core @agntz/store-sqlite
```
