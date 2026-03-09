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
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const HELP = `
agent-runner — TypeScript SDK for AI agents

Usage:
  agent-runner <command> [options]

Commands:
  init              Scaffold a new agent-runner project
  invoke <agentId>  Invoke an agent (requires agent-runner.config.ts)
  eval <agentId>    Run eval suite for an agent
  studio            Launch the Studio UI

Options:
  -h, --help        Show help
  -v, --version     Show version

Examples:
  agent-runner init
  agent-runner invoke greeter "Hello!"
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
    case "invoke":
      await cmdInvoke(args.slice(1));
      break;
    case "eval":
      await cmdEval(args.slice(1));
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
// init — scaffold a new project
// ═══════════════════════════════════════════════════════════════════

async function cmdInit() {
  const cwd = process.cwd();

  // Check if already initialized
  if (existsSync(join(cwd, "agent-runner.config.ts"))) {
    console.log("⚠️  agent-runner.config.ts already exists. Skipping.");
    process.exit(0);
  }

  // Create config file
  const configContent = `import { createRunner, defineAgent } from "agent-runner";

// Create your runner
const runner = createRunner({
  defaults: {
    model: { provider: "openai", name: "gpt-4o-mini" },
  },
});

// Define your first agent
runner.registerAgent(defineAgent({
  id: "greeter",
  name: "Greeter",
  systemPrompt: "You are a friendly greeter. Keep responses under 2 sentences.",
  model: { provider: "openai", name: "gpt-4o-mini" },
}));

export default runner;
`;

  await writeFile(join(cwd, "agent-runner.config.ts"), configContent);
  console.log("✅ Created agent-runner.config.ts");

  // Create data directory
  await mkdir(join(cwd, "data"), { recursive: true });
  console.log("✅ Created data/ directory");

  // Create agents directory with a sample
  await mkdir(join(cwd, "data", "agents"), { recursive: true });

  const sampleAgent = {
    id: "greeter",
    name: "Greeter",
    systemPrompt: "You are a friendly greeter. Keep responses under 2 sentences.",
    model: { provider: "openai", name: "gpt-4o-mini" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeFile(
    join(cwd, "data", "agents", "greeter.json"),
    JSON.stringify(sampleAgent, null, 2)
  );
  console.log("✅ Created data/agents/greeter.json");

  console.log(`
🚀 agent-runner initialized!

Next steps:
  1. Set your API key:  export OPENAI_API_KEY=sk-...
  2. Edit agent-runner.config.ts to customize your agents
  3. Invoke:  npx agent-runner invoke greeter "Hello!"
`);
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
  if (args.length < 1) {
    console.error("Usage: agent-runner eval <agentId>");
    process.exit(1);
  }

  const agentId = args[0];

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

    console.log(`🧪 Running evals for "${agentId}"...\n`);

    const result = await runner.eval(agentId, {
      onProgress: (completed: number, total: number, name: string) => {
        if (name !== "done") {
          console.log(`  [${completed + 1}/${total}] ${name}...`);
        }
      },
    });

    // Print results
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

    if (result.summary.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// studio — launch the Studio UI
// ═══════════════════════════════════════════════════════════════════

async function cmdStudio() {
  console.log("🎨 Studio is coming in Phase 3!");
  console.log("   Install @agent-runner/studio when it's available.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
