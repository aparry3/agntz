#!/usr/bin/env node

/**
 * agent-runner CLI
 *
 * Commands:
 *   init     — Scaffold a new agent-runner project
 *   invoke   — Invoke an agent from the command line
 *   studio   — Launch the Studio UI (requires @agent-runner/studio)
 */

import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const HELP = `
agent-runner — TypeScript SDK for AI agents

Usage:
  agent-runner <command> [options]

Commands:
  init [-y]         Scaffold a new project (interactive, or -y for defaults)
  list              List all registered agents
  invoke <agentId>  Invoke an agent (requires agent-runner.config.ts)
  playground <id>   Interactive REPL for testing an agent
  eval <agentId>    Run eval suite for an agent
  studio            Launch the Studio UI

Options:
  -h, --help        Show help
  -v, --version     Show version

Eval Options:
  --json            Output results as JSON (one line per agent)
  --all             Run evals for all agents with eval configs
  --threshold <n>   Override pass threshold (0-1)

Examples:
  agent-runner init
  agent-runner list
  agent-runner invoke greeter "Hello!"
  agent-runner playground greeter
  agent-runner eval support --json
  agent-runner eval --all --threshold 0.8
  agent-runner studio
`.trim();

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    const pkg = await import("../package.json", { with: { type: "json" } }).catch(() => ({
      default: { version: "unknown" },
    }));
    console.log(`agent-runner v${pkg.default.version}`);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "list":
      await cmdList();
      break;
    case "invoke":
      await cmdInvoke(args.slice(1));
      break;
    case "eval":
      await cmdEval(args.slice(1));
      break;
    case "playground":
      await cmdPlayground(args.slice(1));
      break;
    case "studio":
      await cmdStudio();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// init — scaffold a new project (interactive)
// ═══════════════════════════════════════════════════════════════════

interface InitOptions {
  projectName: string;
  provider: string;
  model: string;
  envVar: string;
  template: string;
}

const PROVIDERS: Record<string, { models: string[]; envVar: string; displayName: string }> = {
  openai: {
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano", "o4-mini"],
    envVar: "OPENAI_API_KEY",
    displayName: "OpenAI",
  },
  anthropic: {
    models: ["claude-sonnet-4-20250514", "claude-haiku-4-20250414", "claude-opus-4-20250514"],
    envVar: "ANTHROPIC_API_KEY",
    displayName: "Anthropic",
  },
  google: {
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    displayName: "Google",
  },
  mistral: {
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    envVar: "MISTRAL_API_KEY",
    displayName: "Mistral",
  },
};

const TEMPLATES: Record<string, { name: string; description: string }> = {
  minimal: { name: "Minimal", description: "A simple greeter agent — the hello world" },
  chatbot: { name: "Chatbot", description: "Conversational agent with session memory" },
  tools: { name: "With Tools", description: "Agent with custom tools (Zod schemas)" },
  "multi-agent": { name: "Multi-Agent", description: "Multiple agents sharing context" },
};

async function cmdInit() {
  const cwd = process.cwd();
  const args = process.argv.slice(3);
  const isQuick = args.includes("--yes") || args.includes("-y");

  // Check if already initialized
  if (existsSync(join(cwd, "agent-runner.config.ts"))) {
    console.log("⚠️  agent-runner.config.ts already exists. Skipping.");
    process.exit(0);
  }

  console.log("\n  ⚡ agent-runner init\n");

  let options: InitOptions;

  if (isQuick) {
    // Quick mode: use defaults
    const dirName = cwd.split("/").pop() || "my-agent-project";
    options = {
      projectName: dirName,
      provider: "openai",
      model: "gpt-4o-mini",
      envVar: "OPENAI_API_KEY",
      template: "minimal",
    };
  } else {
    options = await promptInitOptions(cwd);
  }

  // Create the project scaffold
  await scaffoldProject(cwd, options);
}

