// InstructionPanel — focused markdown editing surface used by the
// "Instruction" view tab. Shows the selected LLM agent's `instruction`
// (system prompt, required) and `prompt` (optional user-message template)
// as side-by-side markdown editors.
//
// When no LLM is selected (or the selected step is a tool / sub-pipeline),
// the panel renders a compact empty state instead.

"use client";

import { I } from "@/components/v3/icons";
import { Mono, Tag, ag } from "@/components/v3/primitives";
import { MarkdownEditor } from "./markdown-editor";

export function InstructionPanel({
	agentName,
	agentId,
	instruction,
	prompt,
	onChangeInstruction,
	onChangePrompt,
}: {
	agentName: string;
	agentId: string;
	instruction: string;
	prompt: string;
	onChangeInstruction?: (next: string) => void;
	onChangePrompt?: (next: string) => void;
}) {
	return (
		<section
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
						instructions for
					</Mono>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<Tag bg={ag.blueBg} color={ag.blue} mono>
						LLM
					</Tag>
					<div style={{ fontWeight: 500, fontSize: 14, flex: 1 }}>
						{agentName}
					</div>
					<Mono size={10.5} color={ag.muted}>
						{agentId}
					</Mono>
				</div>
			</div>

			<div
				style={{
					flex: 1,
					overflow: "auto",
					padding: 16,
					display: "flex",
					flexDirection: "column",
					gap: 18,
				}}
			>
				<MarkdownEditor
					label="Instruction (system prompt)"
					value={instruction}
					onChange={onChangeInstruction}
					placeholder="Describe what this agent does. Use {{var}} to reference inputs."
					height={360}
					hint="Markdown supported. {{var}} placeholders resolve from input/state."
				/>
				<MarkdownEditor
					label="Prompt template (optional)"
					value={prompt}
					onChange={onChangePrompt}
					placeholder="Optional user-message template. Leave blank to use the caller's raw message."
					height={220}
				/>
			</div>
		</section>
	);
}

export function InstructionEmptyState({
	hint = "Select an LLM agent in the graph to edit its instructions.",
}: {
	hint?: string;
}) {
	return (
		<section
			style={{
				background: ag.surface,
				display: "flex",
				flexDirection: "column",
				minHeight: 0,
				borderLeft: `1px solid ${ag.line2}`,
				alignItems: "center",
				justifyContent: "center",
				padding: 24,
				textAlign: "center",
				gap: 10,
				color: ag.muted,
			}}
		>
			<I.Sparkle size={18} />
			<Mono size={11.5} color={ag.muted}>
				{hint}
			</Mono>
		</section>
	);
}
