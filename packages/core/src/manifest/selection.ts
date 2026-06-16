import type { AgentManifest, StepRef } from "./types.js";

export type ManifestPath = Array<string | number>;

export interface ManifestSelection {
	/** Path to an AgentManifest object. Root agent is `[]`. */
	agentPath: ManifestPath;
	/** Path to the enclosing StepRef, when the selection is a pipeline child. */
	stepPath?: ManifestPath;
}

export interface SelectedManifestBlock {
	selection: ManifestSelection;
	agent?: AgentManifest;
	step?: StepRef;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentManifest(value: unknown): value is AgentManifest {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		(value.kind === "llm" ||
			value.kind === "tool" ||
			value.kind === "sequential" ||
			value.kind === "parallel")
	);
}

function isStepRef(value: unknown): value is StepRef {
	if (!isRecord(value)) return false;
	return typeof value.ref === "string" || isAgentManifest(value.agent);
}

export function getAtPath(root: unknown, path: ManifestPath): unknown {
	let cursor = root;
	for (const segment of path) {
		if (typeof segment === "number") {
			if (!Array.isArray(cursor)) return undefined;
			cursor = cursor[segment];
		} else {
			if (!isRecord(cursor)) return undefined;
			cursor = cursor[segment];
		}
	}
	return cursor;
}

export function selectionKey(selection: ManifestSelection): string {
	return JSON.stringify({
		agentPath: selection.agentPath,
		stepPath: selection.stepPath,
	});
}

export function selectManifestBlock(
	root: AgentManifest,
	selection?: ManifestSelection,
): SelectedManifestBlock {
	const normalized: ManifestSelection = selection ?? { agentPath: [] };
	const agentCandidate = getAtPath(root, normalized.agentPath);
	const stepCandidate = normalized.stepPath
		? getAtPath(root, normalized.stepPath)
		: undefined;
	return {
		selection: normalized,
		agent: isAgentManifest(agentCandidate) ? agentCandidate : undefined,
		step: isStepRef(stepCandidate) ? stepCandidate : undefined,
	};
}

export function findSelectionsByAgentId(
	root: AgentManifest,
	agentId: string,
): ManifestSelection[] {
	const matches: ManifestSelection[] = [];

	function walk(agent: AgentManifest, agentPath: ManifestPath): void {
		if (agent.id === agentId) {
			matches.push({ agentPath });
		}
		const steps =
			agent.kind === "sequential"
				? agent.steps
				: agent.kind === "parallel"
					? agent.branches
					: [];
		for (let i = 0; i < steps.length; i += 1) {
			const step = steps[i];
			const stepPath: ManifestPath = [
				...agentPath,
				agent.kind === "parallel" ? "branches" : "steps",
				i,
			];
			if (step.ref === agentId) {
				matches.push({ agentPath: [...stepPath, "agent"], stepPath });
			}
			if (step.agent) {
				walk(step.agent, [...stepPath, "agent"]);
			}
		}
	}

	walk(root, []);
	return matches;
}
