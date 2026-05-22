export default `# Sessions

A **session** persists the conversation history between an agent and its caller. Pass the same \`sessionId\` across runs and the runtime auto-loads prior messages, appends the new exchange, and forwards the full transcript to the model.

## Calling with a sessionId

\`\`\`ts
await client.agents.run({ agentId: "support", input: "Hi",       sessionId: "user-42" });
await client.agents.run({ agentId: "support", input: "follow-up", sessionId: "user-42" });
\`\`\`

The two calls share state. The second call sees the first turn in the model's context window automatically — no manual history management required.

Sessions are agent-scoped: \`(agentId, sessionId)\` is the key. Two agents with the same \`sessionId\` keep independent histories.

## Storage

### Embedded (\`@agntz/sdk\`)

Sessions live **in memory** by default. They survive within the process but are lost on restart.

For persistence, install \`@agntz/store-sqlite\` and pass the sqlite store:

\`\`\`ts
import { agntz } from "@agntz/sdk";
import { sqliteStore } from "@agntz/sdk/sqlite";

const client = await agntz({
  agents: "./agents",
  store: sqliteStore("./agntz.db"),
});
\`\`\`

The same store also backs \`runs.list\` and \`traces.get\`, so durability extends across the entire SDK surface.

### Hosted (\`agntz.co\` / self-hosted worker)

Sessions are stored in Postgres and scoped to the authenticated user. They survive restarts, redeploys, and SDK reconnects. No configuration needed — pass any \`sessionId\` string you want.

## What's in a session

A session record holds:

- **Messages** — every user input and assistant output for this \`(agentId, sessionId)\`.
- **Reply events** — intermediate messages emitted via the \`reply\` tool (see [Skills, spawnable, reply](/docs/schema/skills-spawnable-reply#reply-llm-kind)).
- **Last run reference** — the most recent run id, for fast trace lookup from a session.

Sessions don't persist agent state (\`{{stepId.property}}\`). State is per-run and discarded once the run ends; messages are the durable surface.

## Patterns

- **One session per user.** Pass \`sessionId: user.id\` and let the runtime track every interaction.
- **One session per topic.** Mint \`sessionId: \\\`\${user.id}:\${topicId}\\\`\` so the same user can have multiple parallel conversations.
- **Anonymous trials.** Generate a session id client-side (\`crypto.randomUUID()\`) and pass it through until the user signs up; then re-key sessions to the new user id at signup time.
`;
