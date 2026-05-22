export default `# CLI reference

The \`agntz\` CLI ships inside \`@agntz/sdk\`. It's a thin wrapper over the SDK and hosted client, designed for ad-hoc agent creation, local execution, and hosted run management from the terminal.

\`\`\`bash
# Install
npm i -g @agntz/sdk
# or run on demand without installing
npx @agntz/sdk --help
\`\`\`

For an end-to-end walkthrough, see the [CLI quickstart](/docs/cli-quickstart).

## Auth model

The CLI has two execution modes:

- **Local (no auth)** — \`create\` (calls the public agent-builder endpoint) and \`run <path>\` (runs YAML in-process). Anyone can use these.
- **Hosted (requires login)** — \`run <id>\`, \`runs *\`, \`traces *\`. Uses an API key minted on \`agntz.co\` or your self-hosted UI.

Credentials are read in this order:

1. \`AGNTZ_API_KEY\` env var
2. \`~/.agntz/config.json\` (\`0600\` perms, written by \`agntz login\`)

Same precedence for the API URL — \`--url\` flag > \`AGNTZ_API_URL\` env > config > default (\`https://api.agntz.co\`).

## \`create\` — generate from a description

\`\`\`bash
agntz create "<description>" [-o <path>] [--stdout]
\`\`\`

Generates a YAML manifest by calling the hosted agent-builder. **No auth required.**

| Flag | Description |
|---|---|
| \`-o, --output <path>\` | Write the manifest to a specific path. Default: \`./agents/<id>.yaml\`. |
| \`--stdout\` | Print the YAML to stdout instead of writing a file. |
| \`--current-manifest <path>\` | Iterate on an existing manifest; the builder edits it instead of starting fresh. |
| \`--url <apiUrl>\` | Override the API URL for this call. |

Example:

\`\`\`bash
agntz create "Summarize a URL: fetch the page, extract the main content, return a 3-sentence summary with the source URL."
# ✓ Wrote agents/url-summarizer.yaml
\`\`\`

## \`run\` — execute an agent

\`\`\`bash
agntz run <path-or-id> [--input <text>] [--session <id>] [--stream]
\`\`\`

Executes an agent. **Local or hosted, picked automatically:**

- Target ends in \`.yaml\`/\`.yml\` or contains a path separator → **local** (\`@agntz/sdk\` runtime)
- Target is a bare id → **hosted** (\`@agntz/client\` against your saved API URL)

Force a mode with \`--local\` or \`--remote\`.

| Flag | Description |
|---|---|
| \`--input <text>\` | The input string. Use \`-\` to read from stdin. |
| \`--session <id>\` | Reuse a session id across calls (sessions persist conversation history). |
| \`--stream\` | Stream tokens / reply events to stdout instead of buffering. |
| \`--local\` | Force local execution. |
| \`--remote\` | Force hosted execution. |

Input resolution: \`--input\` value > trailing positional args > stdin (if piped) > empty.

Examples:

\`\`\`bash
# Local file
agntz run agents/summarizer.yaml --input "https://example.com"

# Single-agent directory
agntz run agents/                                   # picks the only manifest

# Hosted agent by id
agntz run url-summarizer --input "https://example.com"

# Pipe input
echo "https://example.com" | agntz run agents/summarizer.yaml

# Stream tokens with a persistent session
agntz run support --input "hello" --session user-42 --stream
\`\`\`

## \`runs\` — manage hosted runs

Requires login. Output is JSON (suitable for piping into \`jq\`).

\`\`\`bash
agntz runs list   [--agent <id>] [--status <s>] [--limit <n>] [--cursor <c>]
agntz runs get    <runId>
agntz runs stream <runId> [--since <seq>]
agntz runs cancel <runId>
\`\`\`

\`runs stream\` emits the multiplexed event stream for a run subtree — parent + descendants. \`--since <seq>\` resumes from a sequence number (useful for retries / reconnects).

\`runs cancel\` cascades to every descendant run.

## \`traces\` — manage hosted traces

\`\`\`bash
agntz traces list   [--agent <id>] [--status <s>] [--limit <n>] [--cursor <c>]
agntz traces get    <traceId>
agntz traces delete <traceId>
\`\`\`

## \`login\` / \`logout\` / \`whoami\`

\`\`\`bash
agntz login --key ar_live_... [--url <apiUrl>]
agntz logout
agntz whoami
\`\`\`

\`login\` writes the key + (optional) API URL to \`~/.agntz/config.json\` with \`0600\` permissions. \`logout\` removes the file. \`whoami\` prints the resolved API URL and a masked key (or "not logged in").

Browser-based login (OAuth-style device flow) is coming in a follow-up. For now, paste an API key from the dashboard.

## Environment variables

| Variable | Effect |
|---|---|
| \`AGNTZ_API_KEY\` | Overrides the saved key for the current invocation. |
| \`AGNTZ_API_URL\` | Overrides the saved API URL. Default: \`https://api.agntz.co\`. |
| Provider keys (\`OPENAI_API_KEY\`, \`ANTHROPIC_API_KEY\`, ...) | Used by **local** runs only. Hosted runs use the keys configured on your workspace. |

## Global flags

\`\`\`bash
agntz --help            # show top-level help
agntz --version         # show installed CLI version
\`\`\`

Every subcommand also accepts \`-h\` for help on that subcommand alone.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Any error — argument parse, network, validation, or runtime failure |

The CLI is intentionally simple — it writes a clear error message to stderr and exits with 1. For programmatic use, prefer calling \`@agntz/sdk\` or \`@agntz/client\` directly.
`;
