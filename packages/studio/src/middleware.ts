// ═══════════════════════════════════════════════════════════════════════
// Studio middleware exports for embedding in existing apps
// ═══════════════════════════════════════════════════════════════════════

import type { Runner } from "@agent-runner/core";
import { createStudioAPI } from "./server/api.js";

/**
 * Create a Hono app that can be mounted as middleware in an existing app.
 *
 * @example
 * ```ts
 * // Hono
 * import { Hono } from "hono";
 * import { studioMiddleware } from "@agent-runner/studio/middleware";
 *
 * const app = new Hono();
 * app.route("/studio", studioMiddleware(runner));
 *
 * // Express (via @hono/node-server)
 * import express from "express";
 * const expressApp = express();
 * // Mount via Hono's fetch adapter
 * ```
 */
export function studioMiddleware(runner: Runner) {
  return createStudioAPI(runner);
}
