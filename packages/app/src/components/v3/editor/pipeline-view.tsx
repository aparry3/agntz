// PipelineView — V3 editor layout for sequential/parallel manifests. The
// graph shows each step (numbered), a loop badge when relevant, and the
// inspector switches its contents based on the selected step.
//
// Root-level add/remove/move is wired through the inspector. Nested steps are
// rendered recursively and can be selected for inspection, AI edits, and
// focused playground runs; deeper structural add/remove still goes through YAML.

"use client";

import {
	type PipelineNode,
	type PipelinePath,
	type StateRef,
	computeAvailableStateAt,
	nodeFromAgent,
} from "@/components/agent-builder/pipeline-types";
import { getIn, isRecord } from "@/components/agent-builder/pipeline-types";
import { I } from "@/components/v3/icons";
import {
	Btn,
	Edge,
	Mono,
	NodeIO,
	Tag,
	VarHl,
	ag,
} from "@/components/v3/primitives";
import type { Catalog } from "@/lib/use-catalog";
import type { ManifestSelection } from "@agntz/manifest";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
	EditableNumber,
	EditableSelect,
	EditableText,
} from "./editable-fields";
import { Popover } from "./editable-fields";
import { type Example, ExamplesEditor } from "./examples-editor";
import { GraphPanel, GraphValidates } from "./graph-panel";
import {
	Field,
	FooterHint,
	InsSection,
	StateLine,
	SubBlock,
} from "./inspector-bits";
import { InstructionEmptyState, InstructionPanel } from "./instruction-panel";
import { ModelPicker } from "./model-picker";
import {
	type RootManifest,
	appendStepAtRoot,
	containerKeyForKind,
	moveStepAt,
	patchAgentAt,
	patchStepInputMap,
	removeStepAt,
} from "./pipeline-mutations";
import { PipelineStep, type StepField } from "./pipeline-step";
import { SchemaEditor } from "./schema-editor";
import { StepPicker, type StepRefPayload } from "./step-picker";
import {
	HTTP_METHODS,
	ParamsEditor,
	type ToolEntry,
	ToolsEditor,
} from "./tools-editor";

export type PipelineViewMode = "build" | "yaml" | "instruction" | "both";

export interface PipelineSelectionContext {
	root: PipelineNode;
	selected: PipelineNode;
	selection: ManifestSelection;
	selectedManifest: Record<string, unknown>;
}

export function PipelineView({
	rootManifest,
	manifestId,
	view,
	onChangeView,
	onChange,
	catalog,
	yamlPanel,
	rightPaneOverride,
	onEditRequest,
}: {
	rootManifest: Record<string, unknown>;
	manifestId: string;
	view: PipelineViewMode;
	onChangeView: (v: PipelineViewMode) => void;
	/** Generic patcher — receives a fully-formed next root manifest. Used by
	 *  Phase 2+ pipeline editors (root description/model, step add/delete, etc.). */
	onChange?: (next: Record<string, unknown>) => void;
	/** Workspace catalog — passed to the step picker for agent references. */
	catalog?: Catalog;
	yamlPanel?: ReactNode;
	/** When provided, replaces the inspector / instruction panel on the right
	 *  for every view mode except `yaml`. Used by the editor page to swap in
	 *  the Playground panel in play mode. */
	rightPaneOverride?: (ctx: PipelineSelectionContext) => ReactNode;
	onEditRequest?: (
		selection: ManifestSelection,
		changeDescription: string,
	) => Promise<void> | void;
}) {
	const root = useMemo<PipelineNode>(
		() => nodeFromAgent(rootManifest, [], { isRoot: true }),
		[rootManifest],
	);

	// Default selection: the first child step, or root if there are none.
	const firstStep = (root.steps ?? root.branches ?? [])[0];
	const [selectedKey, setSelectedKey] = useState<string>(
		nodeSelectionKey(firstStep ?? root),
	);

	const flatSteps = useMemo(() => flatten(root), [root]);
	const selectedNode =
		flatSteps.find((n) => nodeSelectionKey(n) === selectedKey) ?? root;
	const availableState = useMemo(
		() => computeAvailableStateAt(root, selectedNode.id),
		[root, selectedNode.id],
	);
	const selectedManifest = useMemo(() => {
		const value = getIn(rootManifest, selectedNode.agentPath);
		if (isRecord(value)) return value;
		return {
			id: selectedNode.id,
			name: selectedNode.name,
			kind: selectedNode.isLoop ? "sequential" : selectedNode.kind,
		};
	}, [rootManifest, selectedNode]);
	const selectedContext = useMemo<PipelineSelectionContext>(
		() => ({
			root,
			selected: selectedNode,
			selection: selectionForNode(selectedNode),
			selectedManifest,
		}),
		[root, selectedNode, selectedManifest],
	);

	const handleAddStep = (payload: StepRefPayload) => {
		if (!onChange) return;
		const next = appendStepAtRoot(
			rootManifest as RootManifest,
			payload as Record<string, unknown>,
		);
		onChange(next);
	};

	const handleRemoveSelected = () => {
		if (!onChange || !selectedNode.stepPath) return;
		const next = removeStepAt(
			rootManifest as RootManifest,
			selectedNode.stepPath,
		);
		onChange(next);
		setSelectedKey(nodeSelectionKey(root));
	};

	const handleMoveSelected = (delta: -1 | 1) => {
		if (!onChange || !selectedNode.stepPath) return;
		const next = moveStepAt(
			rootManifest as RootManifest,
			selectedNode.stepPath,
			delta,
		);
		onChange(next);
	};

	const handleInputMap = (
		stepPath: PipelinePath,
		key: string,
		value: string | undefined,
	) => {
		if (!onChange) return;
		const next = patchStepInputMap(
			rootManifest as RootManifest,
			stepPath,
			key,
			value,
		);
		onChange(next);
	};

	const handlePatchAgent = (
		agentPath: PipelinePath,
		partial: Record<string, unknown>,
	) => {
		if (!onChange) return;
		const next = patchAgentAt(rootManifest as RootManifest, agentPath, partial);
		onChange(next);
	};

	return (
		<div
			style={{
				flex: 1,
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
			}}
		>
			{/* View switcher */}
			<div
				style={{
					padding: "10px 28px",
					borderBottom: `1px solid ${ag.line2}`,
					background: ag.surface,
					display: "flex",
					alignItems: "center",
					gap: 12,
				}}
			>
				<div
					style={{
						fontSize: 10.5,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: ag.muted,
						fontWeight: 500,
					}}
				>
					View
				</div>
				<div
					style={{
						display: "flex",
						padding: 2,
						background: ag.surface2,
						border: `1px solid ${ag.line}`,
						borderRadius: 4,
					}}
				>
					{(
						[
							["Build", I.Sliders, "build"],
							["YAML", I.Code, "yaml"],
							["Instruction", I.Sparkle, "instruction"],
							["Both", I.Eye, "both"],
						] as const
					).map(([t, Ic, key]) => (
						<button
							key={key}
							onClick={() => onChangeView(key as PipelineViewMode)}
							style={{
								padding: "5px 11px",
								borderRadius: 3,
								fontSize: 12,
								background: view === key ? ag.bg : "transparent",
								color: view === key ? ag.ink : ag.text2,
								border: "none",
								cursor: "pointer",
								fontWeight: 500,
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								fontFamily: "inherit",
							}}
						>
							<Ic size={11} />
							{t}
						</button>
					))}
				</div>
				<div style={{ flex: 1 }} />
				<Mono size={11} color={ag.muted}>
					editing{" "}
					{selectedNode.id === root.id ? "root" : `step · ${selectedNode.id}`}
				</Mono>
			</div>

			<div
				style={{
					flex: 1,
					display: "grid",
					gridTemplateColumns:
						view === "yaml"
							? "1fr"
							: view === "both"
								? "1fr 1fr 420px"
								: view === "instruction"
									? "1fr 1fr"
									: "1fr 420px",
					minHeight: 0,
				}}
			>
				{(view === "build" || view === "instruction" || view === "both") && (
					<PipelineGraph
						root={root}
						rootManifest={rootManifest}
						selectedKey={selectedKey}
						onSelect={(node) => setSelectedKey(nodeSelectionKey(node))}
						flatSteps={flatSteps}
						catalog={catalog}
						onAddStep={handleAddStep}
						onSelectRoot={() => setSelectedKey(nodeSelectionKey(root))}
					/>
				)}

				{(view === "yaml" || view === "both") && yamlPanel}

				{view !== "yaml" && rightPaneOverride ? (
					rightPaneOverride(selectedContext)
				) : view === "instruction" ? (
					selectedNode.kind === "llm" ? (
						<PipelineInstructionPanel
							selectedNode={selectedNode}
							rootManifest={rootManifest}
							onPatchAgent={onChange ? handlePatchAgent : undefined}
						/>
					) : (
						<InstructionEmptyState
							hint={
								selectedNode.id === root.id
									? "Select an LLM step in the pipeline to edit its instructions."
									: `${selectedNode.kind === "tool" ? "Tool" : "Sub-pipeline"} steps don't have instructions. Pick an LLM step.`
							}
						/>
					)
				) : view !== "yaml" ? (
					<PipelineInspector
						root={root}
						selected={selectedNode}
						rootManifest={rootManifest}
						catalog={catalog}
						availableState={availableState.keys}
						onRemoveSelected={
							onChange && selectedNode.stepPath
								? handleRemoveSelected
								: undefined
						}
						onMoveSelected={
							onChange && selectedNode.stepPath ? handleMoveSelected : undefined
						}
						onPatchInputMap={onChange ? handleInputMap : undefined}
						onPatchAgent={onChange ? handlePatchAgent : undefined}
						onEditRequest={onEditRequest}
						canMoveUp={canMove(rootManifest, selectedNode, -1)}
						canMoveDown={canMove(rootManifest, selectedNode, 1)}
					/>
				) : null}
			</div>
		</div>
	);
}

