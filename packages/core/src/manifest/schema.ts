import Ajv2020, {
	type ErrorObject,
	type ValidateFunction,
} from "ajv/dist/2020.js";
import type { InputSchema, OutputSchema } from "./types.js";

export type JsonSchema = Record<string, unknown>;
export type ManifestSchema = InputSchema | OutputSchema;

const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_SCHEMA_DEPTH = 64;

export interface SchemaIssue {
	path: string;
	message: string;
}

export class ManifestSchemaError extends Error {
	readonly issues: SchemaIssue[];

	constructor(message: string, issues: SchemaIssue[]) {
		super(message);
		this.name = "ManifestSchemaError";
		this.issues = issues;
	}
}

/**
 * Canonical JSON Schema roots are intentionally distinguishable from the
 * legacy property-map shorthand. The `$schema` marker is sufficient; otherwise
 * require the object-root signature used by hosted agent inputs/outputs.
 */
export function isCanonicalManifestSchema(
	schema: ManifestSchema,
): schema is JsonSchema {
	return (
		typeof schema.$schema === "string" ||
		(schema.type === "object" && isRecord(schema.properties))
	);
}

/**
 * Convert either accepted manifest syntax into a canonical root JSON Schema.
 * Canonical schemas are cloned without weakening them. Legacy property maps
 * retain their existing all-fields-required, strict-object behavior.
 */
export function manifestSchemaToJsonSchema(schema: ManifestSchema): JsonSchema {
	if (isCanonicalManifestSchema(schema)) {
		return cloneJson(schema);
	}

	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const [key, value] of Object.entries(schema)) {
		properties[key] =
			typeof value === "string"
				? { type: value }
				: normalizeLegacyProperty(value);
		required.push(key);
	}

	return {
		type: "object",
		properties,
		required,
		additionalProperties: false,
	};
}

/** Return the declared root property names for either manifest syntax. */
export function manifestSchemaPropertyNames(
	schema: ManifestSchema | undefined,
): string[] {
	if (!schema) return [];
	if (!isCanonicalManifestSchema(schema)) return Object.keys(schema);
	const properties = schema.properties;
	return isRecord(properties) ? Object.keys(properties) : [];
}

/** Compile a manifest schema and return a reusable data validator. */
export function compileManifestSchema(
	schema: ManifestSchema,
	options: { useDefaults?: boolean } = {},
): ValidateFunction {
	const canonical = manifestSchemaToJsonSchema(schema);
	assertSafeSchema(canonical);
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
		allowUnionTypes: true,
		validateFormats: false,
		useDefaults: options.useDefaults ?? false,
	});
	try {
		return ajv.compile(canonical);
	} catch (error) {
		throw new ManifestSchemaError("Invalid JSON Schema", [
			{ path: "", message: (error as Error).message },
		]);
	}
}

/** Validate a value and throw a path-rich error on failure. */
export function assertManifestSchemaValue(
	schema: ManifestSchema,
	value: unknown,
	label: string,
	options: { useDefaults?: boolean } = {},
): void {
	const validate = compileManifestSchema(schema, options);
	if (validate(value)) return;
	throw new ManifestSchemaError(
		`${label} does not match its JSON Schema`,
		formatAjvErrors(validate.errors),
	);
}

/** Validate just the schema definition itself. */
export function validateManifestSchemaDefinition(
	schema: ManifestSchema,
): SchemaIssue[] {
	if (!isCanonicalManifestSchema(schema)) {
		const issues: SchemaIssue[] = [];
		for (const [key, definition] of Object.entries(schema)) {
			if (
				typeof definition === "object" &&
				definition !== null &&
				!Array.isArray(definition) &&
				!("type" in definition)
			) {
				issues.push({
					path: `/${escapeJsonPointer(key)}/type`,
					message: "legacy expanded property definitions require a type",
				});
			}
		}
		if (issues.length > 0) return issues;
	}
	try {
		compileManifestSchema(schema);
		return [];
	} catch (error) {
		if (error instanceof ManifestSchemaError) return error.issues;
		return [{ path: "", message: (error as Error).message }];
	}
}

function normalizeLegacyProperty(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === "min") {
			out.minimum = child;
		} else if (key === "max") {
			out.maximum = child;
		} else if (key === "properties" && isRecord(child)) {
			const properties: Record<string, unknown> = {};
			for (const [property, definition] of Object.entries(child)) {
				properties[property] =
					typeof definition === "string"
						? { type: definition }
						: normalizeLegacyProperty(definition);
			}
			out.properties = properties;
		} else if (key === "items") {
			out.items = normalizeLegacyProperty(child);
		} else {
			out[key] = cloneJson(child);
		}
	}

	if (out.type === "object") {
		if (!("additionalProperties" in out)) out.additionalProperties = false;
	}
	return out;
}

function assertSafeSchema(schema: JsonSchema): void {
	const encoded = JSON.stringify(schema);
	if (encoded.length > MAX_SCHEMA_BYTES) {
		throw new ManifestSchemaError("JSON Schema is too large", [
			{
				path: "",
				message: `schema exceeds ${MAX_SCHEMA_BYTES} encoded bytes`,
			},
		]);
	}

	const visit = (value: unknown, path: string, depth: number): void => {
		if (depth > MAX_SCHEMA_DEPTH) {
			throw new ManifestSchemaError("JSON Schema is too deep", [
				{ path, message: `schema exceeds maximum depth ${MAX_SCHEMA_DEPTH}` },
			]);
		}
		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				visit(value[i], `${path}/${i}`, depth + 1);
			}
			return;
		}
		if (!isRecord(value)) return;
		for (const [key, child] of Object.entries(value)) {
			const childPath = `${path}/${escapeJsonPointer(key)}`;
			if (
				key === "$ref" &&
				typeof child === "string" &&
				!child.startsWith("#")
			) {
				throw new ManifestSchemaError(
					"Remote JSON Schema references are not supported",
					[
						{
							path: childPath,
							message: "only local #/$defs references are allowed",
						},
					],
				);
			}
			visit(child, childPath, depth + 1);
		}
	};
	visit(schema, "", 0);
}

function formatAjvErrors(
	errors: ErrorObject[] | null | undefined,
): SchemaIssue[] {
	return (errors ?? []).map((error) => ({
		path: error.instancePath || error.schemaPath,
		message: error.message ?? "schema validation failed",
	}));
}

function cloneJson<T>(value: T): T {
	if (value === undefined) return value;
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeJsonPointer(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
