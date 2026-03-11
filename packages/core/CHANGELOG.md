# @agent-runner/core

## 0.1.2

### Patch Changes

- [`fa58631`](https://github.com/aparry3/agent-runner/commit/fa58631b66e3c0020b19d2369968939945d96529) Thanks [@aparry3](https://github.com/aparry3)! - Remove stdio MCP transport to fix bundling issues in Next.js and web environments. Only HTTP (Streamable HTTP / SSE) transport is now supported. MCPServerConfig no longer accepts `command`/`args`/`env` — use `url` instead.

## 0.1.1

### Patch Changes

- [`4c55ae5`](https://github.com/aparry3/agent-runner/commit/4c55ae523f2cc9f3c369017ea7a68a82610741bb) Thanks [@aparry3](https://github.com/aparry3)! - Initial npm release with comprehensive documentation
