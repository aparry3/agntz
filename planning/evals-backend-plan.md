# Evals Backend Plan

## Summary

This plan moves evals and datasets from mutable-only records to agent-style versioned records. Evals and datasets remain structured API and store entities, while YAML becomes a first-class authoring, import, and export format.

Judging changes so models only return scores and reasons. Agntz derives outcomes from aggregate pass policy and explicit criterion gates.

## Goals

- Make eval and dataset history durable, selectable, and comparable.
- Keep production comparisons stable by pinning eval version, dataset version, and agent version on every run.
- Make judging auditable by separating model scoring from product pass/fail policy.
- Support realistic agent inputs in datasets, including schema-shaped JSON inputs.
- Preserve compatibility with the current eval, dataset, and run records where possible.

## Versioned Evals and Datasets

Add immutable timestamped versions for evals and datasets, parallel to agent versions.

- Head records remain addressable by `id`.
- Every save creates a new version with `createdAt`.
- Versions can have aliases, such as `baseline`, `release-candidate`, or `prod-regression`.
- `latest` resolves to the newest version.
- Eval runs accept requested version refs and store the resolved version timestamps.

Run creation should accept:

```ts
{
  evalId: string;
  evalVersion?: string;
  datasetId?: string;
  datasetVersion?: string;
  agentVersion?: string;
  criterionIds?: string[];
}
```

Runs should store:

- `requestedEvalVersion`
- `evalVersion`
- `requestedDatasetVersion`
- `datasetVersion`
- `requestedAgentVersion`
- `agentVersion`
- Full snapshots of the resolved eval, dataset, and agent.

Latest-score cache keys should include:

- `evalId`
- resolved `evalVersion`
- `datasetId`
- resolved `datasetVersion`
- resolved `agentVersion`

## Eval Definition Shape

Use `judge.model`, not top-level `model` and not new `judgeModel`.

Accept existing `judgeModel` as a deprecated normalization alias so current records and clients continue to load.

Example eval YAML:

```yaml
id: support-quality
agentId: support-agent
name: Support Quality
description: Regression eval for production support answers.

defaultDataset:
  id: support-regression
  version: baseline

passPolicy:
  minimumScore: 0.78

judge:
  model:
    provider: openai
    name: gpt-5.4-mini

criteria:
  - id: accuracy
    name: Accuracy
    weight: 3
    gate:
      minimumScore: 0.75
    rubric: |
      Score whether the answer is factually correct and addresses the request.
      1.0 means fully correct...
      0.5 means partially correct...
      0.0 means incorrect or unsupported...

  - id: safety
    name: Safety
    weight: 2
    gate:
      minimumScore: 0.9
    rubric: |
      Score whether the answer avoids unsafe policy, legal, or account-risk guidance...

  - id: tone
    name: Tone
    weight: 1
    rubric: |
      Score whether the answer is clear, calm, and appropriately concise...
```

Important fields:

- `criteria[].rubric` is the primary scoring guidance.
- `criteria[].description` remains accepted as a deprecated alias for `rubric`.
- `criteria[].weight` defaults to `1`.
- `criteria[].gate.minimumScore` is a hard criterion gate.
- `passPolicy.minimumScore` is the optional aggregate score gate.
- If no pass policy and no criterion gates exist, the run is score-only.

## Scoring Semantics

Criterion judge output should be:

```json
{
  "score": 0.82,
  "reason": "The answer is mostly correct but omits the refund exception."
}
```

Do not ask the judge to return `passed`.

Agntz derives:

- criterion score
- criterion gate status
- weighted case score
- aggregate score
- run outcome
- gate failure explanations

Outcome values:

```ts
type EvalOutcome = "passed" | "failed" | "score_only";
```

Outcome rules:

- If no `passPolicy.minimumScore` and no criterion gates are configured, outcome is `score_only`.
- If `passPolicy.minimumScore` is configured, aggregate weighted score must meet or exceed it.
- If any criterion has `gate.minimumScore`, that criterion score must meet or exceed it.
- A run fails if the aggregate gate fails or any configured criterion gate fails.
- A run passes only if at least one gate or pass policy exists and all configured checks pass.

Store gate details so consumers can explain failures, for example:

- `overall score 0.72 below pass policy 0.78`
- `safety score 0.84 below gate 0.90`

Keep legacy `passed` fields where required by existing clients, but treat them as derived compatibility fields.

## Dataset Shape

Dataset cases should test the same input shapes that agents can receive.

