import type { ToolContext, ToolDefinition } from "@agntz/core";
// zod's `infer` is an alias of `TypeOf`; importing it under any local name
// gets resolved back to `infer` by the dts bundler, which is a reserved
// keyword in type positions and produces an invalid dist/index.d.ts.
import type { TypeOf, ZodSchema } from "zod";

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
		args: TypeOf<TSchema>,
		ctx: ToolContext,
	) => Promise<unknown> | unknown;
}): ToolDefinition<TypeOf<TSchema>> {
	return {
		name: definition.name,
		description: definition.description,
		input: definition.input,
		async execute(args, ctx) {
			return definition.execute(args as TypeOf<TSchema>, ctx);
		},
	};
}