function flatten(node: PipelineNode): PipelineNode[] {
	const out: PipelineNode[] = [node];
	const children = node.steps ?? node.branches ?? [];
	for (const c of children) out.push(...flatten(c));
	return out;
}

function selectionForNode(node: PipelineNode): ManifestSelection {
	return node.stepPath
		? { agentPath: node.agentPath, stepPath: node.stepPath }
		: { agentPath: node.agentPath };
}

function selectionKey(selection: ManifestSelection): string {
	return JSON.stringify({
		agentPath: selection.agentPath,
		stepPath: selection.stepPath,
	});
}

function nodeSelectionKey(node: PipelineNode): string {
	return selectionKey(selectionForNode(node));
}

function canMove(
	rootManifest: Record<string, unknown>,
	node: PipelineNode,
	delta: -1 | 1,
): boolean {
	if (!node.stepPath || node.stepPath.length === 0) return false;
	const lastSeg = node.stepPath[node.stepPath.length - 1];
	if (typeof lastSeg !== "number") return false;
	const containerKey =
		node.stepPath.length === 2 ? containerKeyForKind(rootManifest.kind) : null;
	// We only support moving within the root container in this round. Nested
	// steps fall through and disable the arrows.
	if (!containerKey) return false;
	const container = rootManifest[containerKey];
	if (!Array.isArray(container)) return false;
	const newIdx = lastSeg + delta;
	return newIdx >= 0 && newIdx < container.length;
}

/* ── Graph panel populated with the parsed step tree ───────────────────── */
function PipelineGraph({
	root,
	rootManifest,
	selectedKey,
	onSelect,
	flatSteps,
	catalog,
	onAddStep,
	onSelectRoot,
}: {
	root: PipelineNode;
	rootManifest: Record<string, unknown>;
	selectedKey: string;
	onSelect: (node: PipelineNode) => void;
	flatSteps: PipelineNode[];
	catalog?: Catalog;
	onAddStep: (step: StepRefPayload) => void;
	onSelectRoot: () => void;
}) {
	const children = root.steps ?? root.branches ?? [];
	const inputs = (root.inputSchema ?? []).map((f) => f.key);
	const childIds = children.map((c) => c.id);

	const addRef = useRef<HTMLButtonElement>(null);
	const [addOpen, setAddOpen] = useState(false);

	const containerKind: "sequential" | "parallel" | "loop" = root.isLoop
		? "loop"
		: root.kind === "parallel"
			? "parallel"
			: "sequential";

	const containerKey = containerKeyForKind(rootManifest.kind);
	const nextStepIndex =
		(rootManifest[containerKey] as unknown[] | undefined)?.length ?? 0;

	return (
		<GraphPanel
			topRight={
				<Btn
					ref={addRef}
					variant="secondary"
					size="sm"
					icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
					onClick={() => setAddOpen((o) => !o)}
				>
					Add step
				</Btn>
			}
			status={
				<>
					<GraphValidates />
					<Mono size={11}>
						{flatSteps.length - 1} step{flatSteps.length - 1 === 1 ? "" : "s"} ·
						click any step to edit
					</Mono>
				</>
			}
		>
			<NodeIO label="INPUT" sub={inputs.join(" · ") || "—"} />
			<Edge />
			<PipelineContainer
				kind={containerKind}
				rootId={root.id}
				loopUntil={root.loop?.until}
				loopMax={root.loop?.maxIterations}
				selected={nodeSelectionKey(root) === selectedKey}
				onSelect={onSelectRoot}
			>
				{children.length === 0 ? (
					<EmptyContainerHint onAdd={() => setAddOpen(true)} />
				) : (
					children.map((step, i) => (
						<PipelineNodeGraph
							key={nodeSelectionKey(step)}
							node={step}
							n={i + 1}
							selectedKey={selectedKey}
							onSelect={onSelect}
							isLast={i === children.length - 1}
							showSiblingEdge={root.kind !== "parallel"}
						/>
					))
				)}
			</PipelineContainer>
			<Edge />
			<NodeIO
				label="OUTPUT"
				sub={childIds.length ? `composed from ${childIds.join(" · ")}` : "—"}
			/>
			<Popover
				open={addOpen}
				onClose={() => setAddOpen(false)}
				anchorRef={addRef}
				width={320}
			>
				<StepPicker
					agents={catalog?.agents ?? []}
					currentAgentId={
						typeof rootManifest.id === "string" ? rootManifest.id : undefined
					}
					nextStepIndex={nextStepIndex + 1}
					onCancel={() => setAddOpen(false)}
					onAdd={(payload) => {
						onAddStep(payload);
						setAddOpen(false);
					}}
				/>
			</Popover>
		</GraphPanel>
	);
}

