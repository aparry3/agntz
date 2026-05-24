export default `# Sessions

A **session** persists conversation history between an agent and its caller. Pass the same session id across runs and the runtime auto-loads prior messages, appends the new exchange, and forwards the transcript to the model.

## Calling with a session id

\`\`\`ts {group=sessions-run}
await client.agents.run({ agentId: "support", input: "Hi", sessionId: "user-42" });
await client.agents.run({ agentId: "support", input: "follow-up", sessionId: "user-42" });
\`\`\`

\`\`\`python {group=sessions-run}
client.agents.run(agent_id="support", input="Hi", session_id="user-42")
client.agents.run(agent_id="support", input="follow-up", session_id="user-42")
\`\`\`

The two calls share history. The second call sees the first turn in the model's context window automatically — no manual history management required.

Sessions are agent-scoped: \`(agentId, sessionId)\` in TypeScript and \`(agent_id, session_id)\` in Python. Two agents with the same session id keep independent histories.

## Storage

### Embedded

Sessions live **in memory** by default. They survive within the process but are lost on restart.

\`\`\`ts {group=sessions-store}
import { agntz } from "@agntz/sdk";
import { sqliteStore } from "@agntz/sdk/sqlite";

const client = await agntz({
  agents: "./agents",
  store: sqliteStore("./agntz.db"),
});
\`\`\`

\`\`\`python {group=sessions-store}
from agntz import LiteLLMModelProvider, SQLiteStore, agntz

client = agntz(
    agents="./agents",
    store=SQLiteStore("./agntz.db"),
    model_provider=LiteLLMModelProvider(),
)
\`\`\`

The same store also backs runs and traces, so durability extends across the local SDK surface.

### Hosted

Sessions are stored in Postgres and scoped to the authenticated user. They survive restarts, redeploys, and SDK reconnects. No configuration needed — pass any session id string you want.

## Reading local session messages

\`\`\`ts {group=sessions-read}
const store = sqliteStore("./agntz.db");
const client = await agntz({ agents: "./agents", store });

const messages = await store.getMessages("user-42");
\`\`\`

\`\`\`python {group=sessions-read}
messages = client.sessions.get_messages("user-42")
for message in messages:
    print(message.role, message.content)
\`\`\`

## What's in a session

A session record holds:

- **Messages** — every user input and assistant output for this session.
- **Reply events** — intermediate messages emitted via the \`reply\` tool where supported.
- **Last run reference** — hosted storage can use the most recent run id for fast trace lookup from a session.

Sessions do not persist agent state such as \`{{stepId.property}}\`. State is per-run and discarded once the run ends; messages are the durable surface.

## Patterns

- **One session per user.** Pass the user's stable id and let the runtime track every interaction.
- **One session per topic.** Mint ids such as \`user-42:billing\` so the same user can have multiple parallel conversations.
- **Anonymous trials.** Generate a session id client-side and pass it through until the user signs up; then re-key sessions to the new user id at signup time.
`;
