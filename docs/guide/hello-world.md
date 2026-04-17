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
import { createRunner, defineAgent, JsonFileStore } from "agntz";

const runner = createRunner({
  store: new JsonFileStore("./data"),
});

// Agent definition is now saved to ./data/agents/poet.json
runner.registerAgent(defineAgent({
  id: "poet",
  name: "Haiku Poet",
  systemPrompt: "You write haikus. Only respond with haikus.",
  model: { provider: "openai", name: "gpt-5.4-mini" },
}));
```

## 4. Use the CLI

```bash
# Initialize a project with config file
npx agntz init

# Invoke an agent
npx agntz invoke poet "Write about coffee"

# Launch the Studio
npx agntz studio
```

## What's Next?

- Add [tools](/guide/tools) to give your agent capabilities
- Use [sessions](/guide/sessions) for multi-turn conversations
- Share state between agents with [context](/guide/context)
- Test behavior with [evals](/guide/evals)