/* ── PipelineContainer — labeled border that wraps the root step list ──── */

function PipelineContainer({
	kind,
	rootId,
	loopUntil,
	loopMax,
	selected,
	onSelect,
	children,
}: {
	kind: "sequential" | "parallel" | "loop";
	rootId: string;
	loopUntil?: string;
	loopMax?: number;
	selected: boolean;
	onSelect: () => void;
	children: ReactNode;
}) {
	const palette = (() => {
		switch (kind) {
			case "parallel":
				return { fg: ag.purple, bg: ag.purpleBg, label: "parallel" };
			case "loop":
				return { fg: ag.warn, bg: ag.warnBg, label: "loop" };
			default:
				return { fg: ag.ok, bg: ag.okBg, label: "sequential" };
		}
	})();

	return (
		<div
			style={{
				width: kind === "parallel" ? "max-content" : 420,
				minWidth: 420,
				maxWidth: "100%",
				border: `1.5px ${kind === "loop" ? "dashed" : "solid"} ${selected ? ag.ink : palette.fg}`,
				borderRadius: 8,
				background: ag.surface2,
				padding: "10px 12px 12px",
				position: "relative",
				boxShadow: selected ? "0 0 0 3px rgba(26,25,22,0.06)" : "none",
				cursor: "pointer",
			}}
			onClick={(e) => {
				// Only register a click on the container itself, not on inner steps.
				if (e.target === e.currentTarget) onSelect();
			}}
		>
			<div
				onClick={(e) => {
					e.stopPropagation();
					onSelect();
				}}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginBottom: 10,
					paddingBottom: 8,
					borderBottom: `1px solid ${ag.line2}`,
				}}
			>
				<span
					style={{
						background: palette.bg,
						color: palette.fg,
						padding: "2px 7px",
						borderRadius: 3,
						fontSize: 10.5,
						fontFamily: "var(--font-mono)",
						fontWeight: 500,
						textTransform: "uppercase",
						letterSpacing: "0.05em",
					}}
				>
					{palette.label}
				</span>
				<Mono size={11} color={ag.muted}>
					{rootId}
				</Mono>
				<div style={{ flex: 1 }} />
				{kind === "loop" && loopUntil && (
					<span
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							padding: "2px 6px",
							border: `1px solid ${ag.line}`,
							borderRadius: 3,
							fontSize: 10.5,
							color: ag.text2,
							fontFamily: "var(--font-mono)",
						}}
						title="Loop runs until this condition is truthy"
					>
						<I.Hist size={10} />
						until <span style={{ color: ag.warn }}>{loopUntil}</span>
						{loopMax ? ` · max ${loopMax}` : ""}
					</span>
				)}
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: kind === "parallel" ? "row" : "column",
					alignItems: kind === "parallel" ? "flex-start" : "center",
					gap: kind === "parallel" ? 12 : 0,
				}}
			>
				{children}
			</div>
		</div>
	);
}

function EmptyContainerHint({ onAdd }: { onAdd: () => void }) {
	return (
		<div
			style={{
				padding: "24px 12px",
				textAlign: "center",
				color: ag.muted,
				fontSize: 12,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				alignItems: "center",
			}}
		>
			<Mono size={11.5} color={ag.muted}>
				No steps yet.
			</Mono>
			<Btn
				variant="secondary"
				size="sm"
				icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
				onClick={onAdd}
			>
				Add first step
			</Btn>
		</div>
	);
}

function PipelineNodeGraph({
	node,
	n,
	selectedKey,
	onSelect,
	isLast,
	showSiblingEdge,
}: {
	node: PipelineNode;
	n: number;
	selectedKey: string;
	onSelect: (node: PipelineNode) => void;
	isLast?: boolean;
	showSiblingEdge?: boolean;
}) {
	const inputs: StepField[] = (node.inputSchema ?? []).map((f) => ({
		name: f.key,
		type: f.type,
		required: !f.nullable && f.default === undefined,
	}));
	const outputs: StepField[] = (node.outputSchemaKeys ?? []).map((f) => ({
		name: f.key,
		type: f.type,
	}));
	const children = node.steps ?? node.branches ?? [];
	const isContainer = children.length > 0;
	const containerKind: "sequential" | "parallel" | "loop" = node.isLoop
		? "loop"
		: node.kind === "parallel"
			? "parallel"
			: "sequential";
	const selected = nodeSelectionKey(node) === selectedKey;
	return (
		<>
			<PipelineStep
				n={n}
				id={node.id}
				name={node.name}
				kind={
					node.kind === "tool"
						? "tool"
						: node.kind === "sequential"
							? "sequential"
							: node.kind === "parallel"
								? "parallel"
								: "llm"
				}
				selected={selected}
				summary={node.description ?? node.instructionPreview}
				model={
					node.model ? `${node.model.provider} · ${node.model.name}` : undefined
				}
				inputs={inputs.length ? inputs : undefined}
				outputs={outputs.length ? outputs : undefined}
				onClick={(e) => {
					e?.stopPropagation();
					onSelect(node);
				}}
			/>
			{isContainer && (
				<>
					<Edge />
					<PipelineContainer
						kind={containerKind}
						rootId={node.id}
						loopUntil={node.loop?.until}
						loopMax={node.loop?.maxIterations}
						selected={selected}
						onSelect={() => onSelect(node)}
					>
						{children.map((child, i) => (
							<PipelineNodeGraph
								key={nodeSelectionKey(child)}
								node={child}
								n={i + 1}
								selectedKey={selectedKey}
								onSelect={onSelect}
								isLast={i === children.length - 1}
								showSiblingEdge={node.kind !== "parallel"}
							/>
						))}
					</PipelineContainer>
				</>
			)}
			{showSiblingEdge && !isLast && <Edge />}
		</>
	);
}

