# Streaming

agntz supports streaming responses for real-time output.

## Basic Streaming

```typescript
const stream = await runner.invoke("writer", "Write a story", {
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}
```

## With Tool Calls

When the model makes tool calls during streaming, the stream pauses while tools execute, then continues with the model's next response.

## Stream Events

The stream yields chunks with different types:

```typescript
for await (const chunk of stream) {
  if (chunk.type === "text") {
    process.stdout.write(chunk.text);
  } else if (chunk.type === "tool-call") {
    console.log(`Calling tool: ${chunk.toolName}`);
  } else if (chunk.type === "tool-result") {
    console.log(`Tool result: ${JSON.stringify(chunk.result)}`);
  }
}
```
