// ═══════════════════════════════════════════════════════════════════════
// agntz — base error vocabulary
// ═══════════════════════════════════════════════════════════════════════
//
// `AgntzError` is the shared base every agntz error extends; it lives in the
// kernel so both `@agntz/core` (which defines the runtime-specific subclasses)
// and pure leaf utilities here (e.g. `parseAgentRef`) can throw/extend it
// without a dependency on the runtime. `@agntz/core` re-exports both.

/**
 * Base error for all agntz errors.
 * Catch this to handle any SDK error.
 */
export class AgntzError extends Error {
	readonly code: string;

	constructor(code: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AgntzError";
		this.code = code;
	}
}

/**
 * Thrown when an agent reference string is malformed.
 * The accepted forms are `<id>`, `<id>@latest`, and `<id>@<ISO timestamp>`.
 */
export class InvalidAgentRefError extends AgntzError {
	readonly input: string;

	constructor(input: string, detail: string) {
		super("INVALID_AGENT_REF", `Invalid agent reference "${input}": ${detail}`);
		this.name = "InvalidAgentRefError";
		this.input = input;
	}
}
