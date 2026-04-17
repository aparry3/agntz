# Publishing agntz to npm

## Current State (as of 2026-03-10)

| Package | Name | Version | Scope | Built? |
|---------|------|---------|-------|--------|
| core | `agntz` | 0.1.0 | unscoped | ✅ |
| store-postgres | `@agntz/store-postgres` | 0.1.0 | @agntz | ✅ |
| store-sqlite | `@agntz/store-sqlite` | 0.1.0 | @agntz | ✅ |
| studio | `@agntz/studio` | 0.1.0 | @agntz | ✅ |

**Changesets** is already configured (`access: "public"`, GitHub changelog).

---

## ⚠️ Blockers to Fix First

### 1. `agntz` package name is TAKEN on npm

The unscoped name `agntz` is owned by `kamrynohly <kamryn@arcada.dev>` (published 3 months ago as a placeholder — "open sourcing soon").

**Options (pick one):**

- **Option A (recommended): Scope everything under `@agntz/`**
  - Rename core from `agntz` → `@agntz/core`
  - Consistent with the other packages
  - Requires creating the `@agntz` npm organization (free)
  - Install: `npm install @agntz/core`

- **Option B: Use your personal scope**
  - Rename to `@aparry3/agntz` (or whatever your npm username is)
  - No org creation needed
  - Less clean branding

- **Option C: Contact the owner**
  - Reach out to kamryn@arcada.dev about transferring the `agntz` name
  - Risky/slow — they may not respond

### 2. `@agntz` npm organization doesn't exist yet

You need to create it at https://www.npmjs.com/org/create — it's free for public packages.

### 3. No npm auth on this machine

`npm whoami` fails — you'll need to log in.

### 4. Scoped packages need `publishConfig`

The scoped packages (`store-postgres`, `store-sqlite`, `studio`) don't have `publishConfig.access: "public"` in their package.json. While changesets config has `access: "public"`, adding it to each package.json is safer for manual publishes.

### 5. Repository URLs reference `aparryopenclaw` not `aparry3`

The package.json files have `aparryopenclaw/agntz.git` but the actual git remote is `aparry3/agntz.git`. Fix these for npm to link correctly.

---

## Step-by-Step Publish Guide

### Prerequisites

1. **npm account** — Create one at https://www.npmjs.com/signup if you don't have one
2. **2FA** — npm requires 2FA for publishing; set it up in account settings

### Step 1: Create the `@agntz` npm org

1. Go to https://www.npmjs.com/org/create
2. Create org named `agntz`
3. Select the **free/unlimited public packages** plan

### Step 2: Authenticate with npm

```bash
npm login
# Follow the prompts — browser-based auth flow
# Verify with:
npm whoami
```

### Step 3: Fix package names and metadata

**Rename core package** (if going with Option A):

In `packages/core/package.json`:
```json
{
  "name": "@agntz/core",
  ...
}
```

**Update peer dependencies** in store-postgres, store-sqlite, and studio:
```json
{
  "peerDependencies": {
    "@agntz/core": ">=0.1.0"
  },
  "devDependencies": {
    "@agntz/core": "workspace:*"
  }
}
```

**Add `publishConfig`** to ALL 4 packages:
```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

**Fix repository URLs** in all 4 packages — change `aparryopenclaw` → `aparry3`:
```json
{
  "repository": {
    "url": "https://github.com/aparry3/agntz.git"
  }
}
```

**Update the CLI bin entry** in core if renaming:
```json
{
  "bin": {
    "agntz": "./dist/cli.js"
  }
}
```

### Step 4: Verify builds

```bash
cd ~/Projects/agntz
pnpm build
```

All 4 packages should build successfully.

### Step 5: Dry-run publish

```bash
# From each package directory, check what would be published:
cd packages/core && npm pack --dry-run
cd ../store-postgres && npm pack --dry-run
cd ../store-sqlite && npm pack --dry-run
cd ../studio && npm pack --dry-run
```

Review the file lists — make sure only `dist/` is included (controlled by `"files": ["dist"]`).

### Step 6: Publish (dependency order)

**Order matters:** core first, then packages that depend on it.

```bash
cd ~/Projects/agntz

# Option A: Using changesets (recommended)
pnpm changeset        # Create a changeset describing the release
pnpm changeset version # Bump versions based on changesets
pnpm release          # Build + publish all packages

# Option B: Manual publish (if changesets feels like overkill for v0.1.0)
cd packages/core
npm publish --access public

cd ../store-postgres
npm publish --access public

cd ../store-sqlite
npm publish --access public

cd ../studio
npm publish --access public
```

### Step 7: Verify

```bash
# Check each package is live:
npm view @agntz/core
npm view @agntz/store-postgres
npm view @agntz/store-sqlite
npm view @agntz/studio

# Test install in a fresh directory:
mkdir /tmp/test-agntz && cd /tmp/test-agntz
npm init -y
npm install @agntz/core @agntz/store-sqlite
```

---

## Publish Order

```
1. @agntz/core          (no internal deps)
2. @agntz/store-postgres (depends on core)
3. @agntz/store-sqlite   (depends on core)
4. @agntz/studio         (depends on core)
```

Packages 2-4 can be published in parallel after core is live.

> **Note:** Changesets handles publish order automatically via `pnpm release`.

---

## Quick Checklist

- [ ] npm account created
- [ ] `@agntz` org created on npm
- [ ] Logged in (`npm login`)
- [ ] Core package renamed to `@agntz/core`
- [ ] Internal dep references updated (`agntz` → `@agntz/core`)
- [ ] `publishConfig.access: "public"` added to all packages
- [ ] Repository URLs fixed (`aparry3`)
- [ ] `pnpm build` passes
- [ ] `npm pack --dry-run` looks clean for each package
- [ ] Published in order: core → stores → studio
- [ ] Verified with `npm view`
- [ ] Test install works
