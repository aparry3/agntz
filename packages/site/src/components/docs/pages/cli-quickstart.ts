export default `# CLI quickstart

The \`agntz\` CLI generates YAML manifests from natural-language descriptions and runs them — locally or against the hosted cloud. No setup beyond installing the package.

## Install

\`\`\`bash
# Run on demand (no install)
npx @agntz/sdk --help

# Or install globally
npm i -g @agntz/sdk
agntz --help
\`\`\`

The CLI ships inside \`@agntz/sdk\`. Installing the package adds the \`agntz\` executable to your PATH.

## 1. Generate an agent from a description

\`\`\`bash
agntz create "Summarize a URL: fetch the page, extract the main content, return a 3-sentence summary with the source URL."
\`\`\`

The CLI calls the hosted agent-builder, validates the response, and writes the YAML to \`./agents/<id>.yaml\`:

\`\`\`
✓ Wrote agents/url-summarizer.yaml
  id: url-summarizer
  name: URL Summarizer

The agent is a sequential pipeline that fetches the URL via HTTP, then
summarizes the body with an LLM step.

Run it locally:
  agntz run agents/url-summarizer.yaml --input "..."
\`\`\`

\`create\` is **unauthenticated** — anyone can call it. The generator picks the right structure (single LLM vs. pipeline), wires HTTP or MCP tools, and adds template placeholders for inputs.

## 2. Run it locally

\`\`\`bash
export OPENAI_API_KEY=sk-...
agntz run agents/url-summarizer.yaml --input "https://example.com/blog/post-1"
\`\`\`

When the target ends in \`.yaml\` or is a directory, \`run\` invokes the in-process runtime — same as calling \`@agntz/sdk\` from code.

Stream tokens instead of waiting for the final output:

\`\`\`bash
agntz run agents/url-summarizer.yaml --input "https://..." --stream
\`\`\`

Pipe input from stdin:

\`\`\`bash
echo "https://example.com" | agntz run agents/url-summarizer.yaml
\`\`\`

## 3. (Optional) Log in and run against the hosted cloud

If you have an account on \`agntz.co\`, save your API key:

\`\`\`bash
agntz login --key ar_live_...
\`\`\`

Credentials are written to \`~/.agntz/config.json\` (\`0600\` perms). Then run a saved agent by id:

\`\`\`bash
agntz run url-summarizer --input "https://..."
\`\`\`

When the target has no slash, no \`.yaml\` suffix, and no leading \`./\`, the CLI treats it as a hosted agent id and routes through your API key. \`agntz run\` works the same in both modes — just point at a file for local, an id for hosted.

## What's next

- **[CLI reference](/docs/sdk-cli/cli)** — every command, every flag.
- **[Defining agents](/docs/concepts/agents)** — once \`create\` gives you a starting YAML, learn how to edit it.
- **[Hosted cloud](/docs/deploy/hosted-cloud)** — generate, save, and manage agents in the web UI.
`;
