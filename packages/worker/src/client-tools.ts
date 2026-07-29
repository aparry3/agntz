import { randomBytes } from "node:crypto";
import {
	type ClientToolDispatcher,
	type ClientToolEntry,
	DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
	InvocationCancelledError,
	type RunRegistry,
	type Runner,
} from "@agntz/core";
import type { AgentManifest } from "@agntz/core/manifest";
import { resolveManifestFromAgent } from "./bridge.js";

export const CLIENT_TOOL_RESULT_MAX_CHARS = 40_000;

type RequestStatus = "pending" | "submitted" | "expired" | "cancelled";

interface PendingClientToolRequest {
	ownerId: string;
	rootRunId: string;
	name: string;
	status: RequestStatus;
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
	removeAbortListener?: () => void;
}

export type ClientToolSubmitResult =
	| "accepted"
	| "duplicate"
	| "unknown"
	| "expired"
	| "forbidden";

/**
 * Process-local rendezvous between an attached SSE invocation and the result
 * POST made by the same SDK. Requests deliberately cannot survive a worker
 * restart or an SSE disconnect.
 */
export class AttachedClientToolBroker {
	private readonly requests = new Map<string, PendingClientToolRequest>();

	constructor(private readonly runRegistry: RunRegistry) {}

	dispatch(ownerId: string): ClientToolDispatcher {
		return (entry, input, ctx) => {
			const runId = ctx.runId;
			const toolCallId = ctx.toolCallId;
			if (!runId || !toolCallId) {
				throw new Error(
					`Client tool '${entry.name}' was invoked outside an attached Run`,
				);
			}
			const run = this.runRegistry.get(runId);
			const rootRunId = run?.rootId ?? runId;
			const requestId = `ctr_${randomBytes(12).toString("hex")}`;
			const timeoutMs = entry.timeoutMs ?? DEFAULT_CLIENT_TOOL_TIMEOUT_MS;
			const deadlineAt = new Date(Date.now() + timeoutMs).toISOString();

			return new Promise<unknown>((resolve, reject) => {
				const request: PendingClientToolRequest = {
					ownerId,
					rootRunId,
					name: entry.name,
					status: "pending",
					resolve,
					reject,
					timer: setTimeout(() => {
						request.status = "expired";
						request.removeAbortListener?.();
						this.scheduleCleanup(requestId);
						reject(
							new Error(
								`Client tool '${entry.name}' timed out after ${timeoutMs}ms`,
							),
						);
					}, timeoutMs),
				};

				const onAbort = () => {
					if (request.status !== "pending") return;
					request.status = "cancelled";
					clearTimeout(request.timer);
					this.scheduleCleanup(requestId);
					reject(new InvocationCancelledError());
				};
				if (ctx.signal) {
					ctx.signal.addEventListener("abort", onAbort, { once: true });
					request.removeAbortListener = () =>
						ctx.signal?.removeEventListener("abort", onAbort);
				}
				this.requests.set(requestId, request);
				this.runRegistry.emit(rootRunId, {
					type: "client-tool-request",
					runId,
					rootRunId,
					requestId,
					toolCallId,
					name: entry.name,
					input,
					deadlineAt,
					seq: 0,
				});
			});
		};
	}

	submit(args: {
		ownerId: string;
		rootRunId: string;
		requestId: string;
		output?: unknown;
		error?: string;
	}): ClientToolSubmitResult {
		const request = this.requests.get(args.requestId);
		if (!request || request.rootRunId !== args.rootRunId) return "unknown";
		if (request.ownerId !== args.ownerId) return "forbidden";
		if (request.status === "submitted") return "duplicate";
		if (request.status === "expired" || request.status === "cancelled") {
			return "expired";
		}

		request.status = "submitted";
		clearTimeout(request.timer);
		request.removeAbortListener?.();
		if (args.error !== undefined) {
			request.reject(
				new Error(`Client tool '${request.name}' failed: ${args.error}`),
			);
		} else {
			request.resolve(args.output);
		}
		this.scheduleCleanup(args.requestId);
		return "accepted";
	}

	private scheduleCleanup(requestId: string): void {
		const timer = setTimeout(() => {
			this.requests.delete(requestId);
		}, 5 * 60_000);
		timer.unref?.();
	}
}

/**
 * Walk every manifest reachable from the selected root. This is intentionally
 * done before Run creation so a missing application handler cannot consume a
 * model call or leave behind a failed Run.
 */
export async function collectRequiredClientTools(
	manifest: AgentManifest,
	runner: Runner,
): Promise<Map<string, ClientToolEntry>> {
	const found = new Map<string, ClientToolEntry>();
	const visitedRefs = new Set<string>();
	const visitedInline = new Set<AgentManifest>();

	const add = (entry: ClientToolEntry) => {
		const prior = found.get(entry.name);
		if (prior && stableJSON(prior) !== stableJSON(entry)) {
			throw Object.assign(
				new Error(
					`Client tool '${entry.name}' has conflicting contracts in the reachable manifest graph`,
				),
				{ code: "BAD_REQUEST" },
			);
		}
		found.set(entry.name, entry);
	};

	const visitRef = async (ref: string) => {
		if (visitedRefs.has(ref)) return;
		visitedRefs.add(ref);
		const stored = await runner.resolveAgentRef(ref);
		if (!stored) return;
		let child: AgentManifest;
		try {
			child = resolveManifestFromAgent(
				stored as unknown as Record<string, unknown>,
			);
		} catch {
			return;
		}
		await visit(child);
	};

	const visit = async (current: AgentManifest): Promise<void> => {
		if (visitedInline.has(current)) return;
		visitedInline.add(current);
		if (current.kind === "llm") {
			for (const tool of current.tools ?? []) {
				if (tool.kind === "client") add(tool);
				if (tool.kind === "agent") {
					await visitRef(
						tool.version ? `${tool.agent}@${tool.version}` : tool.agent,
					);
				}
			}
			for (const spawnable of current.spawnable ?? []) {
				if (spawnable.kind === "inline") await visit(spawnable.definition);
				else {
					await visitRef(
						spawnable.version
							? `${spawnable.agentId}@${spawnable.version}`
							: spawnable.agentId,
					);
				}
			}
			return;
		}
		if (current.kind === "sequential" || current.kind === "parallel") {
			const steps =
				current.kind === "sequential" ? current.steps : current.branches;
			for (const step of steps) {
				if (step.agent) await visit(step.agent);
				if (step.ref) await visitRef(step.ref);
			}
		}
	};

	await visit(manifest);
	return found;
}

function stableJSON(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJSON(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
