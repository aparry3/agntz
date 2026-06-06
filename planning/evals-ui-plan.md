# Evals UI Plan

## Summary

Replace the side-panel eval workflow with a dedicated agent-level eval workspace at `/agents/[id]/evals`.

The UI should make the hierarchy obvious:

1. Which agent is being evaluated.
2. Which eval version defines the rubric.
3. Which dataset version supplies the cases.
4. Which agent version produced the outputs.
5. Where the agent performed well, regressed, or failed a hard gate.

Evals should feel like production hardening infrastructure, not a small utility panel.

## Product Posture

The page should feel closer to an observability and evaluation console than a form builder. Users should be able to quickly answer:

- What are we evaluating?
- What rubric are we using?
- What dataset did we test against?
- Which version of the agent did we test?
- Did the result pass, fail, or only produce a score?
- Which criteria, tags, and cases explain the result?

Visual hierarchy should prioritize operational clarity over decorative presentation.

## Primary Layout

### Top Header

The top header should anchor the user in the current agent context.

Recommended contents:

- Agent name and id.
- Current or active agent version.
- Navigation back to `Build`, `Playground`, and `History`.
- Primary actions:
  - `Run eval`
  - `New eval`
  - `New dataset`
  - `Import YAML`

The header should avoid becoming a dense toolbar. Run controls can open a setup dialog or occupy a dedicated run setup region below the header.

### Left Rail

The left rail is the eval navigator.

Each eval row should show:

- Eval name.
- Latest score.
- Outcome state: `passed`, `failed`, or `score-only`.
- Default dataset.
- Last run time.
- Gated vs score-only indicator.

The rail should support:

- Search by eval name or id.
- Filter by outcome.
- Filter by dataset.
- Filter by case tags.

Rows should make failures scannable without forcing users into run detail. A failed safety gate should read differently from a low aggregate score.

### Main Workspace

The main workspace should keep the selected eval in context.

Recommended sections or tabs:

- `Overview`
- `Rubric`
- `Dataset`
- `Runs`
- `Compare`

The selected eval version and dataset version should remain visible across all tabs. Users should never have to infer whether they are looking at `latest`, a timestamp, or an alias.

### Detail Pane

Use a right inspector or lower detail pane for selected objects:

- criterion detail
- dataset case detail
- run detail
- gate failure explanation
- version snapshot

Do not put core creation, editing, or run controls only in a narrow sidebar. The old eval side panel should not remain the primary workflow.

## Overview View

The overview should provide the fastest read on eval health.

Recommended content:

- Latest full-run score and outcome.
- Last run metadata:
  - eval version
  - dataset version
  - agent version
  - judge model
  - run time
- Gate failure callouts.
- Criterion summary.
- Tag summary.
- Recent run history.
- Quick comparison against selected prior agent versions.

Examples of outcome text:

- `Score-only`
- `Passed: overall score met policy`
- `Failed: safety gate below 0.90`
- `Failed: overall score below 0.78`
- `Failed: overall score met policy, but safety gate failed`

## Rubric UI

The rubric view should show criteria as ordered scoring dimensions.

Each criterion row or card should include:

- Name.
- Stable id.
- Weight.
- Gate state.
- Latest criterion score.
- Rubric preview.
- Diagnostic run action for that criterion.

The UI should clearly distinguish:

- scoring weight: how much the criterion contributes to aggregate score
- hard gate: whether the criterion can fail the eval
- rubric text: what the judge uses to assign the score

### Rubric Editor

The rubric editor should support:

- criterion name
- stable criterion id
- rubric text
- weight
- optional `gate.minimumScore`
- criterion order
- add criterion
- duplicate criterion
- delete criterion

Use plain language labels:

- `Weight`
- `Hard gate`
- `Minimum score`
- `Rubric`

Avoid a generic `threshold` label because it does not explain whether the number is a target, warning, or blocker.

### YAML Workflow

Evals should be visually editable and YAML-capable.

The rubric view should provide:

- YAML preview.
- Import YAML.
- Export YAML.
- Validation errors mapped back to visual fields where possible.

YAML should feel like an advanced editing surface, not the only path.

## Dataset UI

The dataset view should be structured, not a plain textarea.

Dataset-level context should show:

