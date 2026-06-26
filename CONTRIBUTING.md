# Contributing to agntz

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
# Clone the repo
git clone https://github.com/aparry3/agntz.git
cd agntz

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Install git hooks
pnpm prepare
```

## Project Structure

```
packages/
├── contracts/      # "@agntz/contracts" — shared types and protocol helpers
├── core/           # "@agntz/core" — runtime engine and pure store contracts
├── client/         # "@agntz/client" — hosted HTTP client
├── sdk/            # "agntz" — ergonomic SDK facade
├── stores/         # "@agntz/stores" — store contracts and memory/Postgres/SQLite adapters
├── worker/         # "@agntz/worker" — hosted TypeScript runtime
└── app/            # "@agntz/app" — Next.js multi-tenant UI
```

## Development

```bash
# Watch mode for core
cd packages/core && pnpm dev

# Run the hosted UI + worker locally
pnpm --filter @agntz/worker dev    # terminal 1
pnpm --filter @agntz/app dev       # terminal 2

# Run specific tests
cd packages/core && pnpm vitest run tests/runner.test.ts

# Check or apply TypeScript formatting/lint rules
pnpm lint
pnpm format
```

## Guidelines

- **Write tests** for new features and bug fixes
- **Use Biome** for TypeScript formatting and linting (`pnpm lint`, `pnpm format`)
- **Keep hooks installed** — lefthook runs Biome on staged TypeScript workspace files before commit
- **Keep the core small** — UI deps stay in the `app` package
- **Agent definitions are data** — avoid patterns that require code in definitions
- **Document public APIs** with TSDoc comments
- **Multi-tenancy** — all store reads/writes must be workspace-scoped via `store.forWorkspace(id)` before calling agent/session/log/provider methods

## Store Adapters

Want to add a new store backend (Redis, DynamoDB, etc.)? Follow the pattern in `packages/stores`:

1. Implement the store interfaces from `@agntz/core` and hosted contracts from `@agntz/stores/contracts` when the backend is used by hosted services
2. Run the shared contract test suite against your implementation
3. Export it from a dedicated `@agntz/stores/{backend}` subpath

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Add tests for your changes
3. Ensure `pnpm test` passes
4. Open a PR with a clear description

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
