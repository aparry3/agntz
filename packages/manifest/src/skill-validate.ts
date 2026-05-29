import type { OutboundUrlPolicyOptions } from "@agntz/core";
import { parse as parseYAML } from "yaml";
import { normalizeSkill } from "./skill-parser.js";
import type { ManifestToolEntry } from "./types.js";
import {
	type ValidationContext,
	type ValidationError,
	type ValidationResult,
	type ValidationWarning,
	validateToolEntries,
	validateToolEntriesExternal,
} from "./validate.js";

const SKILL_NAME_RE = /^[a-z][a-z0-9-]*$/;

// Re-export ValidationResult so skill callers don't have to import from validate.js.
export type {
	ValidationResult,
	ValidationError,
	ValidationWarning,
} from "./validate.js";

// Context for full skill validation — same as agent ValidationContext minus provider/skill resolvers.
export interface SkillValidationContext {
	resolveAgent: (id: string) => Promise<boolean>;
	resolveTools: (server: string) => Promise<string[]>;
	localTools: string[];
	/** Match `ValidationContext.strict` — MCP unreachability hard-fails when true. */
	strict?: boolean;
	/** Override outbound URL policy for external liveness probes. */
	outboundUrlPolicy?: OutboundUrlPolicyOptions;
}

// Validate a skill YAML string (structural only).
export function validateSkill(yaml: string): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	let raw: unknown;
	try {
		raw = parseYAML(yaml);
	} catch (e) {
		errors.push({
			level: "structural",
			path: "",
			message: `YAML syntax error: ${(e as Error).message}`,
		});
		return { valid: false, errors, warnings };
	}

	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		errors.push({
			level: "structural",
			path: "",
			message: "Skill YAML must be an object",
		});
		return { valid: false, errors, warnings };
	}

	const obj = raw as Record<string, unknown>;
	validateSkillFields(obj, errors);

	// Validate the raw tools array against the ManifestToolEntry shape if present.
	if (obj.tools !== undefined) {
		if (!Array.isArray(obj.tools)) {
			errors.push({
				level: "structural",
				path: "tools",
				message: "tools must be an array",
			});
		} else {
			validateToolEntries(obj.tools as ManifestToolEntry[], "tools", errors);
		}
	}

	// If field checks passed, run the parser to catch anything else (e.g. malformed tool refs).
	if (errors.length === 0) {
		try {
			normalizeSkill(obj);
		} catch (e) {
			errors.push({
				level: "structural",
				path: "",
				message: (e as Error).message,
			});
		}
	}

	return { valid: errors.length === 0, errors, warnings };
}

// Validate a skill YAML string (structural + reference integrity).
export async function validateSkillFull(
	yaml: string,
	ctx: SkillValidationContext,
): Promise<ValidationResult> {
	const result = validateSkill(yaml);
	// Only run reference checks when the structural pass succeeded.
	if (!result.valid) return result;

	let raw: Record<string, unknown>;
	try {
		raw = parseYAML(yaml) as Record<string, unknown>;
	} catch {
		return result; // already reported structurally
	}
	const toolsRaw = (raw?.tools ?? []) as ManifestToolEntry[];
	if (!toolsRaw || toolsRaw.length === 0) return result;

	const fullCtx: ValidationContext = {
		resolveAgent: ctx.resolveAgent,
		resolveTools: ctx.resolveTools,
		localTools: ctx.localTools,
		strict: ctx.strict,
		outboundUrlPolicy: ctx.outboundUrlPolicy,
	};
	await validateToolEntriesExternal(
		toolsRaw,
		"tools",
		result.errors,
		result.warnings,
		fullCtx,
	);
	result.valid = result.errors.length === 0;
	return result;
}

// Structural check of the top-level skill fields (name / description / instructions).
function validateSkillFields(
	obj: Record<string, unknown>,
	errors: ValidationError[],
): void {
	const name = obj.name;
	if (typeof name !== "string" || name.length === 0) {
		errors.push({
			level: "structural",
			path: "name",
			message: "name is required and must be a non-empty string",
		});
	} else if (!SKILL_NAME_RE.test(name)) {
		errors.push({
			level: "structural",
			path: "name",
			message: `name '${name}' must match ${SKILL_NAME_RE.source}`,
		});
	}

	const description = obj.description;
	if (typeof description !== "string" || description.trim().length === 0) {
		errors.push({
			level: "structural",
			path: "description",
			message: "description is required and must be non-empty",
		});
	}

	const instructions = obj.instructions;
	if (typeof instructions !== "string" || instructions.trim().length === 0) {
		errors.push({
			level: "structural",
			path: "instructions",
			message: "instructions is required and must be non-empty",
		});
	}
}
