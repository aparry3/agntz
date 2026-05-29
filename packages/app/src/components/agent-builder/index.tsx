"use client";

// Primary "Build" mode for the agent editor. The pipeline canvas is the
// glanceable flow view; clicking a block opens the inspector that edits
// every YAML config option without leaving the page.

import type { Catalog } from "@/lib/use-catalog";
import { useEffect, useMemo, useState } from "react";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { PipelineCanvas } from "./pipeline-canvas";
import { PipelineInspector } from "./pipeline-inspector";
import {
	type PipelineNode,
	type PipelinePath,
	findNode,
	findParent,
	isRecord,
	nodeFromAgent,
	setIn,
} from "./pipeline-types";

interface AgentBuilderProps {
	manifest: string;
	onChange: (next: string) => void;
	catalog: Catalog;
	idLocked: boolean;
}

// Keys ordered the same way the previous form-based builder used to. The
// runtime is order-insensitive but humans like reading top-down, and
// `stringify` preserves key order.
const PREFERRED_ORDER = [
	"id",
	"name",
	"description",
	"kind",
	"inputSchema",
	"stateKey",
	"model",
	"instruction",
	"examples",
	"tools",
	"spawnable",
	"skills",
	"reply",
	"outputSchema",
	"tool",
	"steps",
	"branches",
	"until",
	"maxIterations",
	"output",
];

function orderManifestKeys(
	manifest: Record<string, unknown>,
): Record<string, unknown> {
	const ordered: Record<string, unknown> = {};
	for (const key of PREFERRED_ORDER) {
		if (key in manifest) ordered[key] = manifest[key];
	}
	for (const key of Object.keys(manifest)) {
		if (!(key in ordered)) ordered[key] = manifest[key];
	}
	return ordered;
}

export function AgentBuilder({
	manifest,
	onChange,
	catalog,
	idLocked,
}: AgentBuilderProps) {
	const parsedManifest = useMemo<Record<string, unknown>>(() => {
		try {
			const v = parseYAML(manifest);
			return isRecord(v) ? v : {};
		} catch {
			return {};
		}
	}, [manifest]);

	// Build the normalized pipeline tree from the parsed manifest. We don't
	// re-derive the tree on every render — only when the parsed manifest
	// changes — so block-click handlers and selection stay stable.
	const pipeline = useMemo<PipelineNode>(
		() => nodeFromAgent(parsedManifest, [], { isRoot: true }),
		[parsedManifest],
	);

	const [selectedId, setSelectedId] = useState<string>(pipeline.id);

	// If the user edits the YAML elsewhere (or AI rewrites the manifest)
	// and the previously-selected node disappears, fall back to the root.
	useEffect(() => {
		if (!findNode(pipeline, selectedId)) {
			setSelectedId(pipeline.id);
		}
	}, [pipeline, selectedId]);

	const selected = useMemo<PipelineNode>(
		() => findNode(pipeline, selectedId) ?? pipeline,
		[pipeline, selectedId],
	);

	const setField = (path: PipelinePath, value: unknown) => {
		const next = setIn(parsedManifest, path, value);
		if (!isRecord(next)) return;
		onChange(stringifyYAML(orderManifestKeys(next), { lineWidth: 0 }));
	};

	const handleRemoveStep = (node: PipelineNode) => {
		// Root has no enclosing array — guard so the affordance can't bypass the
		// inspector's `!isRoot` check by accident.
		if (node.isRoot || !node.stepPath) return;
		const arrPath = node.stepPath.slice(0, -1);
		const indexInArr = node.stepPath[node.stepPath.length - 1];
		if (typeof indexInArr !== "number") return;

		const current = readArrayAt(parsedManifest, arrPath);
		const nextArr = [
			...current.slice(0, indexInArr),
			...current.slice(indexInArr + 1),
		];

		// Re-select the parent so the inspector stays useful; fall back to root
		// if for some reason the parent isn't in the tree.
		const parent = findParent(pipeline, node.id);
		setSelectedId(parent?.id ?? pipeline.id);

		// Drop the whole array key when emptying — the YAML is cleaner without an
		// empty `steps: []` left behind.
		setField(arrPath, nextArr.length > 0 ? nextArr : undefined);
	};

	const handleAddStep = (parent: PipelineNode, index: number) => {
		const newAgent = {
			id: `step-${Date.now().toString(36)}`,
			kind: "llm",
			model: { provider: "anthropic", name: "claude-sonnet-4-6" },
			instruction: "Write the system prompt here.",
		};
		const arrPath: PipelinePath =
			parent.kind === "parallel"
				? [...parent.agentPath, "branches"]
				: [...parent.agentPath, "steps"];
		const current = readArrayAt(parsedManifest, arrPath);
		const next = [
			...current.slice(0, index),
			{ agent: newAgent },
			...current.slice(index),
		];
		setField(arrPath, next);
		setSelectedId(newAgent.id);
	};

	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "minmax(0, 1fr) 420px",
				gap: 0,
				border: "1px solid #e7e5e4",
				borderRadius: 16,
				overflow: "hidden",
				background: "#fff",
				minHeight: 560,
			}}
		>
			<PipelineCanvas
				pipeline={pipeline}
				selectedId={selectedId}
				onSelect={setSelectedId}
				onAddStep={handleAddStep}
			/>
			<aside
				style={{
					borderLeft: "1px solid #e7e5e4",
					minHeight: 0,
					maxHeight: 720,
					overflow: "hidden",
					background: "#fff",
				}}
			>
				<PipelineInspector
					pipeline={pipeline}
					selected={selected}
					parsedManifest={parsedManifest}
					catalog={catalog}
					setField={setField}
					idLocked={idLocked}
					onRemove={handleRemoveStep}
				/>
			</aside>
		</div>
	);
}

function readArrayAt(root: unknown, path: PipelinePath): unknown[] {
	let cursor: unknown = root;
	for (const segment of path) {
		if (cursor == null) return [];
		if (typeof segment === "number") {
			if (!Array.isArray(cursor)) return [];
			cursor = cursor[segment];
		} else {
			if (!isRecord(cursor)) return [];
			cursor = cursor[segment];
		}
	}
	return Array.isArray(cursor) ? cursor : [];
}
