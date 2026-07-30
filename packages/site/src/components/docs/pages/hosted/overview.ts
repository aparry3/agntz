export default `# Provider-replacement hosted AI

Agntz can sit at the boundary where an application would otherwise call a
provider SDK directly. Your application prepares the input and owns its business
rules; Agntz owns the model call, prompt, model selection, structured-output
schema, media transport, and normalized response.

\`\`\`text
application input
      ↓
client.agents.run(...)
      ↓
active Agntz manifest version
      ↓
OpenAI / Anthropic / Google / another configured provider
      ↓
normalized output, usage, model, version, and retention metadata
\`\`\`

The goal is a small, stable integration in application code while model behavior
can change independently in the manifest.

## What moves into Agntz

- System instructions, user prompt templates, and examples.
- Provider and model selection.
- Sampling, reasoning, output-token, stop, seed, and retry settings.
- Recursive JSON Schema for structured inputs and outputs.
- Ordered text, image, and audio content.
- Transcription and image-generation operation settings.
- Model-visible callback tool schemas and descriptions.
- Default retention and artifact lifetime.

## What stays in your application

- Deciding which records need model work.
- Authorization and database access.
- Preprocessing, chunking, and application-specific caching.
- Validating application invariants that are stricter than the model schema.
- Mapping output to domain records and enforcing budgets.
- Business retries and idempotency around the complete workflow.

Changing the shape of an application contract can still require application
code and database changes. The no-deploy benefit applies to model behavior
within a compatible contract.

## One run API for every hosted operation

\`agents.run\`, \`agents.stream\`, and \`agents.start\` share the same request
contract. The active manifest kind selects the operation.

| Manifest kind | Hosted behavior |
|---|---|
| \`llm\` | Text or multimodal generation, optionally with structured output and tools |
| \`transcription\` | Audio transcription with typed transcript metadata |
| \`image\` | Image generation with managed output artifacts |
| \`tool\`, \`sequential\`, \`parallel\` | Deterministic calls and composed agent workflows |

\`\`\`ts {group=hosted-provider-call}
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: "https://api.agntz.co",
});

const result = await client.agents.run({
  agentId: "recipe-facet-enrichment",
  input: { recipes },
  retention: { mode: "result", ttlSeconds: 86_400 },
});

console.log(result.output);
console.log(result.provider, result.model, result.usage);
console.log(result.resolvedAgentVersion);
\`\`\`

\`\`\`python {group=hosted-provider-call}
import os
from agntz import AgntzClient

client = AgntzClient(
    api_key=os.environ["AGNTZ_API_KEY"],
    base_url="https://api.agntz.co",
)

result = client.agents.run(
    agent_id="recipe-facet-enrichment",
    input={"recipes": recipes},
    retention={"mode": "result", "ttl_seconds": 86_400},
)

print(result.output)
print(result.provider, result.model, result.usage)
print(result.resolved_agent_version)
\`\`\`

## A migration sequence that keeps risk small

1. Copy the existing provider prompt, model settings, and JSON Schema into a
   manifest.
2. Import the manifest and pin the application to an alias or exact version
   while testing.
3. Compare direct-provider and Agntz outputs in an eval dataset.
4. Replace the provider call with \`agents.run\`.
5. Keep domain validation and persistence unchanged.
6. Move the alias when a new manifest version passes evaluation.

Use \`retention.mode: none\` when the old call was stateless and should leave no
durable run, trace, or session data. Use \`result\` for a redacted audit record,
or \`session\` for conversational history and complete traces.

## Current operation boundary

The built-in hosted transcription and image adapters currently use OpenAI.
Ordinary \`llm\` manifests support every provider listed in
[Models and providers](/docs/models). Self-hosted workers expose an operation
registry for additional adapters. Provider-native asynchronous batches are a
separate record type—not a manifest kind—and support OpenAI, Anthropic, Gemini,
and Mistral. See [Provider-native batches](/docs/hosted/batches).

## Read next

- **[Content, artifacts, and retention](/docs/hosted/content-artifacts-retention)**
  — media transport and persistence choices.
- **[Transcription and image generation](/docs/hosted/transcription-images)**
  — manifests, calls, and output shapes.
- **[Results, streaming, and errors](/docs/hosted/results-errors)**
  — the normalized response contract.
- **[Hosted client](/docs/sdk-cli/client)** — the complete TypeScript and Python
  resource API.
`;
