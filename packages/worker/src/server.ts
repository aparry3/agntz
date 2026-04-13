#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { createRunner } from "@agent-runner/core";
import { createWorkerAPI } from "./routes.js";
import { readFileTool } from "./tools/read-file.js";
import { validateManifestTool } from "./tools/validate-manifest.js";
import { seedBuiltInAgents } from "./seed.js";

const port = Number(process.env.PORT ?? 4001);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

const runner = createRunner({
  tools: [readFileTool, validateManifestTool],
  defaults: {
    model: {
      provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
      name: process.env.DEFAULT_MODEL_NAME ?? "gpt-4o",
    },
  },
});

// Seed built-in agents
await seedBuiltInAgents(runner);

const app = createWorkerAPI({ runner });

serve({
  fetch: app.fetch,
  port,
  hostname,
});

console.log(`Agent Runner Worker listening on http://${hostname}:${port}`);
