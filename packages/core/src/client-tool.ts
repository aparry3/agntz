import type { ClientToolEntry } from "@agntz/contracts";
import { z } from "zod";
import { compileManifestSchema } from "./manifest/schema.js";
import type { ClientToolDispatcher, ToolDefinition } from "./types.js";

export const DEFAULT_CLIENT_TOOL_TIMEOUT_MS = 30_000;
export const MIN_CLIENT_TOOL_TIMEOUT_MS = 1_000;
export const MAX_CLIENT_TOOL_TIMEOUT_MS = 120_000;

/**
 * Build the model/runtime bridge for a manifest-declared client tool. The
 * dispatcher is supplied per invocation, so the resulting definition remains
 * in the runner's ephemeral tool map.
 */
export function buildClientToolDefinition(
	entry: ClientToolEntry,
	dispatcher: ClientToolDispatcher,
): ToolDefinition {
	if (
		entry.inputSchema.type !== "object" ||
		!entry.inputSchema.properties ||
		typeof entry.inputSchema.properties !== "object" ||
		Array.isArray(entry.inputSchema.properties)
	) {
		throw new Error(
			`Client tool '${entry.name}' inputSchema must be a canonical object-root JSON Schema`,
		);
	}
	const validate = compileManifestSchema(entry.inputSchema);
	const input = z.unknown().superRefine((value, ctx) => {
		if (validate(value)) return;
		for (const issue of validate.errors ?? []) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: issue.instancePath.split("/").slice(1).filter(Boolean),
				message: issue.message ?? "invalid client tool argument",
			});
		}
	});

	return {
		name: entry.name,
		description: entry.description,
		input,
		modelInputSchema: entry.inputSchema,
		execute(args, ctx) {
			return dispatcher(entry, args, ctx);
		},
	};
}
