"use client";

// Vertical pipeline canvas. Renders a PipelineNode tree as nested cards:
// sequential steps stack, parallel branches sit side-by-side, loops wrap
// their steps with an "↻ UNTIL ..." footer pill. Click anywhere on a block
// to select it — selection drives the right-hand inspector.

import { Fragment, type ReactNode } from "react";
import {
	FONT_DISPLAY,
	FONT_MONO,
	FONT_SANS,
	KIND_COLORS,
	NEUTRAL,
	type PipelineKind,
} from "./pipeline-tokens";
import type { PipelineNode } from "./pipeline-types";

interface PipelineCanvasProps {
	pipeline: PipelineNode;
	selectedId: string;
	onSelect: (id: string) => void;
	onAddStep?: (parent: PipelineNode, index: number) => void;
}

export function PipelineCanvas({
	pipeline,
	selectedId,
	onSelect,
	onAddStep,
}: PipelineCanvasProps) {
	return (
		<div
			style={{
				background: NEUTRAL.paperBg,
				backgroundImage: `radial-gradient(circle, ${NEUTRAL.borderStrong} 0.7px, transparent 0.7px)`,
				backgroundSize: "20px 20px",
				backgroundPosition: "12px 12px",
				padding: "20px 24px 32px",
				minHeight: 480,
				overflow: "auto",
				fontFamily: FONT_SANS,
			}}
			onClick={() => onSelect(pipeline.id)}
		>
			<div style={{ maxWidth: 720, margin: "0 auto" }}>
				<Endcap label="INPUT" schema={pipeline.inputSchema} />
				<Arrow />
				<PipelineNodeView
					node={pipeline}
					selectedId={selectedId}
					onSelect={onSelect}
					onAddStep={onAddStep}
				/>
				<Arrow />
				<Endcap label="OUTPUT" empty="stateKey on root → final output" />
			</div>
		</div>
	);
}

// ─── Recursive renderer ──────────────────────────────────────────────────

interface NodeViewProps {
	node: PipelineNode;
	selectedId: string;
	onSelect: (id: string) => void;
	onAddStep?: (parent: PipelineNode, index: number) => void;
}

function PipelineNodeView({
	node,
	selectedId,
	onSelect,
	onAddStep,
}: NodeViewProps) {
	const isContainer = node.kind === "sequential" || node.kind === "parallel";
	if (!isContainer) {
		return (
			<Block
				node={node}
				selected={selectedId === node.id}
				onSelect={onSelect}
			/>
		);
	}

	const c = KIND_COLORS[node.kind];
	const selected = selectedId === node.id;

	return (
		<div
			onClick={(event) => {
				event.stopPropagation();
				onSelect(node.id);
			}}
			style={{
				background: c.bg,
				border: `1px solid ${selected ? c.accent : c.border}`,
				boxShadow: selected
					? `0 0 0 3px ${c.bgHeader}, 0 2px 6px rgba(0,0,0,0.04)`
					: "0 1px 2px rgba(0,0,0,0.03)",
				borderRadius: 10,
				cursor: "pointer",
				transition: "box-shadow 120ms, border-color 120ms",
			}}
		>
			<ContainerHeader node={node} />

			<div style={{ padding: "10px 12px 12px" }}>
				{node.kind === "parallel" ? (
					<div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
						{(node.branches ?? []).map((branch) => (
							<div key={branch.id} style={{ flex: 1, minWidth: 0 }}>
								<PipelineNodeView
									node={branch}
									selectedId={selectedId}
									onSelect={onSelect}
									onAddStep={onAddStep}
								/>
							</div>
						))}
						{onAddStep && (
							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									onAddStep(node, node.branches?.length ?? 0);
								}}
								style={{
									alignSelf: "stretch",
									minWidth: 36,
									borderRadius: 8,
									border: `1px dashed ${c.border}`,
									background: "rgba(255,255,255,0.5)",
									color: c.text,
									fontFamily: FONT_MONO,
									fontSize: 14,
									cursor: "pointer",
								}}
								aria-label="Add branch"
							>
								+
							</button>
						)}
					</div>
				) : (
					<SequentialChildren
						children={node.steps ?? []}
						parent={node}
						selectedId={selectedId}
						onSelect={onSelect}
						onAddStep={onAddStep}
					/>
				)}
			</div>

			{node.isLoop && node.loop && (
				<LoopFooter loop={node.loop} kind={node.kind} />
			)}
		</div>
	);
}