async function promptInitOptions(cwd: string): Promise<InitOptions> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const dirName = cwd.split("/").pop() || "my-agent-project";

  try {
    // Project name
    const projectName = (await rl.question(`  Project name (${dirName}): `)).trim() || dirName;

    // Provider selection
    console.log("\n  Model providers:");
    const providerKeys = Object.keys(PROVIDERS);
    for (let i = 0; i < providerKeys.length; i++) {
      const key = providerKeys[i];
      console.log(`    ${i + 1}. ${PROVIDERS[key].displayName}`);
    }
    const providerChoice = (await rl.question("  Choose provider (1): ")).trim() || "1";
    const providerIdx = Math.max(0, Math.min(parseInt(providerChoice, 10) - 1, providerKeys.length - 1));
    const provider = providerKeys[providerIdx];
    const providerInfo = PROVIDERS[provider];

    // Model selection
    console.log(`\n  ${providerInfo.displayName} models:`);
    for (let i = 0; i < providerInfo.models.length; i++) {
      console.log(`    ${i + 1}. ${providerInfo.models[i]}`);
    }
    const modelChoice = (await rl.question("  Choose model (1): ")).trim() || "1";
    const modelIdx = Math.max(0, Math.min(parseInt(modelChoice, 10) - 1, providerInfo.models.length - 1));
    const model = providerInfo.models[modelIdx];

    // Template selection
    console.log("\n  Templates:");
    const templateKeys = Object.keys(TEMPLATES);
    for (let i = 0; i < templateKeys.length; i++) {
      const key = templateKeys[i];
      const t = TEMPLATES[key];
      console.log(`    ${i + 1}. ${t.name} — ${t.description}`);
    }
    const templateChoice = (await rl.question("  Choose template (1): ")).trim() || "1";
    const templateIdx = Math.max(0, Math.min(parseInt(templateChoice, 10) - 1, templateKeys.length - 1));
    const template = templateKeys[templateIdx];

    console.log("");

    return {
      projectName,
      provider,
      model,
      envVar: providerInfo.envVar,
      template,
    };
  } finally {
    rl.close();
  }
}

