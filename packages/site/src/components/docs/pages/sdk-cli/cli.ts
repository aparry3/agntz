export default `# CLI reference

The \`agntz\` CLI ships inside \`@agntz/sdk\`. It creates YAML manifests, runs agents locally, and manages hosted runs and traces from the terminal.

\`\`\`bash
# Run without installing
npx @agntz/sdk --help

# Or install globally
npm i -g @agntz/sdk
agntz --help
\`\`\`

For the first local workflow, start with [CLI getting started](/docs/cli-quickstart).

## Command map

| Command | Local? | Hosted? | Auth? | Purpose |
|---|---:|---:|---:|---|
| \`create\` | - | ✓ | No | Generate YAML from a description through the hosted builder. |
| \`run <path>\` | ✓ | - | No | Run a local YAML file or single-agent directory. |
| \`run <id>\` | - | ✓ | Yes | Run a hosted agent by id. |
| \`login\` / \`logout\` / \`whoami\` | - | ✓ | Mixed | Manage hosted API credentials. |
| \`runs\` | - | ✓ | Yes | List, inspect, stream, or cancel hosted runs. |
| \`traces\` | - | ✓ | Yes | List, inspect, or delete hosted traces. |

Every command supports terminal help:

\`\`\`bash
agntz create --help
agntz run --help
agntz login --help
agntz runs --help
agntz traces --help
\`\`\`

## Auth and configuration

Hosted commands read credentials in this order:

1. \`AGNTZ_API_KEY\`
2. \`~/.agntz/config.json\`, written by \`agntz login\`

API URL resolution uses:

1. command \`--url\` where supported
2. \`AGNTZ_API_URL\`
3. saved config
4. \`https://api.agntz.co\`

Local runs do not require an agntz API key. They use provider keys from your process environment, such as \`OPENAI_API_KEY\`, \`ANTHROPIC_API_KEY\`, or other keys required by the manifest's model/tool configuration.

## \`create\`

\`\`\`bash
agntz create "<description>" [options]
\`\`\`

Generates a YAML manifest by calling the hosted agent-builder. No login is required.

| Flag | Description |
|---|---|
| \`-o, --output <path>\` | Write the manifest to a specific path. Default: \`./agents/<id>.yaml\`. |
| \`--stdout\` | Print YAML to stdout instead of writing a file. |
| \`--current-manifest <path>\` | Revise an existing manifest instead of starting fresh. |
| \`--url <apiUrl>\` | Override the builder API URL for this call. |
| \`-h, --help\` | Show command help. |

Examples:

\`\`\`bash
agntz create "Answer support questions in a concise tone" -o ./agents/support.yaml

agntz create "Add an HTTP order lookup tool" \\
  --current-manifest ./agents/support.yaml \\
  -o ./agents/support.yaml

agntz create "Classify inbound leads by urgency" --stdout > ./agents/lead-classifier.yaml
\`\`\`

\`create\` validates that the builder returned YAML, parses the manifest to get its \`id\`, creates parent directories as needed, and prints the local \`run\` command to try next.

## \`run\`

\`\`\`bash
agntz run <path-or-id> [options] [input...]
\`\`\`

Runs an agent. The target determines local vs hosted mode unless you force a mode.

| Target shape | Mode |
|---|---|
| \`./agents/support.yaml\` | Local YAML file |
| \`agents/support.yml\` | Local YAML file |
| \`./agents\` | Local directory, only if it contains exactly one manifest |
| \`support\` | Hosted agent id |

| Flag | Description |
|---|---|
| \`--input <text>\` | Input string. Use \`--input -\` to read stdin. |
| \`--session <id>\` | Reuse a session id across calls. |
| \`--stream\` | Stream reply/complete/error events instead of buffering the final output. |
| \`--local\` | Force local execution. |
| \`--remote\` | Force hosted execution. |
| \`-h, --help\` | Show command help. |

Input resolution:

\`\`\`text
--input value > trailing positional text > piped stdin > empty string
\`\`\`

Examples:

\`\`\`bash
# Local file
agntz run ./agents/support.yaml --input "How do I reset my password?"

# Local file with stdin
cat ticket.txt | agntz run ./agents/support.yaml

# Local file with persistent conversation state
agntz run ./agents/support.yaml --session user-42 --input "My email changed"

# Hosted agent id
agntz run support --input "Hello" --remote

# Stream hosted or local output
agntz run ./agents/support.yaml --input "Walk me through this" --stream
\`\`\`

Local runtime boundary: \`agntz run ./agents/support.yaml\` constructs a local SDK client with \`agntz({ agents: "<manifest-dir>" })\`. It can run agents whose requirements are satisfied by YAML plus environment configuration. If the agent declares local tools or resource providers that need application code, call \`@agntz/sdk\` from your service and pass \`tools\` / \`resources\` there.

## \`login\`, \`logout\`, and \`whoami\`

\`\`\`bash
agntz login --key <apiKey> [--url <apiUrl>]
agntz logout
agntz whoami
\`\`\`

\`login\` writes credentials to \`~/.agntz/config.json\` with owner-only permissions. \`logout\` removes that file. \`whoami\` prints the resolved API URL and a masked key source.

Examples:

\`\`\`bash
agntz login --key ar_live_...
agntz login --key ar_live_... --url https://agntz-worker.example.com
AGNTZ_API_KEY=ar_live_... agntz whoami
agntz logout
\`\`\`

Browser-based login is not implemented in the current CLI. Paste an API key from the hosted or self-hosted dashboard.

## \`runs\`

Hosted run management. Requires \`AGNTZ_API_KEY\` or \`agntz login\`. Output is JSON.

\`\`\`bash
agntz runs list   [--agent <id>] [--status <s>] [--limit <n>] [--cursor <c>]
agntz runs get    <runId>
agntz runs stream <runId> [--since <seq>]
agntz runs cancel <runId>
\`\`\`

Examples:

\`\`\`bash
agntz runs list --agent support --limit 20
agntz runs get run_123
agntz runs stream run_123 --since 10
agntz runs cancel run_123
\`\`\`

\`runs stream\` emits the multiplexed event stream for a hosted run subtree. \`--since <seq>\` resumes from a sequence number.

## \`traces\`

Hosted trace management. Requires \`AGNTZ_API_KEY\` or \`agntz login\`.

\`\`\`bash
agntz traces list   [--agent <id>] [--status <s>] [--limit <n>] [--cursor <c>]
agntz traces get    <traceId>
agntz traces delete <traceId>
\`\`\`

Examples:

\`\`\`bash
agntz traces list --agent support --status failed --limit 10
agntz traces get trace_123
agntz traces delete trace_123
\`\`\`

## Current CLI boundary

The current CLI command surface is intentionally small:

\`\`\`text
create, run, login, logout, whoami, runs, traces
\`\`\`

The current CLI does not provide project scaffolding, eval execution, validation-only execution, an interactive playground, or a Studio launcher. Use the SDK docs for in-process validation/runtime wiring, and use the hosted app for managed agent editing.

## Exit behavior

| Exit code | Meaning |
|---|---|
| \`0\` | Success |
| \`1\` | Argument, auth, network, builder, validation, or runtime error |

The CLI writes human-readable errors to stderr. For structured programmatic integration, use \`@agntz/sdk\` for local execution or \`@agntz/client\` for hosted execution.
`;
