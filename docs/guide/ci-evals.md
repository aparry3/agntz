# CI Eval Runs

This page describes planned CI eval workflows. The current public CLI focuses on
creating YAML, running agents, and hosted run/trace management; eval execution is
not exposed through the CLI in the current package.

## Current Recommendation

Run evals from code or from a project-specific script until a supported CLI eval
command is available.

## GitHub Action

The `agntz` repo provides a reusable GitHub Action for CI pipelines.

### Basic Usage

```yaml
- uses: aparry3/agntz/.github/actions/eval@main
  with:
    agent-id: support
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### All Agents with Threshold

```yaml
- uses: aparry3/agntz/.github/actions/eval@main
  with:
    all: true
    threshold: "0.8"
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Using Outputs

The action provides outputs you can use in subsequent steps:

```yaml
- uses: aparry3/agntz/.github/actions/eval@main
  id: eval
  with:
    agent-id: support

- run: echo "Score: ${{ steps.eval.outputs.score }}"
- run: echo "Result: ${{ steps.eval.outputs.result }}"
```

| Output | Description |
|--------|-------------|
| `score` | Overall eval score (0-1) |
| `passed` | Number of test cases passed |
| `failed` | Number of test cases failed |
| `total` | Total number of test cases |
| `result` | `pass` or `fail` |

### Full Workflow Example

```yaml
name: Agent Evals

on:
  pull_request:
    paths: ["agents/**", "tools/**", "*.config.ts"]
  schedule:
    - cron: "0 6 * * 1" # Weekly Monday 6am

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aparry3/agntz/.github/actions/eval@main
        id: eval
        with:
          all: true
          threshold: "0.8"
          json-output: eval-results.json
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

      - name: Comment PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const score = '${{ steps.eval.outputs.score }}';
            const passed = '${{ steps.eval.outputs.passed }}';
            const total = '${{ steps.eval.outputs.total }}';
            const icon = '${{ steps.eval.outputs.result }}' === 'pass' ? '✅' : '❌';
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## ${icon} Agent Evals\\n\\n**Score:** ${(parseFloat(score)*100).toFixed(1)}%\\n**Tests:** ${passed}/${total} passed`
            });

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: eval-results
          path: eval-results.json
```

## Inputs Reference

| Input | Default | Description |
|-------|---------|-------------|
| `agent-id` | — | Agent ID to evaluate |
| `all` | `false` | Eval all agents with eval configs |
| `threshold` | — | Override pass threshold (0-1) |
| `node-version` | `22` | Node.js version |
| `package-manager` | `pnpm` | `pnpm`, `npm`, or `yarn` |
| `working-directory` | `.` | Project root directory |
| `json-output` | — | File path for JSON results |

## Tips

- **Schedule weekly evals** to catch model behavior changes (provider updates can silently alter agent output).
- **Use `--threshold`** to enforce quality gates — block PRs if agent scores drop below a minimum.
- **Save JSON artifacts** for tracking score trends over time.
- **PR comments** make eval results visible without checking CI logs.