- Dataset name and id.
- Selected dataset version.
- Alias, if selected.
- Case count.
- Tag list.
- Last updated time.

### Case Table

Each case row should show:

- Case id.
- Input preview.
- Tags.
- Optional reference output indicator.
- Notes indicator.
- Latest result for the selected eval and agent version.

Users should be able to:

- Add a case.
- Duplicate a case.
- Delete a case.
- Bulk edit tags.
- Filter by tags.
- Search case text.

### Case Editor

The case editor should adapt to the agent input shape.

If the agent has an `inputSchema`, show schema-shaped fields similar to the playground input form.

If there is no input schema, show a plain text input editor by default.

Advanced case editing should allow:

- JSON object input.
- Content-block input.
- Metadata JSON.

Reference output should be optional and labeled as supporting material. Prefer `Reference output`, not `Expected output`.

Case fields:

- `Input`
- `Reference output` optional
- `Tags`
- `Notes`
- `Metadata`

### Tags

Tags should be first-class because they explain use cases and edge cases.

Tag examples:

- `happy-path`
- `edge-case`
- `refunds`
- `risk`
- `long-context`

The UI should show tag-level score summaries in results so users can quickly see patterns like:

- strong on `happy-path`
- weak on `edge-case`
- failing on `risk`

## Run Setup UI

Run setup should make versions explicit.

Selectors:

- Eval version:
  - `latest`
  - timestamp
  - alias
- Dataset version:
  - `latest`
  - timestamp
  - alias
- Agent version:
  - active/current
  - `latest`
  - timestamp
  - alias

Run modes:

- Full eval.
- Diagnostic criterion run.

Diagnostic criterion runs should be clearly marked as partial and should not look like release-grade full eval results.

## Results UI

Results should support both high-level scanning and deep case analysis.

Recommended top-level result sections:

- Overall score and outcome.
- Gate failure callouts.
- Criterion summary.
- Tag breakdown.
- Case table.

### Criterion Matrix

Show criteria as columns or rows depending on viewport and density.

Each cell should include:

- score
- gate status if applicable
- short reason preview

Clicking a criterion result should open the full reason and rubric context.

### Case Table

Each case row should show:

- case id
- tags
- case score
- outcome or gate status
- target agent output preview
- strongest failing criterion

Expanded case detail should include:

- input
- reference output, if present
- target agent output
- criterion scores
- judge reasons
- gate failures
- snapshots used

### Run Detail

Run detail should preserve and display:

- eval version used
- dataset version used
- agent version used
- judge model used
- run status
- start and end time
- total cases
- completed, failed, and cancelled cases

## Compare UI

Compare should default to the same eval version and dataset version across multiple agent versions.

Recommended comparison model:

- Columns: agent versions.
- Rows: criteria, tags, and cases.
- Fixed context: eval version and dataset version.

The comparison view should make regressions visually scannable:

- score deltas
- gate failures
- cases that changed outcome
- criteria where scores dropped
- tags where performance dropped

Common comparison questions:

- Did the new agent version improve overall?
- Did any hard gate fail?
- Did a specific edge-case tag regress?
- Which cases explain the score movement?

## Visual Design Direction

Design tone:

- operational
- dense but calm
- scannable
- production-focused
- closer to traces, test reports, or observability tools than marketing dashboards

Avoid:

- oversized hero sections
- decorative cards as page sections
- hiding important controls in a narrow side panel
- vague threshold language
- making YAML the only serious editing path

Prioritize:

- stable hierarchy
- fixed version context
- tables for repeated data
- compact controls
- clear state labels
- readable failure explanations

## UI Tests

Create/edit flows:

- create eval with multiple criteria
- edit rubric visually
- import eval YAML
- export eval YAML
- create dataset
- add structured cases
- tag cases
- add optional reference output

Run flows:

- run full eval against fixed eval, dataset, and agent versions
- run diagnostic criterion eval
- cancel running eval
- inspect run snapshots

Result flows:

- view score-only result
- view aggregate pass
- view aggregate failure
- view criterion gate failure
- filter results by tag
- inspect case-level judge reasons

Compare flows:

- compare multiple agent versions against the same eval and dataset versions
- identify score regressions
- identify gate regressions
- inspect cases responsible for deltas