/* ── Pipeline inspector for the selected step ──────────────────────────── */
function PipelineInspector({
	root,
	selected,
	rootManifest,
	catalog,
	availableState,
	onRemoveSelected,
	onMoveSelected,
	onPatchInputMap,
	onPatchAgent,
	onEditRequest,
	canMoveUp,
	canMoveDown,
}: {
	root: PipelineNode;
	selected: PipelineNode;
	rootManifest: Record<string, unknown>;
	catalog?: Catalog;
	availableState: StateRef[];
	onRemoveSelected?: () => void;
	onMoveSelected?: (delta: -1 | 1) => void;
	onPatchInputMap?: (
		stepPath: PipelinePath,
		key: string,
		value: string | undefined,
	) => void;
	onPatchAgent?: (
		agentPath: PipelinePath,
		partial: Record<string, unknown>,
	) => void;
	onEditRequest?: (
		selection: ManifestSelection,
		changeDescription: string,
	) => Promise<void> | void;
	canMoveUp?: boolean;
	canMoveDown?: boolean;
}) {
	const inputs = (selected.inputSchema ?? []).map((f) => ({
		name: f.key,
		type: f.type,
		required: !f.nullable && f.default === undefined,
	}));
	const inputMap = selected.inputMap ?? {};

	return (
		<aside
			style={{
				background: ag.surface,
				display: "flex",
				flexDirection: "column",
				minHeight: 0,
				borderLeft: `1px solid ${ag.line2}`,
			}}
		>
			<div
				style={{
					padding: "11px 16px",
					borderBottom: `1px solid ${ag.line2}`,
					background: ag.surface,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						marginBottom: 4,
					}}
				>
					<Mono size={10.5} color={ag.muted}>
						{root.id}
					</Mono>
					{selected.id !== root.id && (
						<>
							<I.ChevR size={9} />
							<Mono size={10.5} color={ag.muted}>
								{selected.id === root.id ? "root" : "step"}
							</Mono>
						</>
					)}
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<Tag bg={ag.blueBg} color={ag.blue} mono>
						{selected.kind === "llm" ? "LLM" : selected.kind}
					</Tag>
					<div style={{ fontWeight: 500, fontSize: 14, flex: 1 }}>
						{selected.name}
					</div>
					<Mono size={10.5} color={ag.muted}>
						{selected.id}
					</Mono>
				</div>
				{selected.id !== root.id && (onRemoveSelected || onMoveSelected) && (
					<div
						style={{
							display: "flex",
							gap: 6,
							marginTop: 8,
							alignItems: "center",
						}}
					>
						<StepHeaderBtn
							title="Move step up"
							disabled={!canMoveUp}
							onClick={() => onMoveSelected?.(-1)}
						>
							<I.Chev size={11} style={{ transform: "rotate(180deg)" }} />
						</StepHeaderBtn>
						<StepHeaderBtn
							title="Move step down"
							disabled={!canMoveDown}
							onClick={() => onMoveSelected?.(1)}
						>
							<I.Chev size={11} />
						</StepHeaderBtn>
						<div style={{ flex: 1 }} />
						{onRemoveSelected && (
							<button
								type="button"
								onClick={onRemoveSelected}
								title="Remove step"
								style={{
									border: `1px solid ${ag.line}`,
									background: ag.surface2,
									color: ag.danger,
									cursor: "pointer",
									borderRadius: 4,
									padding: "3px 8px",
									fontSize: 11.5,
									fontFamily: "inherit",
									display: "inline-flex",
									alignItems: "center",
									gap: 4,
								}}
							>
								<I.X size={10} />
								Remove
							</button>
						)}
					</div>
				)}
			</div>

			<div style={{ flex: 1, overflow: "auto" }}>
				{onEditRequest && (
					<AiEditBox
						targetLabel={selected.id === root.id ? "root agent" : selected.name}
						onSubmit={(description) =>
							onEditRequest(selectionForNode(selected), description)
						}
					/>
				)}

				{/* Input mapping (non-root) / Input schema (root) */}
				<div style={{ padding: "16px 16px 8px" }}>
					<div style={{ marginBottom: 4 }}>
						<div
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: ag.ink,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
							}}
						>
							{selected.id === root.id ? "Input schema" : "Input mapping"}
						</div>
						<div style={{ fontSize: 11.5, color: ag.muted, marginTop: 4 }}>
							{selected.id === root.id
								? "Fields the caller passes in. Available as {{name}} in any step's input map."
								: `Pipeline state → ${selected.name}'s declared inputs.`}
						</div>
					</div>

					{selected.id === root.id ? (
						<div style={{ marginTop: 10 }}>
							<SchemaEditor
								kind="input"
								schema={
									rootManifest.inputSchema as
										| Record<string, unknown>
										| undefined
								}
								onChange={
									onPatchAgent
										? (next) => onPatchAgent([], { inputSchema: next })
										: () => {}
								}
								emptyMessage="No inputs declared. The pipeline will use the caller's raw message."
							/>
						</div>
					) : (
						<>
							<div
								style={{
									marginTop: 10,
									border: `1px solid ${ag.line}`,
									borderRadius: 4,
									background: ag.surface2,
									overflow: "hidden",
								}}
							>
								{inputs.length === 0 ? (
									<div
										style={{
											padding: 12,
											fontSize: 11.5,
											color: ag.muted,
											textAlign: "center",
										}}
									>
										No inputs declared on this step.
									</div>
								) : (
									inputs.map((f, i) => {
										const wired = inputMap[f.name];
										return (
											<PipelineBindRow
												key={f.name}
												target={f.name}
												type={f.type}
												required={f.required}
												wired={wired}
												isRoot={false}
												availableState={availableState}
												last={i === inputs.length - 1}
												onBind={
													onPatchInputMap && selected.stepPath
														? (value) =>
																onPatchInputMap(
																	selected.stepPath!,
																	f.name,
																	value,
																)
														: undefined
												}
											/>
										);
									})
								)}
							</div>
							<Mono
								size={10.5}
								color={ag.muted}
								style={{ marginTop: 6, display: "inline-block" }}
							>
								Click any binding chip to wire it to upstream state.
							</Mono>
						</>
					)}
				</div>

				{/* Available state */}
				<div style={{ padding: "8px 16px 14px" }}>
					<div
						style={{
							display: "flex",
							alignItems: "baseline",
							justifyContent: "space-between",
							marginBottom: 8,
						}}
					>
						<div
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: ag.ink,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
							}}
						>
							Available state
						</div>
						<Mono size={10} color={ag.muted}>
							click a chip above →
						</Mono>
					</div>
					<div
						style={{
							border: `1px solid ${ag.line2}`,
							borderRadius: 4,
							background: ag.bg,
							overflow: "hidden",
						}}
					>
						{availableState.length === 0 ? (
							<div
								style={{
									padding: 8,
									fontSize: 11,
									color: ag.muted,
									textAlign: "center",
								}}
							>
								Nothing in scope.
							</div>
						) : (
							availableState.map((s, i) => (
								<StateLine
									key={s.key}
									name={s.key}
									type={s.type}
									origin={s.source === "input" ? "input" : "upstream"}
									last={i === availableState.length - 1}
								/>
							))
						)}
					</div>
				</div>

				{/* Agent settings — editable when the selected step is an LLM and we
            have a patch callback. Falls back to a read-only summary for
            non-LLM steps (tool / sub-pipeline) since those edits aren't wired
            here yet. */}
				<div style={{ borderTop: `1px solid ${ag.line2}` }}>
					{selected.kind === "llm" && onPatchAgent ? (
						<LLMStepEditor
							agentPath={selected.agentPath}
							rootManifest={rootManifest}
							catalog={catalog}
							onPatchAgent={onPatchAgent}
							currentAgentId={selected.id}
							outputSchemaCount={selected.outputSchemaKeys?.length ?? 0}
						/>
					) : selected.kind === "tool" && onPatchAgent ? (
						<ToolStepEditor
							agentPath={selected.agentPath}
							rootManifest={rootManifest}
							catalog={catalog}
							onPatchAgent={onPatchAgent}
						/>
					) : (selected.kind === "sequential" ||
							selected.kind === "parallel") &&
						onPatchAgent ? (
						<PipelineKindEditor
							node={selected}
							rootManifest={rootManifest}
							onPatchAgent={onPatchAgent}
							isRoot={selected.id === root.id}
						/>
					) : (
						<InsSection
							title="Agent settings"
							badge={
								selected.kind === "llm" ? "model · instruction" : selected.kind
							}
							defaultOpen
						>
							{selected.description && (
								<SubBlock
									label="Description"
									value={selected.description}
									multiline
								/>
							)}
							{selected.model && (
								<SubBlock
									label="Model"
									value={`${selected.model.provider} · ${selected.model.name}`}
									mono
									select
								/>
							)}
							{selected.instructionPreview && (
								<SubBlock
									label="Instruction"
									value={selected.instructionPreview}
									mono
									multiline
								/>
							)}
							{selected.outputSchemaKeys &&
								selected.outputSchemaKeys.length > 0 && (
									<SubBlock
										label={`Output schema · ${selected.outputSchemaKeys.length} field${selected.outputSchemaKeys.length === 1 ? "" : "s"}`}
										value={selected.outputSchemaKeys
											.map((k) => `${k.key}: ${k.type}`)
											.join(", ")}
										mono
									/>
								)}
						</InsSection>
					)}

					{selected.stepPath && (
						<InsSection title="Step config" badge="state key · when">
							<div
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: 8,
								}}
							>
								<Field
									inline
									label="State key"
									value={selected.stateKey ?? selected.id}
									mono
									hint={`output as {{${selected.stateKey ?? selected.id}}}`}
								/>
								<Field inline label="When" value="—" mono hint="always runs" />
							</div>
						</InsSection>
					)}
				</div>
			</div>

			<FooterHint>
				{selected.id === root.id
					? `Templates can reference the ${inputs.length} pipeline input${inputs.length === 1 ? "" : "s"} above.`
					: `Templates & tools inside ${selected.name} can only use its ${inputs.length} mapped input${inputs.length === 1 ? "" : "s"}.`}
			</FooterHint>
		</aside>
	);
}

