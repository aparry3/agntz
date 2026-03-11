import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Runner } from "@agent-runner/core";
import { createStudioAPI } from "./api.js";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface StudioOptions {
  /** Port to listen on (default: 4000) */
  port?: number;
  /** Hostname to bind to (default: "localhost") */
  hostname?: string;
  /** Callback when the server starts */
  onReady?: (url: string) => void;
}

/**
 * Create and start a standalone Studio server.
 *
 * @example
 * ```ts
 * import { createRunner } from "@agent-runner/core";
 * import { createStudio } from "@agent-runner/studio";
 *
 * const runner = createRunner({ ... });
 * const studio = await createStudio(runner, { port: 4000 });
 * // Studio is now running at http://localhost:4000
 * ```
 */
export async function createStudio(runner: Runner, options: StudioOptions = {}) {
  const port = options.port ?? 4000;
  const hostname = options.hostname ?? "localhost";
  const app = createStudioAPI(runner);

  // Serve the built UI static files
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const uiDir = resolve(__dirname, "../ui");

  if (existsSync(uiDir)) {
    // Serve static assets
    app.use("/*", serveStatic({ root: uiDir }));

    // SPA fallback — serve index.html for all non-API routes
    app.get("*", async (c) => {
      const path = c.req.path;
      if (path.startsWith("/api/")) {
        return c.json({ error: "Not found" }, 404);
      }
      const indexPath = resolve(uiDir, "index.html");
      if (existsSync(indexPath)) {
        const { readFile } = await import("node:fs/promises");
        const html = await readFile(indexPath, "utf-8");
        return c.html(html);
      }
      return c.text("Studio UI not built. Run: pnpm build:ui", 404);
    });
  }

  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  const url = `http://${hostname}:${port}`;
  options.onReady?.(url);

  return {
    url,
    app,
    close: () => {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
