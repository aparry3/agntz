/**
 * agent-runner — Multi-Agent Example
 *
 * Demonstrates context sharing between agents and agent-as-tool chains.
 * A researcher finds information, writes to shared context, then a writer
 * creates content from that context.
 *
 * Usage:
 *   Set OPENAI_API_KEY in your environment, then:
 *   npx tsx examples/multi-agent/index.ts
 */

import { createRunner, defineAgent, defineTool } from "agent-runner";
import { z } from "zod";

// A simple search tool for the researcher
const webSearch = defineTool({
  name: "web_search",
  description: "Search the web for information",
  input: z.object({
    query: z.string().describe("Search query"),
  }),
  async execute(input) {
    // Mock search results
    return {
      results: [
        {
          title: "Model Context Protocol — Anthropic",
          snippet: "MCP is an open standard for connecting AI models to data sources and tools.",
        },
        {
          title: "MCP SDK on GitHub",
          snippet: "Official TypeScript and Python SDKs for building MCP servers and clients.",
        },
        {
          title: "Building with MCP — Developer Guide",
          snippet: "MCP supports stdio and HTTP transports, enabling both local and remote tool servers.",
        },
      ],
    };
  },
});

const runner = createRunner({
  tools: [webSearch],
});

// Researcher agent — writes findings to shared context
runner.registerAgent(
  defineAgent({
    id: "researcher",
    name: "Researcher",
    systemPrompt: `You are a thorough researcher. Search for information and synthesize your findings
into a clear, structured summary. Focus on key facts, implications, and connections.`,
    model: { provider: "openai", name: "gpt-4o" },
    tools: [{ type: "inline", name: "web_search" }],
    contextWrite: true, // Output auto-writes to context
  })
);

// Writer agent — reads context and creates content
runner.registerAgent(
  defineAgent({
    id: "writer",
    name: "Technical Writer",
    systemPrompt: `You are a skilled technical writer. Use the research context provided to write
clear, engaging content. Cite findings from the research. Write for a developer audience.`,
    model: { provider: "openai", name: "gpt-4o" },
  })
);

// Editor agent — uses writer as a tool for revisions
runner.registerAgent(
  defineAgent({
    id: "editor",
    name: "Editor",
    systemPrompt: `You are a senior editor. Review and improve written content.
You can invoke the writer agent to request revisions.`,
    model: { provider: "openai", name: "gpt-4o" },
    tools: [
      { type: "agent", agentId: "writer" }, // Writer as a tool!
    ],
  })
);

console.log("🔬 Multi-Agent Pipeline\n");
console.log("═".repeat(50));

// Step 1: Researcher gathers info and writes to shared context
console.log("\n📖 Step 1: Researcher gathering information...");
const research = await runner.invoke("researcher", "Research the Model Context Protocol (MCP)", {
  contextIds: ["article-mcp"],
});
console.log(`   ✅ Research complete (${research.usage.totalTokens} tokens)`);
console.log(`   📄 Output: ${research.output.substring(0, 200)}...`);

// Step 2: Writer creates an article from the same context
console.log("\n✍️  Step 2: Writer creating article from research...");
const article = await runner.invoke(
  "writer",
  "Write a short blog post about MCP based on the research",
  { contextIds: ["article-mcp"] }
);
console.log(`   ✅ Article written (${article.usage.totalTokens} tokens)`);
console.log(`   📄 Output: ${article.output.substring(0, 200)}...`);

// Step 3: Check what's in the shared context
const contextEntries = await runner.context.get("article-mcp");
console.log(`\n📦 Shared context "article-mcp" has ${contextEntries.length} entries`);

console.log("\n" + "═".repeat(50));
console.log("✅ Done!");

await runner.shutdown();
