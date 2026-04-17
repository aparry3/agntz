# agntz Eval Action

Run agntz eval suites in your CI pipeline. Tests agent behavior with assertions, LLM-as-judge rubrics, and scoring.

## Usage

### Basic — eval a specific agent

```yaml
- uses: aparry3/agntz/.github/actions/eval@main
  with:
    agent-id: support
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Eval all agents

```yaml
- uses: aparry3/agntz/.github/actions/eval@main
  with:
    all: true
    threshold: "0.8"
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### With outputs

```yaml
- uses: aparry3/agntz/.github/actions/eval@main
  id: eval
  with:
    agent-id: support
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

- name: Check results
  run: |
    echo "Score: ${{ steps.eval.outputs.score }}"
    echo "Result: ${{ steps.eval.outputs.result }}"
    echo "Passed: ${{ steps.eval.outputs.passed }}/${{ steps.eval.outputs.total }}"
```

### Save JSON results as artifact

```yaml
- uses: aparry3/agntz/.github/actions/eval@main
  with:
    agent-id: support
    json-output: eval-results.json
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

- uses: actions/upload-artifact@v4
  with:
    name: eval-results
    path: eval-results.json
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `agent-id` | No* | — | Agent ID to evaluate |
| `all` | No | `false` | Run evals for all agents with eval configs |
| `config` | No | `agntz.config.ts` | Path to config file |
| `threshold` | No | — | Minimum pass score (0-1), overrides agent config |
| `node-version` | No | `22` | Node.js version |
| `package-manager` | No | `pnpm` | Package manager (`pnpm`, `npm`, `yarn`) |
| `working-directory` | No | `.` | Working directory |
| `install-command` | No | — | Custom install command |
| `json-output` | No | — | Write JSON results to file |

\* Either `agent-id` or `all: true` must be specified.

## Outputs

| Output | Description |
|--------|-------------|
| `score` | Overall eval score (0-1) |
| `passed` | Number of test cases passed |
| `failed` | Number of test cases failed |
| `total` | Total number of test cases |
| `result` | `pass` or `fail` |

## Example Workflow

```yaml
name: Agent Evals

on:
  pull_request:
    paths:
      - "agents/**"
      - "tools/**"
      - "*.config.ts"
  schedule:
    - cron: "0 6 * * 1" # Weekly Monday 6am

jobs:
  eval:
    name: Run Agent Evals
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

      - name: Comment PR with results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const score = '${{ steps.eval.outputs.score }}';
            const passed = '${{ steps.eval.outputs.passed }}';
            const total = '${{ steps.eval.outputs.total }}';
            const result = '${{ steps.eval.outputs.result }}';
            const icon = result === 'pass' ? '✅' : '❌';
            
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## ${icon} Agent Eval Results\n\n**Score:** ${(parseFloat(score) * 100).toFixed(1)}%\n**Tests:** ${passed}/${total} passed`
            });

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: eval-results
          path: eval-results.json
```