async function scaffoldProject(cwd: string, opts: InitOptions) {
  const { projectName, provider, model, envVar, template } = opts;

  // 1. package.json (if it doesn't exist)
  if (!existsSync(join(cwd, "package.json"))) {
    const pkg = {
      name: projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "tsx watch agent-runner.config.ts",
        invoke: "tsx --import ./agent-runner.config.ts node_modules/.bin/agent-runner invoke",
        studio: "agent-runner studio",
        eval: "agent-runner eval",
        playground: "agent-runner playground",
      },
      dependencies: {
        "@agent-runner/core": "^0.1.0",
        zod: "^3.23.0",
      },
      devDependencies: {
        "@agent-runner/studio": "^0.1.0",
        tsx: "^4.7.0",
        typescript: "^5.7.0",
      },
    };
    await writeFile(join(cwd, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    console.log("  ✅ package.json");
  } else {
    console.log("  ⏭️  package.json (already exists)");
  }

  // 2. tsconfig.json
  if (!existsSync(join(cwd, "tsconfig.json"))) {
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        esModuleInterop: true,
        strict: true,
        skipLibCheck: true,
        outDir: "./dist",
        rootDir: "./src",
        declaration: true,
        resolveJsonModule: true,
      },
      include: ["src", "*.ts"],
      exclude: ["node_modules", "dist"],
    };
    await writeFile(join(cwd, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");
    console.log("  ✅ tsconfig.json");
  } else {
    console.log("  ⏭️  tsconfig.json (already exists)");
  }

  // 3. .env.example
  const envContent = `# ${PROVIDERS[provider]?.displayName ?? provider} API Key
${envVar}=your-api-key-here
`;
  await writeFile(join(cwd, ".env.example"), envContent);
  console.log("  ✅ .env.example");

  // 4. .gitignore
  if (!existsSync(join(cwd, ".gitignore"))) {
    const gitignore = `node_modules/
dist/
data/sessions/
data/logs/
.env
*.tsbuildinfo
`;
    await writeFile(join(cwd, ".gitignore"), gitignore);
    console.log("  ✅ .gitignore");
  }

  // 5. data directory
  await mkdir(join(cwd, "data", "agents"), { recursive: true });
  console.log("  ✅ data/agents/");

  // 6. Generate config + agent files based on template
  const configContent = generateConfig(template, provider, model);
  await writeFile(join(cwd, "agent-runner.config.ts"), configContent);
  console.log("  ✅ agent-runner.config.ts");

  // 7. Generate source files for non-minimal templates
  if (template === "tools" || template === "multi-agent") {
    await mkdir(join(cwd, "src"), { recursive: true });
    const toolsContent = generateToolsFile(template, provider, model);
    await writeFile(join(cwd, "src", "tools.ts"), toolsContent);
    console.log("  ✅ src/tools.ts");
  }

  // 8. Save sample agent to JSON store
  const agentId = template === "multi-agent" ? "researcher" : template === "chatbot" ? "assistant" : "greeter";
  const sampleAgent = {
    id: agentId,
    name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
    systemPrompt: getSystemPrompt(template),
    model: { provider, name: model },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(
    join(cwd, "data", "agents", `${agentId}.json`),
    JSON.stringify(sampleAgent, null, 2) + "\n"
  );
  console.log(`  ✅ data/agents/${agentId}.json`);

  // Summary
  const agentIdForInvoke = agentId;
  console.log(`
  🚀 ${projectName} initialized!

  Next steps:

    1. Install dependencies:
       ${existsSync(join(cwd, "pnpm-lock.yaml")) ? "pnpm" : "npm"} install

    2. Set your API key:
       cp .env.example .env  # then add your ${envVar}

    3. Try it:
       npx agent-runner invoke ${agentIdForInvoke} "Hello!"

    4. Launch Studio:
       npx agent-runner studio

    5. Interactive playground:
       npx agent-runner playground ${agentIdForInvoke}
`);
}

function getSystemPrompt(template: string): string {
  switch (template) {
    case "chatbot":
      return "You are a helpful conversational assistant. Be concise but thorough. Remember context from earlier in the conversation.";
    case "tools":
      return "You are a helpful assistant with access to tools. Use them when appropriate to answer questions accurately.";
    case "multi-agent":
      return "You are a thorough researcher. Find comprehensive information about the topic. Be detailed and cite your reasoning.";
    default:
      return "You are a friendly greeter. Keep responses under 2 sentences.";
  }
}

function generateConfig(template: string, provider: string, model: string): string {
  switch (template) {
    case "chatbot":
      return `import { createRunner, defineAgent } from "@agent-runner/core";
import { JsonFileStore } from "@agent-runner/core";

const runner = createRunner({
  store: new JsonFileStore("./data"),
  defaults: {
    model: { provider: "${provider}", name: "${model}" },
  },
  session: {
    maxMessages: 50,
    strategy: "sliding",
  },
});

runner.registerAgent(defineAgent({
  id: "assistant",
  name: "Assistant",
  systemPrompt: \`You are a helpful conversational assistant.
Be concise but thorough. Remember context from earlier in the conversation.
If you don't know something, say so honestly.\`,
  model: { provider: "${provider}", name: "${model}" },
}));

export default runner;
`;

    case "tools":
      return `import { createRunner, defineAgent } from "@agent-runner/core";
import { JsonFileStore } from "@agent-runner/core";
import { getTime, calculate } from "./src/tools.js";

const runner = createRunner({
  store: new JsonFileStore("./data"),
  tools: [getTime, calculate],
  defaults: {
    model: { provider: "${provider}", name: "${model}" },
  },
});

runner.registerAgent(defineAgent({
  id: "assistant",
  name: "Assistant",
  systemPrompt: "You are a helpful assistant with access to tools. Use them when needed.",
  model: { provider: "${provider}", name: "${model}" },
  tools: [
    { type: "inline", name: "get_time" },
    { type: "inline", name: "calculate" },
  ],
}));

export default runner;
`;

    case "multi-agent":
      return `import { createRunner, defineAgent } from "@agent-runner/core";
import { JsonFileStore } from "@agent-runner/core";

const runner = createRunner({
  store: new JsonFileStore("./data"),
  defaults: {
    model: { provider: "${provider}", name: "${model}" },
  },
});

// Researcher: gathers information and writes to shared context
runner.registerAgent(defineAgent({
  id: "researcher",
  name: "Researcher",
  systemPrompt: \`You are a thorough researcher. Find comprehensive information
about the topic. Be detailed and cite your reasoning.\`,
  model: { provider: "${provider}", name: "${model}" },
  contextWrite: true,
}));

// Writer: reads shared context and produces polished output
runner.registerAgent(defineAgent({
  id: "writer",
  name: "Writer",
  systemPrompt: \`You are an expert writer. Use the research context provided
to write clear, engaging content. Don't make up facts — use what's in the context.\`,
  model: { provider: "${provider}", name: "${model}" },
}));

// Coordinator: can invoke both agents as tools
runner.registerAgent(defineAgent({
  id: "coordinator",
  name: "Coordinator",
  systemPrompt: \`You coordinate research and writing tasks.
First, use the researcher to gather info. Then use the writer to produce the final output.\`,
  model: { provider: "${provider}", name: "${model}" },
  tools: [
    { type: "agent", agentId: "researcher" },
    { type: "agent", agentId: "writer" },
  ],
}));

export default runner;
`;

    default: // minimal
      return `import { createRunner, defineAgent } from "@agent-runner/core";

const runner = createRunner({
  defaults: {
    model: { provider: "${provider}", name: "${model}" },
  },
});

runner.registerAgent(defineAgent({
  id: "greeter",
  name: "Greeter",
  systemPrompt: "You are a friendly greeter. Keep responses under 2 sentences.",
  model: { provider: "${provider}", name: "${model}" },
}));

export default runner;
`;
  }
}

function generateToolsFile(template: string, _provider: string, _model: string): string {
  return `import { defineTool } from "@agent-runner/core";
import { z } from "zod";

/**
 * Get the current time in a given timezone.
 */
export const getTime = defineTool({
  name: "get_time",
  description: "Get the current date and time, optionally in a specific timezone",
  input: z.object({
    timezone: z.string().optional().describe("IANA timezone (e.g. America/New_York). Defaults to UTC."),
  }),
  async execute(input) {
    const tz = input.timezone || "UTC";
    const now = new Date();
    return {
      timezone: tz,
      datetime: now.toLocaleString("en-US", { timeZone: tz }),
      iso: now.toISOString(),
    };
  },
});

/**
 * Evaluate a math expression safely.
 */
export const calculate = defineTool({
  name: "calculate",
  description: "Evaluate a mathematical expression and return the result",
  input: z.object({
    expression: z.string().describe("A mathematical expression (e.g. '2 + 3 * 4')"),
  }),
  async execute(input) {
    // Simple safe math evaluator (no eval!)
    const expr = input.expression.trim();

    // Only allow numbers, operators, parentheses, spaces, and decimal points
    if (!/^[\\d+\\-*/().\\s]+$/.test(expr)) {
      throw new Error(\`Invalid expression: \${expr}. Only numbers and +, -, *, /, (, ) are allowed.\`);
    }

    try {
      // Using Function constructor with restricted scope (safer than eval)
      const result = new Function(\`"use strict"; return (\${expr})\`)();
      if (typeof result !== "number" || !isFinite(result)) {
        throw new Error("Result is not a finite number");
      }
      return { expression: expr, result };
    } catch (e) {
      throw new Error(\`Failed to evaluate "\${expr}": \${e instanceof Error ? e.message : String(e)}\`);
    }
  },
});
`;
}

// ═══════════════════════════════════════════════════════════════════
// list — show all registered agents
// ═══════════════════════════════════════════════════════════════════

async function cmdList() {
  const configPath = resolve(process.cwd(), "agent-runner.config.ts");
  if (!existsSync(configPath)) {
    console.error("❌ No agent-runner.config.ts found. Run `agent-runner init` first.");
    process.exit(1);
  }

  try {
    const config = await import(configPath);
    const runner = config.default;

    // Try the store's listAgents first, then fall back to runner methods
    let agents: any[] = [];

    if (runner?.stores?.agentStore?.listAgents) {
      agents = await runner.stores.agentStore.listAgents();
    } else if (runner?.listAgents) {
      agents = await runner.listAgents();
    }

    if (agents.length === 0) {
      console.log("  No agents found. Define agents in agent-runner.config.ts");
      return;
    }

    console.log(`\n  📋 ${agents.length} agent${agents.length !== 1 ? "s" : ""}\n`);

    for (const agent of agents) {
      const model = agent.model
        ? `${agent.model.provider}/${agent.model.name}`
        : "(default)";
      const tools = agent.tools?.length
        ? ` · ${agent.tools.length} tool${agent.tools.length !== 1 ? "s" : ""}`
        : "";
      const ctx = agent.contextWrite ? " · writes context" : "";

      console.log(`  \x1b[1m${agent.id}\x1b[0m  ${agent.name || ""}`);
      console.log(`  \x1b[2m${model}${tools}${ctx}\x1b[0m`);
      if (agent.description) {
        console.log(`  \x1b[2m${agent.description}\x1b[0m`);
      }
      console.log("");
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// invoke — run an agent from CLI
// ═══════════════════════════════════════════════════════════════════

async function cmdInvoke(args: string[]) {
  if (args.length < 2) {
    console.error('Usage: agent-runner invoke <agentId> "<input>"');
    process.exit(1);
  }

  const agentId = args[0];
  const input = args.slice(1).join(" ");

  // Load the runner config
  const configPath = resolve(process.cwd(), "agent-runner.config.ts");
  if (!existsSync(configPath)) {
    console.error("❌ No agent-runner.config.ts found. Run `agent-runner init` first.");
    process.exit(1);
  }

  try {
    // Dynamic import of the config (requires tsx or similar for .ts files)
    const config = await import(configPath);
    const runner = config.default;

    if (!runner?.invoke) {
      console.error("❌ agent-runner.config.ts must export a Runner as default.");
      process.exit(1);
    }

    console.log(`⏳ Invoking agent "${agentId}"...\n`);

    const result = await runner.invoke(agentId, input);

    console.log(result.output);
    console.log(`\n---`);
    console.log(`Model: ${result.model}`);
    console.log(`Tokens: ${result.usage.totalTokens} (${result.usage.promptTokens}↑ ${result.usage.completionTokens}↓)`);
    console.log(`Duration: ${result.duration}ms`);

    if (result.toolCalls.length > 0) {
      console.log(`Tool calls: ${result.toolCalls.length}`);
      for (const tc of result.toolCalls) {
        console.log(`  • ${tc.name} (${tc.duration}ms)`);
      }
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// eval — run eval suite
// ═══════════════════════════════════════════════════════════════════

async function cmdEval(args: string[]) {
  // Parse flags
  const jsonMode = args.includes("--json");
  const allMode = args.includes("--all");
  const filteredArgs = args.filter((a) => a !== "--json" && a !== "--all");

  // Parse --threshold <value>
  let thresholdOverride: number | undefined;
  const thresholdIdx = filteredArgs.indexOf("--threshold");
  if (thresholdIdx !== -1) {
    thresholdOverride = parseFloat(filteredArgs[thresholdIdx + 1]);
    filteredArgs.splice(thresholdIdx, 2);
  }

  const agentId = filteredArgs[0];

  if (!agentId && !allMode) {
    console.error("Usage: agent-runner eval <agentId> [--json] [--threshold <0-1>] [--all]");
    process.exit(1);
  }

  const configPath = resolve(process.cwd(), "agent-runner.config.ts");
  if (!existsSync(configPath)) {
    console.error("❌ No agent-runner.config.ts found. Run `agent-runner init` first.");
    process.exit(1);
  }

  try {
    const config = await import(configPath);
    const runner = config.default;

    if (!runner?.eval) {
      console.error("❌ agent-runner.config.ts must export a Runner as default.");
      process.exit(1);
    }

    // Determine which agents to eval
    let agentIds: string[];
    if (allMode) {
      // Get all agents that have eval configs
      const agents = await runner.listAgents?.() ?? [];
      agentIds = agents
        .filter((a: any) => a.eval?.testCases?.length > 0)
        .map((a: any) => a.id);
      if (agentIds.length === 0) {
        console.error("❌ No agents with eval configs found.");
        process.exit(1);
      }
    } else {
      agentIds = [agentId];
    }

    let totalFailed = 0;
    const allResults: any[] = [];

    for (const id of agentIds) {
      if (!jsonMode) {
        console.log(`🧪 Running evals for "${id}"...\n`);
      }

      const result = await runner.eval(id, {
        onProgress: !jsonMode
          ? (completed: number, total: number, name: string) => {
              if (name !== "done") {
                console.log(`  [${completed + 1}/${total}] ${name}...`);
              }
            }
          : undefined,
      });

      // Apply threshold override
      if (thresholdOverride !== undefined) {
        for (const tc of result.testCases) {
          tc.passed = tc.score >= thresholdOverride;
        }
        result.summary.passed = result.testCases.filter((tc: any) => tc.passed).length;
        result.summary.failed = result.summary.total - result.summary.passed;
        result.summary.score =
          result.testCases.reduce((sum: number, tc: any) => sum + tc.score, 0) /
          result.summary.total;
      }

      allResults.push({ agentId: id, ...result });
      totalFailed += result.summary.failed;

      if (jsonMode) {
        // JSON output — one line per agent
        console.log(JSON.stringify({ agentId: id, ...result }));
      } else {
        // Human-readable output
        console.log("");
        for (const tc of result.testCases) {
          const icon = tc.passed ? "✅" : "❌";
          console.log(`${icon} ${tc.name} (score: ${(tc.score * 100).toFixed(0)}%)`);
          for (const a of tc.assertions) {
            const aIcon = a.passed ? "  ✓" : "  ✗";
            console.log(`${aIcon} [${a.type}] ${a.reason ?? ""}`);
          }
        }

        console.log(`\n─── Summary ───`);
        console.log(`Total:    ${result.summary.total}`);
        console.log(`Passed:   ${result.summary.passed}`);
        console.log(`Failed:   ${result.summary.failed}`);
        console.log(`Score:    ${(result.summary.score * 100).toFixed(1)}%`);
        console.log(`Duration: ${result.duration}ms`);

        if (agentIds.length > 1) {
          console.log("");
        }
      }
    }

    if (totalFailed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// playground — interactive REPL for testing an agent
// ═══════════════════════════════════════════════════════════════════

async function cmdPlayground(args: string[]) {
  if (args.length < 1) {
    console.error("Usage: agent-runner playground <agentId> [--session <id>] [--context <id>...]");
    process.exit(1);
  }

  const agentId = args[0];
  const filteredArgs = args.slice(1);

  // Parse optional --session flag
  let sessionId: string | undefined;
  const sessIdx = filteredArgs.indexOf("--session");
  if (sessIdx !== -1) {
    sessionId = filteredArgs[sessIdx + 1];
    filteredArgs.splice(sessIdx, 2);
  }

  // Parse optional --context flags (repeatable)
  const contextIds: string[] = [];
  let ctxIdx: number;
  while ((ctxIdx = filteredArgs.indexOf("--context")) !== -1) {
    contextIds.push(filteredArgs[ctxIdx + 1]);
    filteredArgs.splice(ctxIdx, 2);
  }

  // Generate a session ID if not provided (for conversational continuity)
  if (!sessionId) {
    sessionId = `playground_${Date.now()}`;
  }

  const configPath = resolve(process.cwd(), "agent-runner.config.ts");
  if (!existsSync(configPath)) {
    console.error("❌ No agent-runner.config.ts found. Run `agent-runner init` first.");
    process.exit(1);
  }

  let runner: any;
  try {
    const config = await import(configPath);
    runner = config.default;
    if (!runner?.invoke) {
      console.error("❌ agent-runner.config.ts must export a Runner as default.");
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`\n  ⚡ agent-runner playground`);
  console.log(`  Agent: ${agentId}`);
  console.log(`  Session: ${sessionId}`);
  if (contextIds.length > 0) {
    console.log(`  Context: ${contextIds.join(", ")}`);
  }
  console.log(`  Type .exit or Ctrl+C to quit\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let turnCount = 0;

  try {
    while (true) {
      const input = await rl.question("\x1b[36myou ›\x1b[0m ");

      if (!input.trim()) continue;
      if (input.trim() === ".exit" || input.trim() === ".quit") break;

      // Special commands
      if (input.trim() === ".session") {
        console.log(`  Session: ${sessionId}`);
        continue;
      }
      if (input.trim() === ".new") {
        sessionId = `playground_${Date.now()}`;
        turnCount = 0;
        console.log(`  ✨ New session: ${sessionId}\n`);
        continue;
      }
      if (input.trim() === ".help") {
        console.log(`  .exit     Quit the playground`);
        console.log(`  .new      Start a new session`);
        console.log(`  .session  Show current session ID`);
        console.log(`  .help     Show this help\n`);
        continue;
      }

      try {
        const start = Date.now();
        const result = await runner.invoke(agentId, input.trim(), {
          sessionId,
          contextIds: contextIds.length > 0 ? contextIds : undefined,
        });
        const elapsed = Date.now() - start;
        turnCount++;

        console.log(`\n\x1b[33m${agentId} ›\x1b[0m ${result.output}`);

        // Show metadata in dim text
        const parts = [
          `${result.usage.totalTokens} tokens`,
          `${elapsed}ms`,
        ];
        if (result.toolCalls.length > 0) {
          parts.push(`${result.toolCalls.length} tool call${result.toolCalls.length > 1 ? "s" : ""}`);
        }
        console.log(`\x1b[2m  ${parts.join(" · ")}\x1b[0m\n`);
      } catch (error) {
        console.error(`\x1b[31m  Error: ${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
      }
    }
  } finally {
    rl.close();
    console.log(`\n  👋 ${turnCount} turn${turnCount !== 1 ? "s" : ""} in session ${sessionId}\n`);

    // Graceful shutdown
    if (runner.shutdown) {
      await runner.shutdown();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// studio — launch the Studio UI
// ═══════════════════════════════════════════════════════════════════

async function cmdStudio() {
  const configPath = resolve(process.cwd(), "agent-runner.config.ts");

  // Try to load the runner from config
  let runner: any;
  try {
    if (existsSync(configPath)) {
      const config = await import(configPath);
      runner = config.default;
    }
  } catch {
    // Config load failed — will create a default runner
  }

  if (!runner) {
    // Create a minimal runner with the default stores
    const { createRunner } = await import("./runner.js");
    runner = createRunner({
      defaults: { model: { provider: "openai", name: "gpt-4o-mini" } },
    });
    console.log("⚠️  No agent-runner.config.ts found. Using default runner.\n");
  }

  // Try to import the studio package
  try {
    const studioModule = await import(/* @vite-ignore */ "@agent-runner/studio" as string)
      .catch(() => null);
    if (!studioModule) throw new Error("Cannot find @agent-runner/studio");
    const { createStudio } = studioModule;
    const port = parseInt(process.env.PORT || "4000", 10);

    await createStudio(runner, {
      port,
      onReady: (url: string) => {
        console.log(`\n  ⚡ agent-runner Studio`);
        console.log(`  ➜ ${url}\n`);
      },
    });
  } catch (err) {
    if (String(err).includes("Cannot find")) {
      console.error("❌ @agent-runner/studio is not installed.");
      console.error("   Install it: pnpm add -D @agent-runner/studio");
    } else {
      console.error(`❌ Failed to start Studio: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
