export default `# CLI reference

The \`agntz\` CLI ships inside \`@agntz/sdk\`. It creates and edits YAML manifests, runs agents locally, publishes local state, and manages hosted runs, traces, and evals from the terminal.

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
| \`edit\` | ✓ | ✓ | No | Send a local YAML draft to the hosted editor and write or print the revision. |
| \`validate <path>\` | ✓ | - | No | Validate YAML, duplicate ids, and cross-file agent refs. |
| \`run <path>\` | ✓ | - | No | Run a local YAML file or single-agent directory. |
| \`run <id>\` | - | ✓ | Yes | Run a hosted agent by id. |
| \`login\` / \`logout\` / \`whoami\` | - | ✓ | Mixed | Manage hosted API credentials. |
| \`publish\` | ✓ | ✓ | Yes | Import local agents, sessions, and memrez memory into hosted storage. |
| \`runs\` | - | ✓ | Yes | List, inspect, stream, or cancel hosted runs. |
| \`traces\` | - | ✓ | Yes | List, inspect, or delete hosted traces. |
| \`eval\` | - | ✓ | Yes | Run hosted evals and inspect eval runs or latest scores. |

Every command supports terminal help:

\`\`\`bash
agntz create --help
agntz edit --help
agntz validate --help
agntz run --help
agntz login --help
agntz logout --help
agntz whoami --help
agntz publish --help
agntz runs --help
agntz traces --help
agntz eval --help
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

## \`edit\`

\`\`\`bash
agntz edit <manifest.yaml> "<change request>" [options]
\`\`\`

Sends an existing local manifest and a change request to the hosted agent editor. No login is required. By default, the complete revised YAML is printed to stdout.

| Flag | Description |
|---|---|
| \`-o, --output <path>\` | Write the revised YAML to another path. |
| \`--write\` | Overwrite the input manifest. Cannot be combined with \`--output\`. |
| \`--select <agentId>\` | Limit the edit to one uniquely matching inline or referenced agent block. |
| \`--url <apiUrl>\` | Override the editor API URL for this call. |
| \`-h, --help\` | Show command help. |

Examples:

\`\`\`bash
agntz edit ./agents/support.yaml "make the tone more concise" --write

agntz edit ./agents/pipeline.yaml \\
  "change the classifier output to include urgency" \\
  --select classifier \\
  -o ./agents/pipeline.next.yaml

agntz edit ./agents/support.yaml "add an account id input" > ./agents/support.next.yaml
\`\`\`

## \`validate\`

\`\`\`bash
agntz validate [path] [--json]
\`\`\`

Validates one YAML file or recursively scans a directory. The default path is
\`./agents\`; dependency, build-output, coverage, and hidden directories are
ignored during recursion. Directory validation also rejects duplicate agent ids
and unresolved pipeline, spawnable, or agent-as-tool references. The command
exits with status 1 when any file fails or no agent manifests are found.

\`--json\` prints a complete machine-readable report, including per-file errors,
warnings, and aggregate counts:

\`\`\`bash
agntz validate ./agents
agntz validate ./agents/support.yaml --json
\`\`\`

For editor completion, associate YAML files with
\`https://agntz.co/schemas/agent-manifest.schema.json\` or use the packaged
schema at \`@agntz/core/schema\`.

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

## \`publish\`

Migrates local manifests, persisted sessions, and memrez memory into hosted storage. Requires \`AGNTZ_API_KEY\` or \`agntz login\`.

\`\`\`bash
agntz publish [all|agents|sessions|memory...] [options]
\`\`\`

With no entity arguments, \`publish\` attempts to discover and publish all three entity types. An explicitly requested missing source is an error; an undiscovered optional source is reported as skipped.

Options:

| Flag | Description |
|---|---|
| \`--agents-dir <dir>\` | Recursively scanned agent manifest directory. Default: \`./agents\`. |
| \`--db <path>\` | Local SDK SQLite store for sessions. Defaults to \`./agntz.db\` when that file exists. |
| \`--memory-db <path>\` | Local memrez SQLite store. Default: \`./memory.db\` or \`./memrez.db\` if present. |
| \`--dry-run\` | Report what would be imported without writing hosted state. |
| \`--yes\` | Skip the interactive confirmation. Required for a non-interactive publish unless using \`--dry-run\`. |
| \`--skip-existing\` | Skip hosted agents whose ids already exist instead of creating new versions. |
| \`--fail-existing\` | Fail when a hosted agent or session already exists. Cannot be combined with \`--skip-existing\`. |
| \`--include-superseded\` | Include superseded memory entries. |
| \`--url <apiUrl>\` | Override the hosted API URL for this call. |
| \`--json\` | Print a machine-readable result. |
| \`-h, --help\` | Show command help. |

Existing agent ids create new hosted versions by default. Existing session snapshots are skipped by default. Publishing a manifest does not upload arbitrary in-process tool or resource-provider code; move those dependencies to hosted MCP/HTTP tools or signed callback endpoints before running the agent remotely.

Examples:

\`\`\`bash
agntz login --key ar_live_...
agntz publish agents --agents-dir ./agents --dry-run
agntz publish agents --agents-dir ./agents --yes
agntz run support --remote --input "Hello from the hosted runtime"

agntz publish agents sessions memory --db ./agntz.db --memory-db ./memory.db --yes
agntz publish memory --memory-db ./memrez.db
\`\`\`

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

## \`eval\`

Hosted eval management. Requires \`AGNTZ_API_KEY\` or \`agntz login\`.

\`\`\`bash
agntz eval run    <evalId> [--dataset <id>] [--version <agentVersion>]
agntz eval runs   [--agent <id>] [--eval <id>] [--dataset <id>] [--status <s>] [--limit <n>] [--cursor <c>]
agntz eval cancel <runId>
agntz eval scores [--agent <id>] [--eval <id>] [--dataset <id>] [--version <createdAt>] [--status <s>]
agntz eval get    <evalId>
\`\`\`

Examples:

\`\`\`bash
agntz eval run support-quality --dataset refund-cases
agntz eval runs --agent support --limit 10
agntz eval scores --eval support-quality --dataset refund-cases
agntz eval get support-quality
\`\`\`

## Current CLI boundary

The CLI covers manifest generation and AI-assisted editing, recursive validation, local execution, hosted execution, state publishing, hosted run/trace inspection, and hosted eval execution. It does not provide project scaffolding, an interactive playground, or a Studio launcher. Use the SDK for application runtime wiring and the hosted app for interactive managed editing.

## Exit behavior

| Exit code | Meaning |
|---|---|
| \`0\` | Success |
| \`1\` | Argument, auth, network, builder, validation, or runtime error |

Most commands write human-readable errors to stderr. \`agntz validate --json\` and \`agntz publish --json\` provide structured CLI output; use \`@agntz/sdk\` for deeper local integration or \`@agntz/client\` for hosted execution.
`;
