# Publishing agent-runner to npm

## Current State (as of 2026-03-10)

| Package | Name | Version | Scope | Built? |
|---------|------|---------|-------|--------|
| core | `agent-runner` | 0.1.0 | unscoped | ✅ |
| store-postgres | `@agent-runner/store-postgres` | 0.1.0 | @agent-runner | ✅ |
| store-sqlite | `@agent-runner/store-sqlite` | 0.1.0 | @agent-runner | ✅ |
| studio | `@agent-runner/studio` | 0.1.0 | @agent-runner | ✅ |

**Changesets** is already configured (`access: "public"`, GitHub changelog).

---

## ⚠️ Blockers to Fix First

### 1. `agent-runner` package name is TAKEN on npm

The unscoped name `agent-runner` is owned by `kamrynohly <kamryn@arcada.dev>` (published 3 months ago as a placeholder — "open sourcing soon").

**Options (pick one):**

- **Option A (recommended): Scope everything under `@agent-runner/`**
  - Rename core from `agent-runner` → `@agent-runner/core`
  - Consistent with the other packages
  - Requires creating the `@agent-runner` npm organization (free)
  - Install: `npm install @agent-runner/core`

- **Option B: Use your personal scope**
  - Rename to `@aparry3/agent-runner` (or whatever your npm username is)
  - No org creation needed
  - Less clean branding

- **Option C: Contact the owner**
  - Reach out to kamryn@arcada.dev about transferring the `agent-runner` name
  - Risky/slow — they may not respond

### 2. `@agent-runner` npm organization doesn't exist yet

You need to create it at https://www.npmjs.com/org/create — it's free for public packages.

### 3. No npm auth on this machine

`npm whoami` fails — you'll need to log in.

### 4. Scoped packages need `publishConfig`

The scoped packages (`store-postgres`, `store-sqlite`, `studio`) don't have `publishConfig.access: "public"` in their package.json. While changesets config has `access: "public"`, adding it to each package.json is safer for manual publishes.

### 5. Repository URLs reference `aparryopenclaw` not `aparry3`

The package.json files have `aparryopenclaw/agent-runner.git` but the actual git remote is `aparry3/agent-runner.git`. Fix these for npm to link correctly.

---

## Step-by-Step Publish Guide

### Prerequisites

1. **npm account** — Create one at https://www.npmjs.com/signup if you don't have one
2. **2FA** — npm requires 2FA for publishing; set it up in account settings

### Step 1: Create the `@agent-runner` npm org

1. Go to https://www.npmjs.com/org/create
2. Create org named `agent-runner`
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
  "name": "@agent-runner/core",
  ...
}
```

**Update peer dependencies** in store-postgres, store-sqlite, and studio:
```json
{
  "peerDependencies": {
    "@agent-runner/core": ">=0.1.0"
  },
  "devDependencies": {
    "@agent-runner/core": "workspace:*"
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
    "url": "https://github.com/aparry3/agent-runner.git"
  }
}
```

**Update the CLI bin entry** in core if renaming:
```json
{
  "bin": {
    "agent-runner": "./dist/cli.js"
  }
}
```

### Step 4: Verify builds

```bash
cd ~/Projects/agent-runner
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
cd ~/Projects/agent-runner

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
npm view @agent-runner/core
npm view @agent-runner/store-postgres
npm view @agent-runner/store-sqlite
npm view @agent-runner/studio

# Test install in a fresh directory:
mkdir /tmp/test-agent-runner && cd /tmp/test-agent-runner
npm init -y
npm install @agent-runner/core @agent-runner/store-sqlite
```

---

## Publish Order

```
1. @agent-runner/core          (no internal deps)
2. @agent-runner/store-postgres (depends on core)
3. @agent-runner/store-sqlite   (depends on core)
4. @agent-runner/studio         (depends on core)
```

Packages 2-4 can be published in parallel after core is live.

> **Note:** Changesets handles publish order automatically via `pnpm release`.

---

## Quick Checklist

- [ ] npm account created
- [ ] `@agent-runner` org created on npm
- [ ] Logged in (`npm login`)
- [ ] Core package renamed to `@agent-runner/core`
- [ ] Internal dep references updated (`agent-runner` → `@agent-runner/core`)
- [ ] `publishConfig.access: "public"` added to all packages
- [ ] Repository URLs fixed (`aparry3`)
- [ ] `pnpm build` passes
- [ ] `npm pack --dry-run` looks clean for each package
- [ ] Published in order: core → stores → studio
- [ ] Verified with `npm view`
- [ ] Test install works
