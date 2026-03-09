/**
 * agent-runner — Evals Example
 *
 * Demonstrates the built-in eval system for testing agent behavior.
 *
 * Usage:
 *   Set OPENAI_API_KEY in your environment, then:
 *   npx tsx examples/with-eval/index.ts
 *
 *   Or via CLI:
 *   agent-runner eval classifier
 */

import { createRunner, defineAgent } from "agent-runner";

const runner = createRunner();

// Agent with built-in eval config
runner.registerAgent(
  defineAgent({
    id: "classifier",
    name: "Sentiment Classifier",
    systemPrompt: `You are a sentiment classifier. Given a text, respond with exactly one word:
"positive", "negative", or "neutral". Nothing else.`,
    model: { provider: "openai", name: "gpt-4o-mini" },
    eval: {
      testCases: [
        {
          name: "happy review",
          input: "This product is amazing! Best purchase I've ever made.",
          assertions: [
            { type: "contains", value: "positive" },
          ],
        },
        {
          name: "angry review",
          input: "Terrible quality. Broke after one day. Want my money back.",
          assertions: [
            { type: "contains", value: "negative" },
          ],
        },
        {
          name: "neutral review",
          input: "The product arrived on time. It works as described.",
          assertions: [
            { type: "regex", value: "^(neutral|positive)$" },
          ],
        },
        {
          name: "mixed review",
          input: "Great features but the price is way too high.",
          assertions: [
            { type: "regex", value: "^(positive|negative|neutral)$" },
          ],
        },
        {
          name: "sarcastic review",
          input: "Oh wonderful, another product that doesn't work. Just what I needed.",
          assertions: [
            { type: "contains", value: "negative" },
          ],
        },
      ],
      passThreshold: 0.8, // 80% of test cases must pass
    },
  })
);

console.log("🧪 Running evals for 'classifier' agent\n");

const result = await runner.eval("classifier");

console.log(`📊 Results: ${result.summary.passed}/${result.summary.total} passed (score: ${(result.summary.score * 100).toFixed(0)}%)\n`);

for (const tc of result.testCases) {
  const icon = tc.passed ? "✅" : "❌";
  console.log(`${icon} ${tc.name}`);
  console.log(`   Input: "${tc.input.substring(0, 60)}..."`);
  console.log(`   Output: "${tc.output}"`);
  for (const a of tc.assertions) {
    console.log(`   ${a.passed ? "✓" : "✗"} ${a.type}: ${a.reason ?? ""}`);
  }
}

const passed = result.summary.score >= 0.8;
console.log(`\n${passed ? "✅ PASS" : "❌ FAIL"} — threshold: 80%, actual: ${(result.summary.score * 100).toFixed(0)}%`);

await runner.shutdown();
process.exit(passed ? 0 : 1);
