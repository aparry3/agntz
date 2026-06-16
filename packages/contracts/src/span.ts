// Minimal structural view of the telemetry span emitter that the manifest
// executor needs. `@agntz/core`'s concrete `SpanEmitter` class satisfies this
// structurally (its methods return richer span objects and accept extra
// optional params), so manifest can thread spans through `ExecutionContext`
// without depending on core's runtime.

/** A started span the manifest executor finishes with `end()` or `error()`. */
export interface ManifestSpanHandle {
	end(): void;
	error(err: Error | string): void;
}

/** The subset of the telemetry span emitter the manifest executor calls. */
export interface ExecutionSpanEmitter {
	startManifest(params: {
		ownerId: string;
		agentId: string;
		kind: string;
	}): ManifestSpanHandle;
	startStep(params: {
		name: string;
		index: number;
		ownerId: string;
	}): ManifestSpanHandle;
}
