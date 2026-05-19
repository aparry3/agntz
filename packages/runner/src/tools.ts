import { z } from "zod";
import type { ToolDefinition, ToolContext } from "@agntz/core";

/**
 * User-supplied local tool handler. The handler receives parsed arguments
 * (an object — the runner passes whatever the model produces) plus the
 * core's `ToolContext` so handlers can introspect agent/session/invocation
 * ids if needed.
 *
 * Returning a value resolves the tool call to that value; the runner JSON-
 * stringifies non-string returns automatically when reporting back to the
 * model.
 */
export type LocalToolHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  args: TInput,
  ctx: ToolContext,
) => Promise<TOutput> | TOutput;

/**
 * Map of YAML tool names to handler implementations. Names that appear here
 * but never in a manifest are silently ignored; names referenced from a
 * manifest but missing from this map raise an error at load time so missing
 * handlers are caught before the first invocation.
 */
export type LocalToolMap = Record<string, LocalToolHandler>;

/**
 * Convert a user-supplied `LocalToolMap` into the `ToolDefinition[]` shape
 * the core runner registers. We use a permissive `z.any()` schema for
 * arguments — local tools are author-controlled, so we trust the handler
 * to type-narrow inside its body. Users who want stronger validation can
 * register a typed `ToolDefinition` directly via the runner's lower-level
 * API (escape hatch).
 */
export function toolMapToDefinitions(tools: LocalToolMap): ToolDefinition[] {
  return Object.entries(tools).map(([name, handler]) => ({
    name,
    description: `Local tool '${name}'`,
    input: z.any(),
    async execute(args, ctx) {
      return handler(args as Record<string, unknown>, ctx);
    },
  }));
}
