#!/usr/bin/env node
import "dotenv/config";
import { serve } from "@hono/node-server";
import { createWorkerAPI } from "./routes.js";
import { getStore } from "./store.js";

const port = Number(process.env.PORT ?? 4001);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

const internalSecret = process.env.WORKER_INTERNAL_SECRET;
if (!internalSecret) {
  console.error(
    "WORKER_INTERNAL_SECRET is required. The Next.js app uses this to authenticate to the worker."
  );
  process.exit(1);
}

const store = await getStore();

const app = createWorkerAPI({ store, internalSecret });

serve({
  fetch: app.fetch,
  port,
  hostname,
});

console.log(`agntz worker listening on http://${hostname}:${port}`);
console.log(`Store: ${process.env.STORE ?? "memory"}`);
