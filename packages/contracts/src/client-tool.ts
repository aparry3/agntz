/**
 * A model-visible tool whose implementation is supplied by the invoking
 * client for one attached run. The manifest owns the stable contract; only
 * the executable handler is bound at invocation time.
 */
export interface ClientToolEntry {
	kind: "client";
	name: string;
	description: string;
	/** Canonical object-root JSON Schema for model-visible arguments. */
	inputSchema: Record<string, unknown>;
	/** Attached-client wait budget. Defaults to 30 seconds. */
	timeoutMs?: number;
}
