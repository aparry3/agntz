# Roadmap and Stability

agntz is a public beta. The portable YAML manifest, embedded SDKs, hosted
client, runs/traces, evals, and memrez are actively developed in the open.

## Near term

- Harden the manifest schema and keep TypeScript/Python execution behavior aligned.
- Expand packed-package, Postgres, and live-provider compatibility coverage.
- Improve version, alias, migration, and observability workflows.
- Publish clearer self-hosting and production operations guidance.

## Stability policy

- Packages below `1.0.0` may contain breaking changes in a minor release.
- Patch releases should remain backward compatible and focus on fixes.
- Breaking changes require release notes and migration guidance.
- Deprecated APIs remain documented for at least one minor release when practical.
- The published JSON Schema and CLI validation behavior are treated as public contracts.

Roadmap items describe intent, not a delivery commitment. Accepted work is
tracked through milestones and issues.