function SequentialChildren({
	children,
	parent,
	selectedId,
	onSelect,
	onAddStep,
}: {
	children: PipelineNode[];
	parent: PipelineNode;
	selectedId: string;
	onSelect: (id: string) => void;
	onAddStep?: NodeViewProps["onAddStep"];
}) {
	if (children.length === 0) {
		return (
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: "16px 12px",
					fontFamily: FONT_SANS,
					fontSize: 12,
					color: NEUTRAL.textMuted,
					borderRadius: 8,
					background: "rgba(255,255,255,0.5)",
					border: `1px dashed ${NEUTRAL.borderStrong}`,
				}}
			>
				<span>No steps yet.</span>
				{onAddStep && (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onAddStep(parent, 0);
						}}
						style={{
							marginLeft: 10,
							padding: "4px 10px",
							borderRadius: 6,
							border: `1px solid ${NEUTRAL.borderStrong}`,
							background: "#fff",
							fontFamily: FONT_SANS,
							fontSize: 11,
							color: NEUTRAL.text,
							cursor: "pointer",
						}}
					>
						+ Add step
					</button>
				)}
			</div>
		);
	}
	return (
		<div style={{ display: "flex", flexDirection: "column" }}>
			{onAddStep && <AddBetween onAdd={() => onAddStep(parent, 0)} />}
			{children.map((step, idx) => (
				<Fragment key={step.id}>
					<PipelineNodeView
						node={step}
						selectedId={selectedId}
						onSelect={onSelect}
						onAddStep={onAddStep}
					/>
					{onAddStep && <AddBetween onAdd={() => onAddStep(parent, idx + 1)} />}
				</Fragment>
			))}
		</div>
	);
}

// ─── Block primitives ────────────────────────────────────────────────────

function ContainerHeader({ node }: { node: PipelineNode }) {
	const c = KIND_COLORS[node.kind];
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "8px 12px",
				background: c.bgHeader,
				borderBottom: `1px solid ${c.border}`,
				borderTopLeftRadius: 9,
				borderTopRightRadius: 9,
			}}
		>
			<KindBadge kind={node.kind} />
			{node.isLoop && (
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						padding: "2px 7px",
						borderRadius: 5,
						background: "#fff",
						border: `1px solid ${c.border}`,
						color: c.text,
						fontFamily: FONT_MONO,
						fontSize: 10,
						fontWeight: 600,
						letterSpacing: "0.06em",
					}}
				>
					↻ LOOP
				</span>
			)}
			<span
				style={{
					fontFamily: FONT_DISPLAY,
					fontSize: 15,
					fontWeight: 500,
					color: NEUTRAL.text,
					flex: 1,
					minWidth: 0,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{node.name}
			</span>
			<span
				style={{
					fontFamily: FONT_MONO,
					fontSize: 10,
					color: NEUTRAL.textSubtle,
				}}
			>
				{node.id}
			</span>
			{node.stateKey && (
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						padding: "1px 7px",
						borderRadius: 4,
						background: "#fff",
						border: `1px solid ${NEUTRAL.borderStrong}`,
						color: NEUTRAL.ink,
						fontFamily: FONT_MONO,
						fontSize: 10,
						fontWeight: 600,
					}}
				>
					→ {node.stateKey}
				</span>
			)}
		</div>
	);
}

