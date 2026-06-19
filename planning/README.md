# Planning Index

This directory is for active engineering plans and historical notes that still
carry useful context. Public user and agent-facing documentation lives in the
Next site under `packages/site/src/components/docs/pages`.

## Active plans

| Plan | Status |
|---|---|
| `data-encryption-plan.md` | Active draft; needs refresh for namespace roots and the `@agntz/core/manifest` merge before implementation |
| `evals-backend-plan.md` | Active follow-up; keep only deltas not already shipped |
| `evals-ui-plan.md` | Active UI/product plan |
| `library-application-separation-plan.md` | Historical plus remaining-work tracker for package boundaries |
| `provider-harness-plan.html` | Active only if provider harness work is still pending; convert to markdown before implementation |
| `namespace-grant-security-plan.html` | Active only if namespace-root security gaps remain; convert to markdown before implementation |
| `biome-standardization-plan.html` | Active only if formatting/lint standardization remains pending; convert to markdown before implementation |

## Removed from active planning

Implemented or superseded plans were removed from this directory to reduce stale
agent context: execution-context deduplication, memory observability, old
context/memrez docs update, old memrez design, Python docs toggle, Python port
plan, and generated HTML duplicates where markdown source exists.
