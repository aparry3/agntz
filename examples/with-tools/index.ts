/**
 * agent-runner — Tools Example
 *
 * Demonstrates inline tools with Zod schemas and tool execution context.
 *
 * Usage:
 *   Set OPENAI_API_KEY in your environment, then:
 *   npx tsx examples/with-tools/index.ts
 */

import { createRunner, defineAgent, defineTool } from "agent-runner";
import { z } from "zod";

// Define tools with Zod schemas — auto-converted to JSON Schema for the model
const getWeather = defineTool({
  name: "get_weather",
  description: "Get current weather for a city",
  input: z.object({
    city: z.string().describe("City name"),
    unit: z.enum(["celsius", "fahrenheit"]).default("fahrenheit"),
  }),
  async execute(input) {
    // In a real app, this would call a weather API
    const temps: Record<string, number> = {
      "new york": 72,
      london: 59,
      tokyo: 68,
      sydney: 77,
    };
    const temp = temps[input.city.toLowerCase()] ?? 65;
    return {
      city: input.city,
      temperature: input.unit === "celsius" ? Math.round((temp - 32) * 5 / 9) : temp,
      unit: input.unit,
      condition: "partly cloudy",
    };
  },
});

const searchRestaurants = defineTool({
  name: "search_restaurants",
  description: "Search for restaurants near a location",
  input: z.object({
    location: z.string(),
    cuisine: z.string().optional(),
    priceRange: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
  }),
  async execute(input) {
    return {
      results: [
        { name: "The Local Kitchen", cuisine: input.cuisine ?? "American", price: "$$", rating: 4.5 },
        { name: "Pasta Palace", cuisine: "Italian", price: "$$", rating: 4.2 },
        { name: "Sakura", cuisine: "Japanese", price: "$$$", rating: 4.8 },
      ],
    };
  },
});

const runner = createRunner({
  tools: [getWeather, searchRestaurants],
});

runner.registerAgent(
  defineAgent({
    id: "travel-assistant",
    name: "Travel Assistant",
    systemPrompt: `You are a helpful travel assistant. Use your tools to get weather and restaurant info.
Keep responses concise and friendly.`,
    model: { provider: "openai", name: "gpt-4o-mini" },
    tools: [
      { type: "inline", name: "get_weather" },
      { type: "inline", name: "search_restaurants" },
    ],
  })
);

const result = await runner.invoke(
  "travel-assistant",
  "I'm visiting New York this weekend. What's the weather like, and can you recommend some good Italian restaurants?"
);

console.log(result.output);
console.log(`\n📊 ${result.usage.totalTokens} tokens | ${result.duration}ms`);
console.log(`🔧 Tool calls: ${result.toolCalls.map((tc) => tc.name).join(", ")}`);

await runner.shutdown();