function LoopFooter({
	loop,
	kind,
}: {
	loop: { until: string; maxIterations?: number };
	kind: PipelineKind;
}) {
	const c = KIND_COLORS[kind];
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "7px 12px",
				background: c.bgHeader,
				borderTop: `1px dashed ${c.border}`,
				borderBottomLeftRadius: 9,
				borderBottomRightRadius: 9,
			}}
		>
			<span
				style={{
					fontFamily: FONT_MONO,
					fontSize: 10,
					fontWeight: 700,
					color: c.text,
					letterSpacing: "0.08em",
				}}
			>
				↻ UNTIL
			</span>
			<code
				style={{
					fontFamily: FONT_MONO,
					fontSize: 11,
					color: NEUTRAL.ink,
					background: "#fff",
					padding: "1px 6px",
					borderRadius: 4,
					border: `1px solid ${NEUTRAL.border}`,
				}}
			>
				{loop.until || "(no condition)"}
			</code>
			{loop.maxIterations != null && (
				<span
					style={{
						fontFamily: FONT_MONO,
						fontSize: 10,
						color: NEUTRAL.textSubtle,
					}}
				>
					· max {loop.maxIterations}
				</span>
			)}
		</div>
	);
}

function KindBadge({ kind }: { kind: PipelineKind }) {
	const c = KIND_COLORS[kind];
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				padding: "3px 7px",
				borderRadius: 6,
				background: c.bgHeader,
				border: `1px solid ${c.border}`,
				color: c.text,
				fontFamily: FONT_MONO,
				fontSize: 9.5,
				fontWeight: 600,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				whiteSpace: "nowrap",
			}}
		>
			<span
				style={{ width: 6, height: 6, borderRadius: 6, background: c.dot }}
			/>
			{c.label}
		</span>
	);
}

export function Block({
	node,
	selected,
	onSelect,
}: {
	node: PipelineNode;
	selected: boolean;
	onSelect: (id: string) => void;
}) {
	const c = KIND_COLORS[node.kind];
	return (
		<div
			onClick={(event) => {
				event.stopPropagation();
				onSelect(node.id);
			}}
			style={{
				cursor: "pointer",
				background: c.bg,
				border: `1px solid ${selected ? c.accent : c.border}`,
				boxShadow: selected
					? `0 0 0 3px ${c.bgHeader}, 0 2px 6px rgba(0,0,0,0.04)`
					: "0 1px 2px rgba(0,0,0,0.03)",
				borderRadius: 10,
				overflow: "hidden",
				transition: "box-shadow 120ms, border-color 120ms",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "8px 10px",
					background: c.bgHeader,
					borderBottom: `1px solid ${c.border}`,
				}}
			>
				<KindBadge kind={node.kind} />
				<span
					style={{
						fontFamily: FONT_DISPLAY,
						fontSize: 14.5,
						fontWeight: 500,
						color: NEUTRAL.text,
						flex: 1,
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{node.name}
				</span>
				<span
					style={{
						fontFamily: FONT_MONO,
						fontSize: 10,
						color: NEUTRAL.textSubtle,
					}}
				>
					{node.id}
				</span>
			</div>

			<div style={{ padding: "10px 12px" }}>
				{node.kind === "llm" && <LlmBody node={node} />}
				{node.kind === "tool" && <ToolBody node={node} />}
				<IOStrip node={node} />
			</div>
		</div>
	);
}

function LlmBody({ node }: { node: PipelineNode }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					flexWrap: "wrap",
				}}
			>
				<span
					style={{
						fontFamily: FONT_MONO,
						fontSize: 11,
						fontWeight: 600,
						color: NEUTRAL.ink,
					}}
				>
					{node.model?.name || "(no model)"}
				</span>
				{node.model?.provider && (
					<span
						style={{
							fontFamily: FONT_MONO,
							fontSize: 10.5,
							color: NEUTRAL.textSubtle,
						}}
					>
						· {node.model.provider}
					</span>
				)}
			</div>
			{node.instructionPreview && (
				<p
					style={{
						margin: 0,
						fontFamily: FONT_SANS,
						fontSize: 11.5,
						lineHeight: 1.45,
						color: NEUTRAL.textMuted,
						display: "-webkit-box",
						WebkitLineClamp: 2,
						WebkitBoxOrient: "vertical",
						overflow: "hidden",
					}}
				>
					“{node.instructionPreview}”
				</p>
			)}
		</div>
	);
}

