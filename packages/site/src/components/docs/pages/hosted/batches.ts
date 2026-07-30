export default `# Provider-native batches

Batches run a versioned Agntz LLM manifest over a reusable dataset using the
provider's asynchronous batch API. They are designed for offline enrichment,
classification, extraction, and regression runs where you want to change the
model, rerun the same inputs, and compare outputs.

\`\`\`text
versioned batch manifest + pinned dataset version
                         ↓
       OpenAI / Anthropic / Gemini / Mistral batch API
                         ↓
       normalized item results + side-by-side comparison
\`\`\`

Batch execution creates batch records only. It does not create ordinary agent
runs, sessions, or traces.

## Define a batch

A batch definition is an extended standard \`kind: llm\` manifest. The raw YAML
is the versioned source of truth.

\`\`\`yaml [customer-summaries.yaml]
id: customer-summaries
name: Customer summaries
description: Summarize each customer record for an operations review.
kind: llm

model:
  provider: openai
  name: gpt-5.4-mini
  temperature: 0.2
  maxTokens: 800

instruction: |
  You are a careful operations analyst.
  Summarize the record, identify risks, and recommend the next action.

prompt: |
  Customer record:
  {{input}}

outputSchema:
  type: object
  properties:
    summary: { type: string }
    risks:
      type: array
      items: { type: string }
    nextAction: { type: string }
  required: [summary, risks, nextAction]
  additionalProperties: false

defaultDataset:
  id: customer-records
  version: production
\`\`\`

The provider-native subset accepts \`id\`, \`name\`, \`description\`, \`model\`,
\`instruction\`, \`prompt\`, \`examples\`, \`inputSchema\`, \`outputSchema\`,
and \`defaultDataset\`. It deliberately rejects tools, skills, resources,
spawnable agents, replies, state, pipelines, runtime retries, and provider
option escape hatches. Each dataset item becomes one independent model request.

Supported providers are \`openai\`, \`anthropic\`, \`google\`, and \`mistral\`.
Agntz validates the native request/file limit used by each adapter instead of
adding a smaller platform-wide item cap. Model fields unsupported by the
selected provider are rejected instead of being silently ignored.

## Import a reusable dataset

Datasets are versioned independently from batch definitions. Imports are
staged and chunked, so clients can upload large CSV or JSONL sources without
building one large API request.

CSV defaults to \`id\` and \`input\` columns. Remaining columns become item
metadata. JSONL accepts one \`{ "id": "...", "input": ... }\` object per line.

\`\`\`ts {group=batch-import}
const dataset = await client.datasets.import({
  source: { path: "./customers.csv" },
  format: "csv",
  datasetId: "customer-records",
  name: "Customer records",
});
\`\`\`

\`\`\`python {group=batch-import}
dataset = client.datasets.import_(
    "./customers.csv",
    format="csv",
    dataset_id="customer-records",
    name="Customer records",
)
\`\`\`

You can also pass normalized item arrays to either client. Dataset versions and
aliases can be pinned in a run just like batch versions.

## Create and run from a client

\`\`\`ts {group=batch-run}
const batch = await client.batches.create(batchYaml);

const run = await client.batches.run({
  batchId: batch.id,
  datasetId: dataset.id,
  idempotencyKey: "customer-summaries-2026-07-29",
});

const fresh = await client.batches.getRun(run.id);
const page = await client.batches.items(run.id, { limit: 500 });
const jsonl = await client.batches.resultsJsonl(run.id);
\`\`\`

\`\`\`python {group=batch-run}
batch = client.batches.create(batch_yaml)

run = client.batches.run(
    batch_id=batch.id,
    dataset_id=dataset.id,
    idempotency_key="customer-summaries-2026-07-29",
)

fresh = client.batches.get_run(run.id)
page = client.batches.items(run.id, limit=500)
jsonl = client.batches.results_jsonl(run.id)
\`\`\`

A run can use a stored dataset or inline \`items\`, but not both. On submission,
Agntz resolves aliases and snapshots exact batch and dataset versions. Updating
either record later does not change an existing run.

## Swap a model and compare

Update only \`model.provider\` or \`model.name\`, save the manifest as a new
version, then submit another run against the same dataset version.

\`\`\`ts {group=batch-compare}
const comparison = await client.batches.compare(firstRun.id, secondRun.id, {
  limit: 500,
});

for (const row of comparison.rows) {
  console.log(row.itemId, row.left?.output, row.right?.output);
}
\`\`\`

\`\`\`python {group=batch-compare}
comparison = client.batches.compare(first_run.id, second_run.id, limit=500)

for row in comparison.rows:
    print(row["itemId"], row.get("left"), row.get("right"))
\`\`\`

The comparison response says whether both runs used the same dataset version.
The hosted app exposes the same workflow at \`/batches\`: edit YAML, swap the
model, rerun, inspect item results, export normalized JSONL, and compare two
runs side by side.

## Lifecycle and failures

Run states are \`validating\`, \`submitting\`, \`queued\`, \`running\`,
\`cancelling\`, \`completed\`, \`failed\`, \`expired\`, and \`cancelled\`.
Item states are \`pending\`, \`succeeded\`, \`failed\`, \`expired\`, and
\`cancelled\`.

A provider job that finishes with a mixture of successful and failed requests
is a \`completed\` batch. Its counts and item results preserve the failures.
\`failed\` is reserved for a job-level failure.

The worker leases due runs from durable storage and reconciles provider state
idempotently. Results remain available until the batch run is explicitly
deleted. Active runs must be cancelled before deletion. Use
\`client.batches.deleteRun(runId)\` in TypeScript or
\`client.batches.delete_run(run_id)\` in Python after a terminal state.

## Completion callback

Pass both \`callbackUrl\` and \`webhookSecretName\` to receive one signed
\`batch.complete\` event after a terminal state is durable.

\`\`\`ts
await client.batches.run({
  batchId: "customer-summaries",
  datasetId: "customer-records",
  callbackUrl: "https://app.example.com/webhooks/agntz",
  webhookSecretName: "production-webhook",
});
\`\`\`

Delivery uses the same HMAC headers and retry outbox as ordinary run callbacks.
The terminal delivery ID is stable, so a worker restart cannot enqueue a second
logical completion event.

## Raw HTTP

The primary routes are:

| Method | Path | Purpose |
|---|---|---|
| \`GET/POST\` | \`/batches\` | List or create batch definitions |
| \`GET/PUT/DELETE\` | \`/batches/:id\` | Read, version, or delete a definition |
| \`GET\` | \`/batches/:id/versions\` | List immutable versions |
| \`GET\` | \`/batches/:id/versions/:version\` | Resolve a version or alias |
| \`POST\` | \`/batches/:id/versions/:version/activate\` | Activate a version |
| \`PUT/DELETE\` | \`/batches/:id/aliases/:alias\` | Manage version aliases |
| \`POST\` | \`/batch-runs\` | Submit stored or inline dataset items |
| \`GET\` | \`/batch-runs\` | Filter and page runs |
| \`GET\` | \`/batch-runs/:id\` | Read reconciled provider state |
| \`DELETE\` | \`/batch-runs/:id\` | Delete a terminal run and its results |
| \`POST\` | \`/batch-runs/:id/cancel\` | Request native cancellation |
| \`GET\` | \`/batch-runs/:id/items\` | Page normalized item results |
| \`GET\` | \`/batch-runs/:id/results.jsonl\` | Export normalized JSONL |
| \`GET\` | \`/batch-runs/compare?left=...&right=...\` | Compare item outputs |
| \`POST\` | \`/dataset-imports\` | Start a staged import |
| \`POST\` | \`/dataset-imports/:id/items\` | Append up to 1,000 items |
| \`POST\` | \`/dataset-imports/:id/complete\` | Atomically publish a dataset version |

See the [HTTP API reference](/docs/deploy/http-api) for the rest of the worker
surface and [Hosted client](/docs/sdk-cli/client) for client construction and
error handling.
`;
