# Sessions

Sessions provide conversational continuity across multiple invocations. When you pass a `sessionId`, the runner automatically loads and appends to the message history.

## Basic Usage

```typescript
// First message — creates session
await runner.invoke("assistant", "My name is Aaron", {
  sessionId: "chat-1",
});

// Second message — history is loaded automatically
const result = await runner.invoke("assistant", "What's my name?", {
  sessionId: "chat-1",
});
// → "Your name is Aaron!"
```

## Session Trimming

Sessions grow over time. agntz provides three strategies to manage history size:

### Sliding Window (Default)

Keeps the most recent messages, drops older ones:

```typescript
const runner = createRunner({
  session: {
    maxMessages: 50,
    strategy: "sliding",
  },
});
```

### Summary Strategy

Uses an LLM to summarize older messages, preserving recent context:

```typescript
const runner = createRunner({
  session: {
    maxMessages: 50,
    strategy: "summary",
    // keepRecent: 30,  // Keep 60% of maxMessages by default
  },
});
```

When the message count exceeds `maxMessages`, the runner:
1. Takes the oldest messages (beyond `keepRecent`)
2. Generates a summary using the agent's model
3. Replaces old messages with a `[Conversation Summary]` system message
4. Keeps recent messages intact

### No Trimming

Returns all messages without any trimming:

```typescript
const runner = createRunner({
  session: {
    strategy: "none",
  },
});
```

## Storage

Sessions are stored via the `SessionStore` interface:

```typescript
// In-memory (default) — lost on restart
const runner = createRunner();

// JSON files — persisted
const runner = createRunner({
  store: new JsonFileStore("./data"),
});

// SQLite — production-ready
import { SqliteStore } from "@agntz/store-sqlite";
const runner = createRunner({
  store: new SqliteStore("./data.db"),
});
```

## Session API

```typescript
// List sessions
const sessions = await runner.sessionStore.listSessions();

// Get messages for a session
const messages = await runner.sessionStore.getMessages("chat-1");

// Delete a session
await runner.sessionStore.deleteSession("chat-1");
```