function ToolBody({ node }: { node: PipelineNode }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<MonoChip>{node.toolKind ?? "tool"}</MonoChip>
				<span
					style={{
						fontFamily: FONT_MONO,
						fontSize: 11,
						fontWeight: 600,
						color: NEUTRAL.ink,
					}}
				>
					{node.toolName ?? "(unnamed)"}
				</span>
				{node.toolServer && (
					<span
						style={{
							fontFamily: FONT_MONO,
							fontSize: 10.5,
							color: NEUTRAL.textSubtle,
						}}
					>
						· {node.toolServer}
					</span>
				)}
			</div>
			{node.toolParams && Object.keys(node.toolParams).length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
					{Object.entries(node.toolParams).map(([k, v]) => (
						<div
							key={k}
							style={{
								display: "flex",
								gap: 6,
								alignItems: "baseline",
								fontFamily: FONT_MONO,
								fontSize: 10.5,
							}}
						>
							<span style={{ color: NEUTRAL.textMuted }}>{k}:</span>
							<span
								style={{
									color: NEUTRAL.ink,
									overflow: "hidden",
									textOverflow: "ellipsis",
								}}
							>
								{String(v)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function MonoChip({ children }: { children: ReactNode }) {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				padding: "2px 7px",
				borderRadius: 5,
				background: NEUTRAL.paperBg2,
				border: `1px solid ${NEUTRAL.border}`,
				color: NEUTRAL.textMuted,
				fontFamily: FONT_MONO,
				fontSize: 10.5,
				whiteSpace: "nowrap",
			}}
		>
			{children}
		</span>
	);
}

function IOStrip({ node }: { node: PipelineNode }) {
	const inputs = node.inputMap ?? {};
	const inputKeys = Object.keys(inputs);
	const stateKey = node.stateKey ?? node.id;
	const outputs = node.outputSchemaKeys ?? [];
	const hasContent = inputKeys.length > 0 || stateKey;
	if (!hasContent) return null;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 5,
				borderTop: `1px dashed ${NEUTRAL.border}`,
				paddingTop: 8,
				marginTop: 8,
			}}
		>
			{inputKeys.length > 0 && (
				<div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
					<span
						style={{
							fontFamily: FONT_MONO,
							fontSize: 9.5,
							color: NEUTRAL.textSubtle,
							fontWeight: 600,
							letterSpacing: "0.1em",
							paddingTop: 2,
							minWidth: 22,
						}}
					>
						IN
					</span>
					<div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
						{inputKeys.slice(0, 6).map((k) => (
							<span
								key={k}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 4,
									padding: "1px 6px",
									borderRadius: 4,
									background: NEUTRAL.paperBg,
									border: `1px solid ${NEUTRAL.border}`,
									fontFamily: FONT_MONO,
									fontSize: 10,
								}}
							>
								<span style={{ color: NEUTRAL.ink }}>{k}</span>
								<span style={{ color: NEUTRAL.borderStrong }}>←</span>
								<span
									style={{
										color: NEUTRAL.textMuted,
										maxWidth: 160,
										overflow: "hidden",
										textOverflow: "ellipsis",
									}}
								>
									{inputs[k].replace(/[{}]/g, "")}
								</span>
							</span>
						))}
						{inputKeys.length > 6 && (
							<span
								style={{
									fontFamily: FONT_MONO,
									fontSize: 10,
									color: NEUTRAL.textSubtle,
								}}
							>
								+{inputKeys.length - 6}
							</span>
						)}
					</div>
				</div>
			)}
			{stateKey && (
				<div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
					<span
						style={{
							fontFamily: FONT_MONO,
							fontSize: 9.5,
							color: NEUTRAL.textSubtle,
							fontWeight: 600,
							letterSpacing: "0.1em",
							paddingTop: 2,
							minWidth: 22,
						}}
					>
						OUT
					</span>
					<div
						style={{
							display: "flex",
							gap: 4,
							flexWrap: "wrap",
							alignItems: "center",
						}}
					>
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								padding: "1px 6px",
								borderRadius: 4,
								background: "#fff",
								border: `1px solid ${NEUTRAL.borderStrong}`,
								fontFamily: FONT_MONO,
								fontSize: 10,
								fontWeight: 600,
								color: NEUTRAL.ink,
							}}
						>
							→ {stateKey}
						</span>
						{outputs.slice(0, 3).map((f) => (
							<span
								key={f.key}
								style={{
									fontFamily: FONT_MONO,
									fontSize: 10,
									color: NEUTRAL.textSubtle,
								}}
							>
								·{f.key}
								<span style={{ color: NEUTRAL.borderStrong }}>:{f.type}</span>
							</span>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ─── Spacers & endcaps ───────────────────────────────────────────────────

function Arrow() {
	return (
		<svg
			width="14"
			height="22"
			viewBox="0 0 14 22"
			style={{ display: "block", margin: "0 auto" }}
		>
			<line
				x1="7"
				y1="0"
				x2="7"
				y2="16"
				stroke={NEUTRAL.borderStrong}
				strokeWidth="1.25"
			/>
			<path
				d="M3 14 L7 19 L11 14"
				stroke={NEUTRAL.borderStrong}
				strokeWidth="1.25"
				fill="none"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function AddBetween({ onAdd }: { onAdd: () => void }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				height: 26,
				position: "relative",
			}}
		>
			<div
				style={{
					position: "absolute",
					left: "50%",
					top: 0,
					bottom: 0,
					width: 1,
					background: NEUTRAL.border,
					transform: "translateX(-0.5px)",
				}}
			/>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onAdd();
				}}
				style={{
					position: "relative",
					width: 18,
					height: 18,
					borderRadius: 9,
					background: "#fff",
					border: `1px solid ${NEUTRAL.borderStrong}`,
					color: NEUTRAL.textMuted,
					fontFamily: FONT_MONO,
					fontSize: 13,
					lineHeight: 1,
					fontWeight: 400,
					cursor: "pointer",
					padding: 0,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
				}}
				aria-label="Add step"
			>
				+
			</button>
		</div>
	);
}

