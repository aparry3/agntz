# Contributing to agent-runner

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
# Clone the repo
git clone https://github.com/AaronBidworthy/agent-runner.git
cd agent-runner

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Project Structure

```
packages/
├── core/           # "agent-runner" — the main SDK
├── studio/         # "@agent-runner/studio" — dev UI
├── store-sqlite/   # "@agent-runner/store-sqlite" — SQLite adapter
└── cli/            # CLI commands (bundled with core)
```

## Development

```bash
# Watch mode for core
cd packages/core && pnpm dev

# Watch mode for studio UI
cd packages/studio && pnpm dev:ui

# Run specific tests
cd packages/core && pnpm vitest run tests/runner.test.ts
```

## Guidelines

- **Write tests** for new features and bug fixes
- **Use Biome** for formatting (`pnpm lint`)
- **Keep the core small** — UI deps stay in the studio package
- **Agent definitions are data** — avoid patterns that require code in definitions
- **Document public APIs** with TSDoc comments

## Store Adapters

Want to add a new store (Redis, DynamoDB, etc.)? Follow the pattern in `packages/store-sqlite`:

1. Implement the store interfaces from `agent-runner` (AgentStore, SessionStore, ContextStore, LogStore)
2. Run the shared contract test suite against your implementation
3. Publish as `@agent-runner/store-{name}`

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Add tests for your changes
3. Ensure `pnpm test` passes
4. Open a PR with a clear description

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
