# Contributing to agntz

Thanks for your interest in contributing! Here's how to get started.

## Setup

Use Node.js 22 or 24, pnpm 10, and Python 3.11 or newer.

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

# Verify published-package boundaries
pnpm test:packed

# Install git hooks
pnpm prepare
```

## Project Structure

```
packages/
├── contracts/      # @agntz/contracts — shared types and protocol helpers
├── core/           # @agntz/core — runtime engine and store contracts
├── client/         # @agntz/client — hosted HTTP client
├── sdk/            # @agntz/sdk — embedded runner and CLI
├── stores/         # @agntz/stores — Postgres and SQLite adapters
├── memrez/         # @agntz/memrez — memory resource implementation
├── worker/         # hosted TypeScript runtime
├── app/            # authenticated Next.js application
└── site/           # public website and documentation
examples/           # runnable TypeScript/Python examples and shared manifests
python/             # Python SDK and CLI
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

## Provider Smoke Tests

The weekly `Provider smoke` workflow runs text, tool-call, and structured-output
checks against both SDKs. Configure at least one of these repository Actions
secrets before enabling it: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`,
`COHERE_API_KEY`, or `OPENROUTER_API_KEY`. Providers without a configured key
are reported as skipped; the workflow fails when no provider key is present.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Add tests for your changes
3. Ensure `pnpm test` passes
4. Run `pnpm test:packed` when changing public package exports or dependencies
5. Run the Python checks when changing `python/`: `pytest`, `ruff check .`, and `basedpyright`
6. Open a PR with a clear description

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