function StepHeaderBtn({
	title,
	disabled,
	onClick,
	children,
}: {
	title: string;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			style={{
				border: `1px solid ${ag.line}`,
				background: ag.surface2,
				color: disabled ? ag.muted : ag.text2,
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.5 : 1,
				borderRadius: 4,
				width: 22,
				height: 22,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 0,
			}}
		>
			{children}
		</button>
	);
}

function AiEditBox({
	targetLabel,
	onSubmit,
}: {
	targetLabel: string;
	onSubmit: (description: string) => Promise<void> | void;
}) {
	const [description, setDescription] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleApply = async () => {
		const trimmed = description.trim();
		if (!trimmed || pending) return;
		setPending(true);
		setError(null);
		try {
			await onSubmit(trimmed);
			setDescription("");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPending(false);
		}
	};

	return (
		<div
			style={{
				margin: "12px 16px 0",
				padding: 10,
				border: `1px solid ${ag.line}`,
				borderRadius: 4,
				background: ag.surface2,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
					marginBottom: 6,
				}}
			>
				<Mono size={10.5} color={ag.muted}>
					Edit with AI · {targetLabel}
				</Mono>
				{pending && <SpinnerInline />}
			</div>
			<textarea
				value={description}
				onChange={(e) => setDescription(e.target.value)}
				placeholder="Describe the change"
				rows={3}
				spellCheck={false}
				style={{
					display: "block",
					width: "100%",
					border: `1px solid ${ag.line}`,
					borderRadius: 4,
					background: ag.bg,
					padding: "7px 8px",
					fontFamily: "inherit",
					fontSize: 12,
					lineHeight: 1.45,
					resize: "vertical",
					color: ag.ink,
					outline: "none",
				}}
			/>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginTop: 8,
				}}
			>
				<Btn
					variant="secondary"
					size="sm"
					icon={<I.Sparkle size={11} style={{ marginRight: 5 }} />}
					onClick={handleApply}
					disabled={pending || !description.trim()}
				>
					Apply draft
				</Btn>
				{error && (
					<span style={{ color: ag.danger, fontSize: 11.5 }}>{error}</span>
				)}
			</div>
		</div>
	);
}

function SpinnerInline() {
	return (
		<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
			<span
				style={{
					width: 10,
					height: 10,
					border: `1.5px solid ${ag.line}`,
					borderTopColor: ag.ink,
					borderRadius: "50%",
					display: "inline-block",
					animation: "agntz-spin 0.7s linear infinite",
				}}
			/>
			<Mono size={10.5} color={ag.muted}>
				editing
			</Mono>
		</span>
	);
}

/* ── Interactive input-mapping row for the pipeline inspector ──────────── */

