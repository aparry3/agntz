# Evals & Testing

agntz includes a built-in evaluation system for testing agent behavior. Define
test cases and run them from code; the current public CLI does not expose eval
execution.

## Defining Test Cases

Add an `eval` config to your agent definition:

```typescript
defineAgent({
  id: "classifier",
  name: "Sentiment Classifier",
  systemPrompt: "Classify sentiment as positive, negative, or neutral.",
  model: { provider: "openai", name: "gpt-5.4-mini" },
  eval: {
    testCases: [
      {
        name: "positive sentiment",
        input: "I absolutely love this product!",
        assertions: [
          { type: "contains", value: "positive" },
        ],
      },
      {
        name: "negative sentiment",
        input: "Terrible experience, would not recommend.",
        assertions: [
          { type: "contains", value: "negative" },
          { type: "not-contains", value: "positive" },
        ],
      },
    ],
  },
});
```

## Assertion Types

| Type | Description | Value |
|------|-------------|-------|
| `contains` | Output contains the string | `string` |
| `not-contains` | Output does not contain the string | `string` |
| `regex` | Output matches regex pattern | `string` (regex) |
| `json-schema` | Output validates against JSON Schema | `object` (schema) |
| `llm-rubric` | LLM judges output against a rubric | `string` (rubric) |
| `semantic-similar` | Output is semantically similar | `string` (reference) |
| `custom` | Custom assertion function | Plugin name |

### Weighted Assertions

```typescript
assertions: [
  { type: "contains", value: "positive", weight: 2 },  // Counts double
  { type: "not-contains", value: "error", weight: 1 },
]
```

### LLM-as-Judge

```typescript
eval: {
  rubric: "The response should be helpful, concise, and accurate.",
  evalModel: "openai:gpt-5.4",  // Model for judging
  testCases: [
    {
      input: "How do I reset my password?",
      assertions: [
        {
          type: "llm-rubric",
          value: "Response provides clear step-by-step instructions",
        },
      ],
    },
  ],
}
```

## Running Evals

### Programmatic

```typescript
const result = await runner.eval("classifier");
console.log(result.summary);
// → { total: 2, passed: 2, failed: 0, score: 1.0 }
```

### Current CLI support

The current public CLI focuses on creating YAML, running agents, and hosted run
management. Run evals programmatically in this package until eval execution is
exposed through the CLI again.

## Custom Assertion Plugins

```typescript
const runner = createRunner({
  evalPlugins: {
    "word-count": (output, value) => {
      const count = output.split(/\s+/).length;
      const target = parseInt(value as string);
      return {
        passed: count <= target,
        score: Math.min(1, target / count),
        reason: `Word count: ${count}, target: ≤${target}`,
      };
    },
  },
});
```

Use in assertions:
```typescript
assertions: [
  { type: "custom", value: "word-count:100" },
]
```

## Pass Threshold

Set a minimum score for the eval suite:

```typescript
eval: {
  passThreshold: 0.8,  // 80% of assertions must pass
  testCases: [...],
}
```
