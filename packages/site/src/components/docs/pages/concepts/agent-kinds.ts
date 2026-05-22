export default `# The four agent kinds

Every manifest sets \`kind\` to one of four values. **Primitives** (\`llm\`, \`tool\`) do the actual work; **pipelines** (\`sequential\`, \`parallel\`) compose primitives and other pipelines into multi-step workflows.

## llm — call a model

The basic case. An LLM agent calls one language model with an instruction, optional tools, and optional structured output.

\`\`\`yaml [agents/chatbot.yaml]
id: chatbot
name: Chatbot
description: A simple conversational assistant
kind: llm

model:
  provider: openai
  name: gpt-5.4-mini
  temperature: 0.7

instruction: |
  You are a friendly, helpful assistant. Answer the user's question clearly and concisely.

  {{userQuery}}
\`\`\`

With no \`inputSchema\`, the agent takes a plain string accessible as \`{{userQuery}}\`. Add \`inputSchema\` to type the input; add \`outputSchema\` to constrain the response shape. See [Input, state, and output](/docs/schema/input-state-output).

## tool — deterministic, no model

A tool agent maps state values to a single tool call. No LLM, no reasoning — just a direct function or API call wrapped in the same observability model.

\`\`\`yaml [agents/send-email.yaml]
id: send-email
kind: tool

inputSchema:
  recipientEmail: string
  emailSubject: string
  emailBody: string

tool:
  kind: mcp
  server: https://email-api.example.com/mcp
  name: send_email
  params:
    to: "{{recipientEmail}}"
    subject: "{{emailSubject}}"
    body: "{{emailBody}}"
\`\`\`

Use this when you want the predictability of a hard-coded call inside a larger pipeline — for example, a "notify Slack" step at the end of an article workflow.

## sequential — run steps in order

Sequential agents run \`steps\` one after another. Each step's output is added to state under its \`id\` (or its \`stateKey\`) and becomes available to downstream steps as \`{{stepId.property}}\`.

\`\`\`yaml [agents/research-and-summarize.yaml]
id: research-and-summarize
kind: sequential

inputSchema:
  userQuery: string

steps:
  - ref: researcher
    input:
      query: "{{userQuery}}"

  - agent:
      id: summarizer
      kind: llm
      model: { provider: openai, name: gpt-5.4 }
      instruction: |
        Summarize this research: {{researcher}}
      outputSchema:
        summary: string

output:
  summary: "{{summarizer.summary}}"
  sourceResearch: "{{researcher}}"
\`\`\`

Use \`ref:\` to point at an existing agent id; use \`agent:\` to inline one. Both have full access to the same state object.

### Looping

Add \`until\` to make a sequential agent loop. \`maxIterations\` is the safety stop.

\`\`\`yaml
id: write-review-loop
kind: sequential

until: "{{reviewer.approved}} == true"
maxIterations: 5

steps:
  - ref: writer
    input:
      topic: "{{topic}}"
      feedback: "{{reviewer.feedback}}"   # null on first iteration
  - ref: reviewer
    input:
      draft: "{{writer.draft}}"
\`\`\`

See [Pipeline steps and looping](/docs/schema/pipeline-steps) for the full reference on \`when\`, \`until\`, and \`stateKey\`.

## parallel — run branches simultaneously

Parallel agents run \`branches\` at the same time and merge their outputs into state.

\`\`\`yaml
id: text-analysis
kind: parallel

inputSchema:
  text: string

branches:
  - ref: sentimentAnalyzer
    input: { text: "{{text}}" }
  - ref: entityExtractor
    input: { text: "{{text}}" }
\`\`\`

If you don't declare an \`output:\`, the result is the merged state — \`{ sentimentAnalyzer, entityExtractor }\`.

## Putting it together

Pipelines nest. A single manifest can mix parallel research, a write/review loop, and a tool-call notification:

\`\`\`yaml [agents/article-pipeline.yaml]
id: article-pipeline
kind: sequential

inputSchema:
  topic: string
  tone:
    type: string
    default: professional

steps:
  # Step 1: research in parallel
  - agent:
      id: research-phase
      kind: parallel
      stateKey: research
      branches:
        - ref: web-researcher
          input: { query: "{{topic}}" }
        - ref: academic-researcher
          input: { query: "{{topic}}" }

  # Step 2: write + review until approved
  - agent:
      id: write-review
      kind: sequential
      stateKey: writing
      until: "{{editor.approved}} == true"
      maxIterations: 3
      steps:
        - ref: writer
          input:
            topic: "{{topic}}"
            tone: "{{tone}}"
            webResearch: "{{research.webResearcher}}"
            academicResearch: "{{research.academicResearcher}}"
            feedback: "{{editor.feedback}}"
        - ref: editor
          input: { draft: "{{writer.draft}}" }

  # Step 3: notify
  - agent:
      id: notify
      kind: tool
      tool:
        kind: local
        name: send_slack
        params:
          channel: "#content"
          message: "New article ready: {{topic}}"

output:
  article: "{{writing.writer.draft}}"
  review: "{{writing.editor}}"
\`\`\`

The trace for this run shows nested spans for the parallel research phase, every loop iteration of the write/review step, and the final tool call. See [Runs and traces](/docs/concepts/runs-and-traces).
`;
