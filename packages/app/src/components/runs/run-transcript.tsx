"use client";

import type { Run } from "@agntz/core";
import { ErrorBubble } from "./error-bubble";
import { InputBubble } from "./input-bubble";
import { OutputBubble } from "./output-bubble";
import { RunningIndicator } from "./running-indicator";
import { SpawnAgentRow } from "./spawn-agent-row";
import { type RunToolCall, ToolCallRow } from "./tool-call-row";

export function RunTranscript({ run }: { run: Run }) {
	const toolCalls: RunToolCall[] = (run.result?.toolCalls ??
		[]) as RunToolCall[];
	const isRunning =
		run.status === "running" ||
		run.status === "pending" ||
		run.status === "draining";
	const output = run.result?.output;
	const hasError = run.status === "failed" && (run.error || !output);
	const hasOutput = !!output;

	return (
		<div className="flex flex-col gap-3">
			<InputBubble text={run.input} />
			{toolCalls.map((tc) =>
				tc.name === "spawn_agent" ? (
					<SpawnAgentRow key={tc.id} toolCall={tc} />
				) : (
					<ToolCallRow key={tc.id} toolCall={tc} />
				),
			)}
			{isRunning && <RunningIndicator />}
			{hasOutput && <OutputBubble text={output} />}
			{hasError && (
				<ErrorBubble message={run.error ?? "Run failed without an output."} />
			)}
		</div>
	);
}
