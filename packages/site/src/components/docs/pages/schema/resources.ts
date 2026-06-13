export default `# Resources

\`resources:\` declares runtime capabilities an LLM agent may use, such as memory, RAG, files, or other provider-backed context. The manifest layer validates the generic shape; providers define the actual behavior.

\`\`\`yaml
id: support-with-memory
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: |
  Help the user. Use durable memory when it is relevant.
resources:
  memory:
    mode: read-write
    autoScan: true
  product-docs:
    kind: rag
    mode: read
    namespace: docs/product
\`\`\`

Resources are currently an LLM-agent field. Pipeline agents can call LLM agents that declare resources, and the resource access follows the same run-time \`context\` grants.

## Field reference

### Resource name

The map key is the resource instance name:

\`\`\`yaml
resources:
  memory:
    mode: read-write
\`\`\`

Rules:

- Must match \`^[a-zA-Z][a-zA-Z0-9_-]*$\`.
- Used as the tool-name prefix.
- May contain hyphens, but generated tool prefixes replace non-identifier characters with \`_\`.

For example, a resource named \`product-docs\` with a provider tool named \`search\` becomes \`product_docs_search\`.

### \`kind\`

Provider kind. The runtime uses this to find the matching \`ResourceProvider\`.

\`\`\`yaml
resources:
  user-memory:
    kind: memory
    mode: read-write
  org-memory:
    kind: memory
    mode: read
\`\`\`

When omitted, \`kind\` defaults to the resource name. This shorthand is common for a single \`memory\` resource.

### \`mode\`

Per-agent access mode.

| Value | Meaning |
|---|---|
| \`read\` | Register read-safe provider tools only. |
| \`read-write\` | Register read and write provider tools. |

Providers may define a default when \`mode\` is omitted. The memory provider defaults to \`read-write\`.

Child agents cannot widen a parent's effective mode. If the parent has \`mode: read\`, children that use the same provider kind stay read-only.

### \`namespace\`

Optional static provider input.

\`\`\`yaml
resources:
  product-docs:
    kind: rag
    mode: read
    namespace: docs/product
\`\`\`

\`namespace\` is not an automatic runtime grant. It is provider configuration. Runtime access still comes from the \`context\` array passed to \`client.agents.run(...)\` or the worker HTTP API.

### \`config\` and provider-specific fields

Providers may read additional fields from the resource entry. These fields pass through the manifest layer unchanged.

\`\`\`yaml
resources:
  memory:
    mode: read-write
    autoScan: true
    preload:
      core: true
      topics: [goals, equipment]
      limit: 30
      maxChars: 10000
      types: [fact, preference, summary]
    writePolicy:
      descendants: true
      ancestorPromotion: none
\`\`\`

Use provider docs to know which fields are meaningful. For memrez, \`autoScan\` injects topic summaries and \`preload\` controls full-entry memory injected before tool calls. Topic taxonomy and reasoner policy are Memrez-level concerns, not agent resource fields. See [Memory with memrez](/docs/tools/memory-memrez).

## Generated tools

Resource provider tools are exposed as:

\`\`\`text
<resource-name-prefix>_<provider-tool-name>
\`\`\`

Examples:

| Resource | Provider tool | Model-visible tool |
|---|---|---|
| \`memory\` | \`read\` | \`memory_read\` |
| \`memory\` | \`write\` | \`memory_write\` |
| \`product-docs\` | \`search\` | \`product_docs_search\` |

The runtime rejects collisions with existing local tools or other generated resource tools. Rename the resource or the conflicting tool if this happens.

## Runtime grants

Declare the resource in YAML, then pass trusted namespace grants at run time:

\`\`\`ts {group=resource-run}
await client.agents.run({
  agentId: "support-with-memory",
  input: "What do you remember about my preferences?",
  context: ["app/user/" + userId],
});
\`\`\`

\`\`\`python {group=resource-run}
client.agents.run(
    agent_id="support-with-memory",
    input="What do you remember about my preferences?",
    context=[f"app/user/{user_id}"],
)
\`\`\`

Resource providers receive those grants through \`ResourceToolContext.grants\`. The model sees provider tools, not namespace arguments.

## Provider wiring

Embedded SDKs wire providers at client construction:

\`\`\`ts {group=resource-provider}
const client = await agntz({
  agents: "./agents",
  resources: { memory: memrez.provider() },
});
\`\`\`

\`\`\`python {group=resource-provider}
client = agntz(
    agents="./agents",
    resources={"memory": memrez.provider()},
    model_provider=LiteLLMModelProvider(),
)
\`\`\`

If an agent declares a resource kind and no provider is registered for that kind, startup or invocation fails with a provider-missing error. Hosted workers wire providers server-side.

## Where to go next

- **[Context and resources](/docs/concepts/context-and-resources)** - the runtime grant model.
- **[Memory with memrez](/docs/tools/memory-memrez)** - the built-in memory resource provider.
`;