function PipelineBindRow({
	target,
	type,
	required,
	wired,
	isRoot,
	availableState,
	last,
	onBind,
}: {
	target: string;
	type: string;
	required?: boolean;
	wired: string | undefined;
	isRoot: boolean;
	availableState: StateRef[];
	last?: boolean;
	onBind?: (value: string | undefined) => void;
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);

	const interactive = !!onBind && !isRoot;
	const chip = wired
		? {
				label: wired.replace(/^\{\{|\}\}$/g, ""),
				bg: ag.warnBg,
				fg: ag.warn,
				isVar: true,
			}
		: isRoot
			? { label: "from caller", bg: ag.line2, fg: ag.text2, isVar: false }
			: { label: "unbound", bg: ag.bg, fg: ag.text2, isVar: false };

	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "minmax(80px, 1fr) auto 1fr",
				padding: "7px 10px",
				gap: 8,
				alignItems: "center",
				fontSize: 12,
				borderBottom: last ? "0" : `1px solid ${ag.line2}`,
			}}
		>
			<div
				style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
			>
				<Mono size={12}>{target}</Mono>
				{required && (
					<span title="required" style={{ color: ag.warn, fontSize: 10 }}>
						•
					</span>
				)}
				<Mono size={10.5} color={ag.muted}>
					{type}
				</Mono>
			</div>
			<I.ArrowR
				size={11}
				style={{ color: ag.muted, transform: "rotate(180deg)" }}
			/>
			<button
				ref={triggerRef}
				type="button"
				disabled={!interactive}
				onClick={() => setOpen((o) => !o)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 5,
					padding: "2px 6px",
					background: chip.bg,
					border: "1px solid transparent",
					borderRadius: 3,
					cursor: interactive ? "pointer" : "default",
					minWidth: 0,
					overflow: "hidden",
					fontFamily: "inherit",
					opacity: interactive ? 1 : 0.85,
				}}
			>
				{chip.isVar ? (
					<VarHl>
						<Mono size={11}>{chip.label}</Mono>
					</VarHl>
				) : (
					<Mono
						size={10.5}
						color={chip.fg}
						style={{
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							fontWeight: 500,
						}}
					>
						{chip.label}
					</Mono>
				)}
				{interactive && (
					<I.Chev
						size={9}
						style={{
							color: chip.fg,
							marginLeft: "auto",
							flex: "0 0 auto",
							opacity: 0.7,
						}}
					/>
				)}
			</button>
			{interactive && (
				<Popover
					open={open}
					onClose={() => setOpen(false)}
					anchorRef={triggerRef}
					width={260}
				>
					<div style={{ padding: 6 }}>
						<div
							style={{
								padding: "4px 8px 6px",
								fontSize: 10.5,
								color: ag.muted,
								fontFamily: "var(--font-mono)",
								textTransform: "uppercase",
								letterSpacing: "0.08em",
							}}
						>
							Available state
						</div>
						{availableState.length === 0 ? (
							<div
								style={{
									padding: 10,
									fontSize: 11.5,
									color: ag.muted,
									textAlign: "center",
								}}
							>
								Nothing in scope yet.
							</div>
						) : (
							availableState.map((s) => (
								<button
									key={s.key}
									type="button"
									onClick={() => {
										onBind?.(`{{${s.key}}}`);
										setOpen(false);
									}}
									style={{
										display: "flex",
										width: "100%",
										alignItems: "center",
										gap: 6,
										padding: "5px 8px",
										border: 0,
										background: "transparent",
										cursor: "pointer",
										borderRadius: 3,
										fontFamily: "var(--font-mono)",
										fontSize: 11.5,
										color: ag.ink,
										textAlign: "left",
									}}
									onMouseEnter={(e) =>
										(e.currentTarget.style.background = ag.surfaceWarm)
									}
									onMouseLeave={(e) =>
										(e.currentTarget.style.background = "transparent")
									}
								>
									<span
										style={{
											background: ag.warnBg,
											color: ag.warn,
											borderRadius: 2,
											padding: "0 4px",
										}}
									>
										{`{{${s.key}}}`}
									</span>
									<span style={{ flex: 1 }} />
									<Mono size={10} color={ag.muted}>
										{s.type}
									</Mono>
								</button>
							))
						)}
						{wired && (
							<>
								<div
									style={{ height: 1, background: ag.line2, margin: "6px 4px" }}
								/>
								<button
									type="button"
									onClick={() => {
										onBind?.(undefined);
										setOpen(false);
									}}
									style={{
										display: "block",
										width: "100%",
										padding: "5px 8px",
										border: 0,
										background: "transparent",
										cursor: "pointer",
										borderRadius: 3,
										fontSize: 11.5,
										color: ag.danger,
										textAlign: "left",
										fontFamily: "inherit",
									}}
									onMouseEnter={(e) =>
										(e.currentTarget.style.background = ag.surfaceWarm)
									}
									onMouseLeave={(e) =>
										(e.currentTarget.style.background = "transparent")
									}
								>
									Unbind
								</button>
							</>
						)}
					</div>
				</Popover>
			)}
		</div>
	);
}

/* ── LLMStepEditor — editable Agent settings / Tools / Output / Examples
 *    for a kind=llm step. Reads the live agent record from rootManifest at
 *    `agentPath` and writes back via onPatchAgent. */
function LLMStepEditor({
	agentPath,
	rootManifest,
	catalog,
	onPatchAgent,
	currentAgentId,
	outputSchemaCount,
}: {
	agentPath: PipelinePath;
	rootManifest: Record<string, unknown>;
	catalog?: Catalog;
	onPatchAgent: (
		agentPath: PipelinePath,
		partial: Record<string, unknown>,
	) => void;
	currentAgentId: string;
	outputSchemaCount: number;
}) {
	const liveAgent = (() => {
		const raw = getIn(rootManifest, agentPath);
		return isRecord(raw) ? raw : {};
	})();

	const description = (liveAgent.description as string | undefined) ?? "";
	const model = (liveAgent.model as Record<string, unknown> | undefined) ?? {};
	const instruction = (liveAgent.instruction as string | undefined) ?? "";
	const tools =
		(liveAgent.tools as Array<Record<string, unknown>> | undefined) ?? [];
	const outputSchema = liveAgent.outputSchema as
		| Record<string, unknown>
		| undefined;
	const examples = (liveAgent.examples as Example[] | undefined) ?? [];

	const patch = (partial: Record<string, unknown>) =>
		onPatchAgent(agentPath, partial);
	const patchModel = (next: Partial<Record<string, unknown>>) => {
		const merged: Record<string, unknown> = { ...model };
		for (const [k, v] of Object.entries(next)) {
			if (v === undefined) delete merged[k];
			else merged[k] = v;
		}
		patch({ model: Object.keys(merged).length === 0 ? undefined : merged });
	};

	return (
		<>
			<InsSection
				title="Agent settings"
				badge="model · instruction"
				defaultOpen
			>
				<EditableText
					label="Description"
					value={description}
					onChange={(v) => patch({ description: v || undefined })}
					placeholder="What does this step do?"
					multiline
					rows={2}
				/>
				<ModelPicker
					value={{
						provider: (model.provider as string | undefined) ?? "",
						name: (model.name as string | undefined) ?? "",
					}}
					providers={catalog?.providers ?? []}
					modelsByProvider={catalog?.modelsByProvider}
					loadProviderModels={catalog?.loadProviderModels}
					loading={catalog?.loading}
					onChange={(next) =>
						patchModel({ provider: next.provider, name: next.name })
					}
				/>
				<EditableText
					label="Instruction"
					value={instruction}
					onChange={(v) => patch({ instruction: v || undefined })}
					placeholder="Step's system prompt. Use {{var}} for inputs."
					multiline
					rows={6}
					mono
				/>
			</InsSection>

			<InsSection title="Tools" badge={`${tools.length} attached`}>
				<ToolsEditor
					tools={tools as ToolEntry[]}
					onChange={(next) =>
						patch({ tools: next as Array<Record<string, unknown>> | undefined })
					}
					mcpServers={catalog?.mcpServers ?? []}
					localTools={catalog?.tools ?? []}
					agents={catalog?.agents ?? []}
					loadMcpTools={catalog?.loadMcpTools ?? (async () => [])}
					loadMcpToolsForUrl={catalog?.loadMcpToolsForUrl}
					mcpToolsByServer={catalog?.mcpToolsByServer ?? {}}
					currentAgentId={currentAgentId}
					rootManifest={rootManifest}
				/>
			</InsSection>

			<InsSection
				title="Output schema"
				badge={`${outputSchemaCount} field${outputSchemaCount === 1 ? "" : "s"}`}
			>
				<SchemaEditor
					kind="output"
					schema={outputSchema}
					onChange={(next) => patch({ outputSchema: next })}
				/>
			</InsSection>

			<InsSection title="Examples" badge={`${examples.length} pinned`}>
				<ExamplesEditor
					examples={examples}
					onChange={(next) =>
						patch({ examples: next?.length ? next : undefined })
					}
				/>
			</InsSection>

			<InsSection title="Advanced">
				<div
					style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
				>
					<EditableNumber
						label="Temperature"
						value={
							typeof model.temperature === "number"
								? model.temperature
								: undefined
						}
						onChange={(v) => patchModel({ temperature: v })}
						min={0}
						max={2}
						step={0.1}
						placeholder="—"
						hint="0–2, blank = provider default"
					/>
					<EditableNumber
						label="Max tokens"
						value={
							typeof model.maxTokens === "number" ? model.maxTokens : undefined
						}
						onChange={(v) => patchModel({ maxTokens: v })}
						min={1}
						step={1}
						placeholder="—"
					/>
				</div>
			</InsSection>
		</>
	);
}

