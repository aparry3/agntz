---
"@agntz/core": minor
"@agntz/store-sqlite": minor
"@agntz/store-postgres": minor
---

Add versioned eval and dataset definitions with aliases, input-only dataset cases, rubric-based criteria, derived pass/fail outcomes, and version-aware latest-score storage.

Dataset items are intentionally minimal: an id, optional name, agent input, and optional metadata. Eval judges now return scores and reasons only; criterion gates and top-level pass policies derive outcomes from configured thresholds. Eval runs snapshot resolved eval, dataset, and agent versions, support criterion-only diagnostic runs, and preserve immutable version history in memory, SQLite, and Postgres stores.
