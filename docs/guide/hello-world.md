# Hello World

A minimal walkthrough from zero to working agent.

## 1. Create a Project

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install agntz @ai-sdk/openai
```

Set your API key:
```bash
export OPENAI_API_KEY=sk-...
```

## 2. Define and Run an Agent

Create `index.ts`:

```typescript
import { createRunner, defineAgent } from "agntz";

const runner = createRunner();

runner.registerAgent(defineAgent({
  id: "poet",
  name: "Haiku Poet",
  systemPrompt: "You write haikus. Only respond with haikus (5-7-5 syllable format). No other text.",
  model: { provider: "openai", name: "gpt-5.4-mini" },
}));

const result = await runner.invoke("poet", "Write about TypeScript");
console.log(result.output);
console.log(`\nTokens: ${result.usage.totalTokens} | Time: ${result.duration}ms`);
```

Run it:
```bash
npx tsx index.ts
```

Output:
```
Types guard the code paths
Interfaces shape the world  
Compile-time peace reigns

Tokens: 87 | Time: 412ms
```

## 3. Add Persistence

```typescript
import { createRunner, defineAgent } from "agntz";
import { SqliteStore } from "@agntz/store-sqlite";

const runner = createRunner({
  store: new SqliteStore("./data.db"),
});

// Agent definition is now saved to the configured database
runner.registerAgent(defineAgent({
  id: "poet",
  name: "Haiku Poet",
  systemPrompt: "You write haikus. Only respond with haikus.",
  model: { provider: "openai", name: "gpt-5.4-mini" },
}));
```

## 4. Use the CLI

```bash
# Generate a YAML agent
npx @agntz/sdk create "Write haikus. Only respond with haikus." -o ./agents/poet.yaml

# Run the YAML locally
npx @agntz/sdk run ./agents/poet.yaml --input "Write about coffee"
```

## What's Next?

- Add [tools](/guide/tools) to give your agent capabilities
- Use [sessions](/guide/sessions) for multi-turn conversations
- Share state between agents with [context](/guide/context)
- Inspect behavior with [runs](/guide/runs) and [traces](/guide/traces)
