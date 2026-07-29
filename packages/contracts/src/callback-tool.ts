/**
 * Typed, signed callback endpoint exposed to a model as a tool. The model sees
 * only `inputSchema`; Agntz injects the trusted runtime envelope after the tool
 * call and signs the complete request body.
 */
export interface CallbackToolEntry {
	kind: "callback";
	name: string;
	url: string;
	description?: string;
	/** Canonical object-root JSON Schema for model-visible arguments. */
	inputSchema: Record<string, unknown>;
	/** Name of an owner-scoped SecretStore entry used as the HMAC key. */
	secret: string;
	timeoutMs?: number;
	maxRetries?: number;
}