function Endcap({
	label,
	schema,
	empty,
}: {
	label: string;
	schema?: PipelineNode["inputSchema"];
	empty?: string;
}) {
	const hasSchema = (schema?.length ?? 0) > 0;
	return (
		<div
			style={{
				borderRadius: 8,
				border: `1px dashed ${NEUTRAL.borderStrong}`,
				background: "rgba(255,255,255,0.6)",
				padding: "10px 14px",
				display: "flex",
				alignItems: "flex-start",
				gap: 12,
			}}
		>
			<span
				style={{
					fontFamily: FONT_MONO,
					fontSize: 9.5,
					fontWeight: 700,
					color: NEUTRAL.textMuted,
					letterSpacing: "0.14em",
					paddingTop: 3,
				}}
			>
				{label}
			</span>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
				{hasSchema ? (
					(schema ?? []).map((p) => (
						<span
							key={p.key}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								padding: "3px 8px",
								borderRadius: 5,
								background: "#fff",
								border: `1px solid ${NEUTRAL.border}`,
								fontFamily: FONT_MONO,
								fontSize: 11,
							}}
						>
							<span style={{ color: NEUTRAL.ink, fontWeight: 600 }}>
								{p.key}
							</span>
							<span style={{ color: NEUTRAL.textSubtle }}>:{p.type}</span>
							{p.default !== undefined && (
								<span style={{ color: NEUTRAL.textSubtle }}>
									= {String(p.default)}
								</span>
							)}
						</span>
					))
				) : (
					<span
						style={{
							fontFamily: FONT_SANS,
							fontSize: 11.5,
							color: NEUTRAL.textSubtle,
						}}
					>
						{empty ?? "—"}
					</span>
				)}
			</div>
		</div>
	);
}
