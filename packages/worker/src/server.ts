#!/usr/bin/env node
import "dotenv/config";
import { serve } from "@hono/node-server";
import {
	describeResourceProviders,
	getMemrez,
	getResourceProviders,
} from "./resources.js";
import { createWorkerAPI, runCurationSweep } from "./routes.js";
import { getStore } from "./store.js";

const port = Number(process.env.PORT ?? 4001);
const hostname = process.env.HOST ?? "0.0.0.0";

const internalSecret = process.env.WORKER_INTERNAL_SECRET;
if (!internalSecret) {
	console.error(
		"WORKER_INTERNAL_SECRET is required. The Next.js app uses this to authenticate to the worker.",
	);
	process.exit(1);
}

const store = await getStore();
const resources = getResourceProviders();
const memrez = getMemrez();

const app = createWorkerAPI({
	store,
	internalSecret,
	resources,
	memrez: memrez ?? undefined,
});

serve({
	fetch: app.fetch,
	port,
	hostname,
});

console.log(`agntz worker listening on http://${hostname}:${port}`);
console.log(`Store: ${process.env.STORE ?? "memory"}`);
console.log(`Resources: ${describeResourceProviders(resources)}`);

// Periodic memory curation. Off unless MEMREZ_CURATE_INTERVAL is set (e.g.
// "30m", "1h", "900s", or raw milliseconds). Each tick sweeps every dirty
// (scope, topic) pair through the curator — same work as POST /memory/curate.
const curateIntervalMs = parseInterval(process.env.MEMREZ_CURATE_INTERVAL);
if (curateIntervalMs && memrez) {
	console.log(`Memory curation sweep every ${curateIntervalMs}ms`);
	const timer = setInterval(async () => {
		try {
			const result = await runCurationSweep(memrez);
			if (!result.curateEnabled) {
				console.warn(
					"[memrez] curation sweep skipped: no curate-capable reasoner (MEMREZ_REASONER=deterministic?)",
				);
				return;
			}
			const failed = result.scopes.filter((scope) => scope.error);
			const failedSuffix = failed.length > 0 ? `, ${failed.length} failed` : "";
			console.log(
				`[memrez] curation sweep: ${result.dirty} dirty topics across ${result.scopes.length} scopes${failedSuffix}`,
			);
			for (const failure of failed) {
				console.error(
					`[memrez] curate failed scope=${failure.scope}: ${failure.error}`,
				);
			}
		} catch (err) {
			console.error(
				`[memrez] curation sweep failed: ${(err as Error).message}`,
			);
		}
	}, curateIntervalMs);
	timer.unref();
}

function parseInterval(raw: string | undefined): number | null {
	if (!raw) return null;
	const match = raw.trim().match(/^(\d+)(ms|s|m|h)?$/);
	if (!match) {
		console.error(
			`Invalid MEMREZ_CURATE_INTERVAL "${raw}" — expected e.g. 900000, 900s, 30m, 1h. Curation sweep disabled.`,
		);
		return null;
	}
	const value = Number(match[1]);
	const unit = match[2] ?? "ms";
	const ms =
		unit === "h"
			? value * 3_600_000
			: unit === "m"
				? value * 60_000
				: unit === "s"
					? value * 1000
					: value;
	// Floor at 1 minute so a typo can't hot-loop LLM curation.
	return Math.max(ms, 60_000);
}