/* ── ToolStepEditor — editable Tool config for a kind=tool step.
 *    Backing shape is ToolCallConfig: { kind: "local" | "mcp" | "http"; ... }.
 *    When kind=mcp and server matches a catalog entry, the tool name resolves
 *    from `loadMcpTools()` so users pick from a real list instead of typing. */
function ToolStepEditor({
	agentPath,
	rootManifest,
	catalog,
	onPatchAgent,
}: {
	agentPath: PipelinePath;
	rootManifest: Record<string, unknown>;
	catalog?: Catalog;
	onPatchAgent: (
		agentPath: PipelinePath,
		partial: Record<string, unknown>,
	) => void;
}) {
	const liveAgent = (() => {
		const raw = getIn(rootManifest, agentPath);
		return isRecord(raw) ? raw : {};
	})();
	const description = (liveAgent.description as string | undefined) ?? "";
	const tool = isRecord(liveAgent.tool) ? liveAgent.tool : {};
	const toolKind: "local" | "mcp" | "http" =
		tool.kind === "mcp" ? "mcp" : tool.kind === "http" ? "http" : "local";
	const toolName = (tool.name as string | undefined) ?? "";
	const toolServer = (tool.server as string | undefined) ?? "";
	const toolUrl = (tool.url as string | undefined) ?? "";
	const toolMethod = (tool.method as "GET" | undefined) ?? "GET";
	const toolDescription = (tool.description as string | undefined) ?? "";
	const toolParams = isRecord(tool.params)
		? (tool.params as Record<string, string>)
		: undefined;
	const toolHeaders = isRecord(tool.headers)
		? (tool.headers as Record<string, string>)
		: undefined;

	const patchTool = (next: Partial<Record<string, unknown>>) => {
		const merged: Record<string, unknown> = { ...tool };
		for (const [k, v] of Object.entries(next)) {
			if (v === undefined) delete merged[k];
			else merged[k] = v;
		}
		onPatchAgent(agentPath, { tool: merged });
	};

	// Switching kinds clears stale fields so the persisted manifest stays clean.
	const switchKind = (next: "local" | "mcp" | "http") => {
		if (next === toolKind) return;
		patchTool({
			kind: next,
			// mcp-only
			server: next === "mcp" ? toolServer || undefined : undefined,
			// http-only
			url: next === "http" ? toolUrl || "" : undefined,
			method: undefined,
			description: next === "http" ? toolDescription || undefined : undefined,
			headers: next === "http" ? toolHeaders : undefined,
		});
	};

	// MCP tool resolution — fetch tool list when the server matches a catalog entry.
	const matchedMcpServer = useMemo(() => {
		if (toolKind !== "mcp" || !toolServer || !catalog) return null;
		return catalog.mcpServers.find((s) => s.id === toolServer) ?? null;
	}, [catalog, toolKind, toolServer]);

	useEffect(() => {
		if (matchedMcpServer && catalog) {
			void catalog.loadMcpTools(matchedMcpServer.id);
		}
	}, [matchedMcpServer, catalog]);

	const availableMcpTools = matchedMcpServer
		? catalog?.mcpToolsByServer[matchedMcpServer.id]
		: undefined;
	const mcpToolsLoading =
		matchedMcpServer != null && availableMcpTools === undefined;

	return (
		<InsSection
			title="Tool"
			badge={`${toolKind} · ${toolName || "(unnamed)"}`}
			defaultOpen
		>
			<EditableText
				label="Description"
				value={description}
				onChange={(v) =>
					onPatchAgent(agentPath, { description: v || undefined })
				}
				placeholder="What does this step do?"
				multiline
				rows={2}
			/>

			<div>
				<div
					style={{
						fontSize: 10.5,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: ag.muted,
						fontWeight: 500,
						marginBottom: 6,
					}}
				>
					Kind
				</div>
				<div
					style={{
						display: "flex",
						padding: 2,
						background: ag.surface2,
						border: `1px solid ${ag.line}`,
						borderRadius: 4,
						width: "fit-content",
					}}
				>
					{(["local", "mcp", "http"] as const).map((k) => {
						const on = toolKind === k;
						return (
							<button
								key={k}
								type="button"
								onClick={() => switchKind(k)}
								style={{
									padding: "4px 10px",
									borderRadius: 3,
									fontSize: 12,
									background: on ? ag.bg : "transparent",
									color: on ? ag.ink : ag.text2,
									border: "none",
									cursor: "pointer",
									fontWeight: 500,
									fontFamily: "var(--font-mono)",
								}}
							>
								{k}
							</button>
						);
					})}
				</div>
			</div>

			{toolKind === "mcp" && (
				<EditableText
					label="Server"
					value={toolServer}
					onChange={(v) => patchTool({ server: v || undefined })}
					placeholder="server-id or https://mcp.example.com/sse"
					mono
				/>
			)}

			{toolKind === "mcp" && matchedMcpServer ? (
				mcpToolsLoading ? (
					<div>
						<div
							style={{
								fontSize: 10.5,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								color: ag.muted,
								fontWeight: 500,
								marginBottom: 6,
							}}
						>
							Tool
						</div>
						<div style={{ fontSize: 11.5, color: ag.muted }}>
							Loading tools…
						</div>
					</div>
				) : availableMcpTools && availableMcpTools.length > 0 ? (
					<EditableSelect
						label="Tool"
						value={toolName}
						options={[
							["", "— pick a tool —"] as const,
							...availableMcpTools.map((t) => [t, t] as const),
						]}
						onChange={(v) => patchTool({ name: v })}
					/>
				) : (
					<div>
						<div
							style={{
								fontSize: 10.5,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								color: ag.muted,
								fontWeight: 500,
								marginBottom: 6,
							}}
						>
							Tool
						</div>
						<div style={{ fontSize: 11.5, color: ag.muted }}>
							This server exposes no tools.
						</div>
					</div>
				)
			) : (
				<EditableText
					label="Name"
					value={toolName}
					onChange={(v) => patchTool({ name: v })}
					placeholder={toolKind === "http" ? "tool_label" : "tool_name"}
					mono
				/>
			)}

			{toolKind === "http" && (
				<>
					<EditableText
						label="URL"
						value={toolUrl}
						onChange={(v) => patchTool({ url: v })}
						placeholder="https://api.example.com/things/{id}"
						mono
					/>
					<EditableSelect
						label="Method"
						value={toolMethod}
						options={HTTP_METHODS}
						onChange={(v) => patchTool({ method: v === "GET" ? undefined : v })}
					/>
					<EditableText
						label="Description (shown to the model)"
						value={toolDescription}
						onChange={(v) => patchTool({ description: v || undefined })}
						placeholder="optional"
						multiline
						rows={2}
					/>
					<ParamsEditor
						label="Headers"
						value={toolHeaders}
						onChange={(next) => patchTool({ headers: next })}
						keyPlaceholder="X-Header-Name"
						valuePlaceholder="{{secrets.token}}"
						hint="values support {{secrets.X}}"
					/>
				</>
			)}

			<ParamsEditor
				label="Pinned params"
				value={toolParams}
				onChange={(next) => patchTool({ params: next })}
				keyPlaceholder="placeholder"
				valuePlaceholder={
					toolKind === "http" ? "{{state.value}}" : "{{user_id}}"
				}
				hint={
					toolKind === "http"
						? "URL/query placeholders → state templates"
						: "placeholder → state template"
				}
			/>
		</InsSection>
	);
}

