import type { ToolContext, ToolDefinition } from "@agntz/core";
import type { infer as ZodInfer, ZodSchema } from "zod";

/**
 * Define a local tool with a Zod input schema. The schema both validates
 * arguments at call time and produces the JSON schema the model sees — so
 * field-level `.describe()` calls flow through to the model's tool list.
 *
 * Acts as an identity helper that gives `execute` typed access to the parsed
 * arguments (inferred from the schema). Equivalent to `defineTool` from
 * `@agntz/core` for inline local tools.
 */
export function tool<TSchema extends ZodSchema>(definition: {
	name: string;
	description: string;
	input: TSchema;
	execute: (
		args: ZodInfer<TSchema>,
		ctx: ToolContext,
	) => Promise<unknown> | unknown;
}): ToolDefinition<ZodInfer<TSchema>> {
	return {
		name: definition.name,
		description: definition.description,
		input: definition.input,
		async execute(args, ctx) {
			return definition.execute(args as ZodInfer<TSchema>, ctx);
		},
	};
}
