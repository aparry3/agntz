export default `# Content, artifacts, and retention

Hosted runs accept structured \`input\` and an independent ordered \`content\`
message. Use \`input\` for template variables and application data; use
\`content\` for the exact text, image, and audio parts sent to the operation.

## Content blocks

| Block | Sources | Notes |
|---|---|---|
| \`text\` | inline text | Preserves ordering with media blocks |
| \`image\` | URL, base64, artifact id, or local file | JPEG, PNG, GIF, and WebP; optional \`detail\` |
| \`audio\` | URL, base64, artifact id, or local file | Transcription requires exactly one audio block |

URL blocks can include headers. The worker applies its outbound URL policy
before downloading remote media. Do not place durable credentials in a
manifest or content block when an uploaded artifact is sufficient.

\`\`\`ts {group=rich-content}
const result = await client.agents.run({
  agentId: "extract-recipe",
  input: { sourceId: "video_123" },
  content: [
    { type: "text", text: "Extract the recipe shown in these frames." },
    {
      type: "image",
      file: { path: "./frames/001.png", mediaType: "image/png" },
      detail: "high",
    },
    {
      type: "image",
      url: "https://cdn.example.com/frame-002.jpg",
      detail: "low",
    },
  ],
  retention: { mode: "result", artifactTtlSeconds: 3_600 },
});
\`\`\`

\`\`\`python {group=rich-content}
from pathlib import Path

result = client.agents.run(
    agent_id="extract-recipe",
    input={"sourceId": "video_123"},
    content=[
        {"type": "text", "text": "Extract the recipe shown in these frames."},
        {
            "type": "image",
            "file": Path("./frames/001.png"),
            "media_type": "image/png",
            "detail": "high",
        },
        {
            "type": "image",
            "url": "https://cdn.example.com/frame-002.jpg",
            "detail": "low",
        },
    ],
    retention={"mode": "result", "artifact_ttl_seconds": 3_600},
)
\`\`\`

Node clients accept \`Blob\`, \`ArrayBuffer\`, \`Uint8Array\`, or a
\`{ path, mediaType, filename }\` object. Python clients accept
\`pathlib.Path\`, path strings, bytes, and file-like objects. Local files are
uploaded before the run and replaced with tenant-scoped artifact ids; local
paths never appear on the wire.

## Explicit artifact management

Use the artifact resource when several runs share the same media, when upload
and execution happen in different jobs, or when you need to download generated
images.

\`\`\`ts {group=artifact-resource}
const artifact = await client.artifacts.upload({
  file: { path: "./narration.mp3", mediaType: "audio/mpeg" },
  purpose: "input",
  expiresInSeconds: 3_600,
});

const metadata = await client.artifacts.get(artifact.id);
const audio = await client.artifacts.download(artifact.id); // Blob

await client.agents.run({
  agentId: "social-transcription",
  content: [{ type: "audio", artifactId: artifact.id }],
  retention: { mode: "none" },
});

await client.artifacts.delete(artifact.id);
\`\`\`

\`\`\`python {group=artifact-resource}
artifact = client.artifacts.upload(
    file="./narration.mp3",
    media_type="audio/mpeg",
    purpose="input",
    expires_in_seconds=3_600,
)

metadata = client.artifacts.get(artifact.id)
audio = client.artifacts.download(artifact.id)  # bytes

client.agents.run(
    agent_id="social-transcription",
    content=[{"type": "audio", "artifact_id": artifact.id}],
    retention={"mode": "none"},
)

client.artifacts.delete(artifact.id)
\`\`\`

Artifact metadata includes the owner, purpose, media type, byte size, SHA-256
digest, creation and expiry times, status, and a short-lived signed download URL
when the deployment provides one. Artifact ids are owner-scoped; one tenant
cannot read another tenant's object even if it learns the id.

Uploads are limited to 50 MiB. Explicit and automatic input uploads accept
lifetimes from 60 seconds through 7 days. Generated image artifacts can use the
run's \`artifactTtlSeconds\`, from 60 seconds through one year.

## Retention modes

Retention is independent from the provider's own data controls.

| Mode | Durable run | Input/tool data | Session and trace | Typical use |
|---|:---:|---|:---:|---|
| \`none\` | No | Not stored | No | Stateless replacement for a direct API call |
| \`result\` | Yes | Redacted | No | Output metadata and audit status without conversation history |
| \`session\` | Yes | Full runtime record | Yes | Conversation, debugging, and observability |

\`\`\`yaml
retention:
  mode: result
  ttlSeconds: 86400
  artifactTtlSeconds: 3600
\`\`\`

A manifest can set the default. Callers may tighten it but cannot loosen it:
\`none\` is stricter than \`result\`, which is stricter than \`session\`.
\`ttlSeconds\` and \`artifactTtlSeconds\` must be integers from 60 through
31,536,000 seconds.

\`none\` is supported only for synchronous \`agents.run\` calls because an
asynchronous run needs a durable record for status, cancellation, and
reconnection. Use \`result\` with \`agents.start\` or \`runs.start\` when you
want the smallest durable record.

With \`none\` or \`result\`, the returned \`sessionId\` and \`traceId\` are
absent by design. Application code must treat them as optional.

## Self-hosted artifact storage

| \`ARTIFACT_STORE\` | Intended use |
|---|---|
| \`memory\` | Tests and ephemeral local development |
| \`filesystem\` | One worker with a persistent volume |
| \`s3\` | Production and multiple worker replicas |

S3 mode supports AWS S3 and compatible endpoints. Configure bucket lifecycle
rules as a deletion backstop; Agntz metadata and object expiry remain
tenant-scoped. See [Self-host in production](/docs/deploy/self-host-production)
for the complete environment reference.
`;
