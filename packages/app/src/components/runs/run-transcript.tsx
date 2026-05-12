"use client";

import type { Run } from "@agntz/core";
import { InputBubble } from "./input-bubble";
import { OutputBubble } from "./output-bubble";
import { ErrorBubble } from "./error-bubble";
import { RunningIndicator } from "./running-indicator";
import { ToolCallRow, type RunToolCall } from "./tool-call-row";
import { SpawnAgentRow } from "./spawn-agent-row";

export function RunTranscript({ run }: { run: Run }) {
  const toolCalls: RunToolCall[] = (run.result?.toolCalls ?? []) as RunToolCall[];
  const isRunning = run.status === "running" || run.status === "pending" || run.status === "draining";
  const hasError = run.status === "failed" && (run.error || !run.result?.output);
  const hasOutput = !!run.result?.output;

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
      {hasOutput && <OutputBubble text={run.result!.output} />}
      {hasError && <ErrorBubble message={run.error ?? "Run failed without an output."} />}
    </div>
  );
}
