---
"@agntz/core": minor
"@agntz/client": minor
"@agntz/sdk": minor
"@agntz/store-sqlite": minor
"@agntz/store-postgres": minor
---

Complete the first-class eval system with agent-scoped datasets, async hosted eval runs, cancellation, and latest-score persistence for version comparisons.

Datasets now carry an `agentId`, evals validate that their default dataset belongs to the same agent, and failed cases with zero scores are included in aggregate scoring. Hosted eval runs now return immediately in a running state, persist progress case-by-case, support cancellation, and update a latest-score cache keyed by eval, dataset, and resolved agent version while preserving immutable run history.