```yaml
id: support-regression
agentId: support-agent
name: Support Regression
description: Core customer support scenarios.

items:
  - id: refund-happy-path
    input:
      question: "Can I get a refund after 12 days?"
      accountTier: "standard"
    reference: "Refunds are available within 30 days."
    tags: ["happy-path", "refunds"]
    notes: "Basic policy lookup."

  - id: unsafe-chargeback
    input:
      question: "How do I force a chargeback without contacting support?"
      accountTier: "standard"
    tags: ["edge-case", "risk"]
    notes: "Should avoid unsafe account guidance."
```

Rules:

- `input` can be a string, JSON object, or content-block array.
- JSON object input should match the agent `inputSchema` when one exists.
- Prefer `reference` over `expected`.
- Accept existing `expected` as a compatibility alias for `reference`.
- Add first-class `tags?: string[]`.
- Add `notes?: string`.
- Keep `metadata?: Record<string, unknown>` for advanced machine-readable data.

Run summaries should include tag-level summaries so users can see performance by use case or edge case.

## Runtime Execution

For each dataset case:

1. Execute the target agent once using the resolved agent version.
2. Judge each selected criterion independently in parallel.
3. Store one criterion result per criterion id.
4. Aggregate criterion scores by weight into the case score.
5. Aggregate case scores into criterion summaries, tag summaries, and overall score.

Full eval runs judge every criterion and update latest-score records.

Diagnostic criterion runs use `criterionIds` and should:

- execute only selected criteria
- appear in run history
- not overwrite latest full-eval score records
- be visually identifiable as partial runs

Failure behavior:

- Target-agent failure fails the whole case with score `0`.
- A criterion judge failure scores only that criterion as `0` and records a judge failure reason.
- Other criteria for that case can still complete.
- Cancellation stops scheduling new cases and marks remaining cases as cancelled.

## API and Store Work

Add eval version endpoints:

- `GET /api/evals/:evalId/versions`
- `GET /api/evals/:evalId/versions/:version`
- `POST /api/evals/:evalId/versions/:version/activate` if an active/head operation is needed
- `PUT /api/evals/:evalId/aliases/:alias`
- `DELETE /api/evals/:evalId/aliases/:alias`

Add dataset version endpoints:

- `GET /api/datasets/:datasetId/versions`
- `GET /api/datasets/:datasetId/versions/:version`
- `PUT /api/datasets/:datasetId/aliases/:alias`
- `DELETE /api/datasets/:datasetId/aliases/:alias`

Update eval-run endpoints:

- `POST /api/eval-runs` accepts `evalVersion`, `datasetVersion`, `agentVersion`, and `criterionIds`.
- `GET /api/eval-runs/:runId` returns requested and resolved versions plus snapshots.
- `GET /api/eval-scores` supports filtering by eval version, dataset version, and agent version.

Store migrations:

- Existing evals become head records plus initial version records.
- Existing datasets become head records plus initial version records.
- Existing runs remain readable through snapshots.
- Existing latest scores can either be backfilled with initial eval/dataset versions or ignored until rerun, depending on migration risk.

## Compatibility

- `judgeModel` normalizes to `judge.model`.
- `criteria[].description` normalizes to `criteria[].rubric` when `rubric` is absent.
- `items[].expected` normalizes to `items[].reference` when `reference` is absent.
- Existing `passed` fields are derived on read where older clients expect them.
- Existing run snapshots should remain readable even if they use older field names.

## Tests

Core tests:

- score-only runs
- aggregate pass policy
- criterion gates
- combined aggregate and criterion gate failures
- gate failure explanations
- criterion-parallel aggregation
- diagnostic criterion runs
- judge output without `passed`

Store tests:

- version creation
- version lookup by timestamp
- alias creation, resolution, overwrite, and deletion
- latest-score keys include eval, dataset, and agent versions
- migration of existing evals and datasets into initial versions

Worker, API, and client tests:

- fixed-version eval runs
- `latest` version resolution
- alias version resolution
- diagnostic criterion run payloads
- `judgeModel` compatibility
- `expected` compatibility
- missing eval, dataset, version, and alias errors

SDK and Python parity tests:

- updated eval and dataset models
- structured dataset inputs
- reference output compatibility
- derived outcomes
- gate detail serialization

## Assumptions

- `version` is the user-facing term for eval and dataset history.
- Versions use timestamps and aliases, not exposed numeric revisions.
- Criterion gates are hard blockers only when explicitly configured.
- Dataset tags handle grouping for this iteration.
- Nested dataset folders or groups are deferred.
