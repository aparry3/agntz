export default `# Templates and conditions

agntz uses a small templating language — handlebars-shaped, intentionally tiny — for variable interpolation in instructions, tool params, step inputs, and the \`output\` map. Conditional execution (\`when\`, \`until\`) uses the same syntax with a comparison-operator extension.

## Variable interpolation

\`{{name}}\` is replaced with the resolved value from state.

\`\`\`yaml
instruction: |
  You are a writing assistant. Write about {{topic}} in a {{tone}} tone.

  {{#if feedback}}
  The reviewer provided feedback. Incorporate it:
  {{feedback}}
  {{/if}}

  {{#if language != en}}
  Write your response in {{language}}.
  {{/if}}
\`\`\`

Rules:

- \`{{varName}}\` — replaced with the resolved value. **Null renders as empty.**
- Dotted paths like \`{{researcher.summary}}\` walk into a sub-agent's output.
- Unresolved references (skipped steps, first loop iteration) resolve to **null** — they don't throw.

## Conditional blocks

\`\`\`yaml
{{#if varName}}                  # truthy: non-null, non-empty, non-zero
  ...
{{/if}}

{{#if varName == value}}          # equality
  ...
{{/if}}

{{#if varName != value}}          # inequality
  ...
{{/if}}
\`\`\`

Blocks can be nested but cannot be parameterized — there's no \`{{#each}}\`, no helpers, no expression evaluation beyond \`==\` / \`!=\`.

## Conditions in \`when\` and \`until\`

Used at step level (\`when\`) and at sequential level (\`until\`). Evaluated against the resolved state.

\`\`\`yaml
when: "{{language}} != en"
when: "{{feedback}}"                                     # truthiness
until: "{{score}} >= 0.8"
until: "{{score}} >= 0.8 && {{reviewer.approved}} == true"
\`\`\`

Operators:

| Operator | Meaning |
|---|---|
| \`==\` | Equal |
| \`!=\` | Not equal |
| \`>\`, \`<\` | Numeric comparison |
| \`>=\`, \`<=\` | Numeric comparison |
| \`&&\` | Logical AND |
| \`||\` | Logical OR |

**Truthiness** = non-null, non-empty, non-zero. Strings, arrays, and objects are truthy if non-empty.

## Special namespaces

Some \`{{...}}\` references aren't state lookups — they're resolved by the runtime against the environment or the workspace's secret store.

\`\`\`yaml
headers:
  Authorization: "Bearer {{env.SEARCH_KEY}}"   # embedded mode — reads process.env
  X-API-Key:     "{{secrets.WEATHER_TOKEN}}"   # hosted mode — reads workspace secrets
\`\`\`

| Prefix | Source | Where supported |
|---|---|---|
| \`{{env.NAME}}\` | \`process.env\` | Embedded; hosted is opt-in per server |
| \`{{secrets.NAME}}\` | Workspace secret store | Hosted only |

In hosted mode, \`{{env.X}}\` is intentionally restricted — multi-tenant workers don't share an environment with your code. Use \`{{secrets.X}}\` for credentials and configure them in **Settings → Secrets** on the hosted edition.

## What's *not* in templates

agntz's templating is deliberately small. There's no:

- arbitrary expression evaluation
- loops (\`{{#each}}\`)
- helpers / partials
- string transforms
- Math

If you need to compute something, do it in a tool agent and pin the result into state, or do it client-side before calling the agent.
`;