/* ── PipelineInstructionPanel — thin wrapper that resolves the selected
 *    LLM step's live agent record from rootManifest and binds the
 *    InstructionPanel's onChange handlers to patchAgentAt at that path. */
function PipelineInstructionPanel({
	selectedNode,
	rootManifest,
	onPatchAgent,
}: {
	selectedNode: PipelineNode;
	rootManifest: Record<string, unknown>;
	onPatchAgent?: (
		agentPath: PipelinePath,
		partial: Record<string, unknown>,
	) => void;
}) {
	const liveAgent = (() => {
		const raw = getIn(rootManifest, selectedNode.agentPath);
		return isRecord(raw) ? raw : {};
	})();
	const instruction = (liveAgent.instruction as string | undefined) ?? "";
	const prompt = (liveAgent.prompt as string | undefined) ?? "";

	return (
		<InstructionPanel
			agentName={selectedNode.name}
			agentId={selectedNode.id}
			instruction={instruction}
			prompt={prompt}
			onChangeInstruction={
				onPatchAgent
					? (v) =>
							onPatchAgent(selectedNode.agentPath, {
								instruction: v || undefined,
							})
					: undefined
			}
			onChangePrompt={
				onPatchAgent
					? (v) =>
							onPatchAgent(selectedNode.agentPath, { prompt: v || undefined })
					: undefined
			}
		/>
	);
}

/* ── PipelineKindEditor — description, kind toggle (sequential↔parallel),
 *    and loop config (sequential only) for a container node. Switching
 *    kinds renames the child container (steps↔branches) and drops the
 *    sequential-only loop fields (until/maxIterations) on the way to
 *    parallel. */
function PipelineKindEditor({
	node,
	rootManifest,
	onPatchAgent,
	isRoot,
}: {
	node: PipelineNode;
	rootManifest: Record<string, unknown>;
	onPatchAgent: (
		agentPath: PipelinePath,
		partial: Record<string, unknown>,
	) => void;
	isRoot: boolean;
}) {
	const liveAgent = (() => {
		const raw = getIn(rootManifest, node.agentPath);
		return isRecord(raw) ? raw : {};
	})();
	const currentKind: "sequential" | "parallel" =
		liveAgent.kind === "parallel" ? "parallel" : "sequential";
	const description = (liveAgent.description as string | undefined) ?? "";
	const until = (liveAgent.until as string | undefined) ?? "";
	const maxIterations =
		typeof liveAgent.maxIterations === "number"
			? (liveAgent.maxIterations as number)
			: undefined;
	const isLoop = currentKind === "sequential" && until.trim().length > 0;

	// Convert seq↔par by moving the child container under its new key and
	// clearing fields that don't apply to the next kind.
	const switchKind = (next: "sequential" | "parallel") => {
		if (next === currentKind) return;
		if (next === "parallel") {
			onPatchAgent(node.agentPath, {
				kind: "parallel",
				branches: liveAgent.steps,
				steps: undefined,
				until: undefined,
				maxIterations: undefined,
			});
		} else {
			onPatchAgent(node.agentPath, {
				kind: "sequential",
				steps: liveAgent.branches,
				branches: undefined,
			});
		}
	};

	const applyLoop = (next: { until?: string; maxIterations?: number }) => {
		const nextUntil = next.until?.trim();
		// Clearing the until also clears maxIterations — "max" without a condition
		// isn't meaningful since a sequential runs its steps exactly once.
		if (!nextUntil) {
			onPatchAgent(node.agentPath, {
				until: undefined,
				maxIterations: undefined,
			});
			return;
		}
		onPatchAgent(node.agentPath, {
			until: nextUntil,
			maxIterations: next.maxIterations,
		});
	};

	return (
		<>
			<InsSection
				title={isRoot ? "Pipeline" : "Sub-pipeline"}
				badge={isLoop ? "loop" : currentKind}
				defaultOpen
			>
				<EditableText
					label="Description"
					value={description}
					onChange={(v) =>
						onPatchAgent(node.agentPath, { description: v || undefined })
					}
					placeholder={
						isRoot
							? "What does this pipeline do?"
							: "What does this sub-pipeline do?"
					}
					multiline
					rows={2}
				/>

				<div>
					<div
						style={{
							fontSize: 10.5,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: ag.muted,
							fontWeight: 500,
							marginBottom: 6,
						}}
					>
						Kind
					</div>
					<div
						style={{
							display: "flex",
							padding: 2,
							background: ag.surface2,
							border: `1px solid ${ag.line}`,
							borderRadius: 4,
							width: "fit-content",
						}}
					>
						{(["sequential", "parallel"] as const).map((k) => {
							const on = currentKind === k;
							return (
								<button
									key={k}
									type="button"
									onClick={() => switchKind(k)}
									style={{
										padding: "4px 10px",
										borderRadius: 3,
										fontSize: 12,
										background: on ? ag.bg : "transparent",
										color: on ? ag.ink : ag.text2,
										border: "none",
										cursor: "pointer",
										fontWeight: 500,
										fontFamily: "var(--font-mono)",
									}}
								>
									{k}
								</button>
							);
						})}
					</div>
					<Mono
						size={10.5}
						color={ag.muted}
						style={{ marginTop: 6, display: "inline-block" }}
					>
						Switching to parallel drops the loop config; switching back leaves
						it cleared.
					</Mono>
				</div>
			</InsSection>

			{currentKind === "sequential" && (
				<InsSection
					title="Loop"
					badge={isLoop ? `until ${until}` : "off"}
					defaultOpen={isLoop}
				>
					<Mono size={10.5} color={ag.muted}>
						When set, the steps re-run until <code>until</code> is truthy
						(templated against the latest state).
					</Mono>
					<EditableText
						label="Until (state template)"
						value={until}
						onChange={(v) =>
							applyLoop({ until: v || undefined, maxIterations })
						}
						placeholder="{{step.done}}"
						mono
					/>
					<EditableNumber
						label="Max iterations"
						value={maxIterations}
						onChange={(v) =>
							applyLoop({
								until: until || undefined,
								maxIterations: v,
							})
						}
						min={1}
						step={1}
						placeholder="—"
						hint="blank = unbounded (use carefully)"
					/>
					{isLoop && (
						<button
							type="button"
							onClick={() =>
								applyLoop({ until: undefined, maxIterations: undefined })
							}
							style={{
								border: `1px solid ${ag.line}`,
								background: ag.surface2,
								color: ag.danger,
								cursor: "pointer",
								borderRadius: 4,
								padding: "4px 9px",
								fontSize: 11.5,
								fontFamily: "inherit",
								alignSelf: "flex-start",
							}}
						>
							Turn off loop
						</button>
					)}
				</InsSection>
			)}
		</>
	);
}
