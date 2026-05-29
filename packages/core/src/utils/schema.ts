import type { ZodSchema } from "zod";

/**
 * Convert a Zod schema to JSON Schema.
 * Uses zod-to-json-schema if available, falls back to a basic conversion.
 */
export function zodToJsonSchema(schema: ZodSchema): Record<string, unknown> {
	// Zod v3 has a built-in _def we can introspect, but the cleanest
	// approach is to use the schema's parse shape. For now we use
	// zod's built-in JSON schema support if available.
	if ("_def" in schema && typeof schema._def === "object") {
		try {
			// zod v3.23+ has experimental jsonSchema()
			const def = schema._def as Record<string, unknown>;
			if (def.typeName === "ZodObject" && "shape" in def) {
				return buildObjectSchema(def);
			}
		} catch {
			// fall through
		}
	}

	// Fallback: return a permissive schema
	return { type: "object" };
}

function buildObjectSchema(
	def: Record<string, unknown>,
): Record<string, unknown> {
	const shape = (
		typeof def.shape === "function" ? def.shape() : def.shape
	) as Record<string, { _def: Record<string, unknown> }>;
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const [key, fieldSchema] of Object.entries(shape)) {
		const fieldDef = fieldSchema._def;
		const typeName = fieldDef.typeName as string;

		let prop: Record<string, unknown> = {};

		if (typeName === "ZodOptional") {
			const innerDef = (fieldDef.innerType as { _def: Record<string, unknown> })
				._def;
			prop = zodTypeToJsonProp(innerDef);
		} else {
			prop = zodTypeToJsonProp(fieldDef);
			required.push(key);
		}

		if (fieldDef.description) {
			prop.description = fieldDef.description;
		}

		properties[key] = prop;
	}

	const result: Record<string, unknown> = {
		type: "object",
		properties,
	};

	if (required.length > 0) {
		result.required = required;
	}

	return result;
}

function zodTypeToJsonProp(
	def: Record<string, unknown>,
): Record<string, unknown> {
	const typeName = def.typeName as string;

	switch (typeName) {
		case "ZodString":
			return { type: "string" };
		case "ZodNumber":
			return { type: "number" };
		case "ZodBoolean":
			return { type: "boolean" };
		case "ZodArray": {
			const itemDef = (def.type as { _def: Record<string, unknown> })._def;
			return { type: "array", items: zodTypeToJsonProp(itemDef) };
		}
		case "ZodEnum": {
			const values = def.values as string[];
			return { type: "string", enum: values };
		}
		case "ZodRecord":
			return { type: "object", additionalProperties: true };
		case "ZodObject":
			return buildObjectSchema(def);
		default:
			return {};
	}
}
