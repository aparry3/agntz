"use client";

import { RunHeader } from "@/components/runs/run-header";
import { RunSidebar } from "@/components/runs/run-sidebar";
import { RunTranscript } from "@/components/runs/run-transcript";
import { useRunPolling } from "@/hooks/use-run-polling";
import type { Run } from "@agntz/core";
import { use, useEffect, useMemo, useState } from "react";

interface ChildSummary {
	id: string;
	agentId: string;
	status: Run["status"];
}

export default function RunDetailPage({
	params,
}: {
	params: Promise<{ runId: string }>;
}) {
	const { runId } = use(params);
	const [initial, setInitial] = useState<Run | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch(`/api/runs/${encodeURIComponent(runId)}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
				const run = (await res.json()) as Run;
				if (cancelled) return;
				setInitial(run);
			})
			.catch((err) => {
				if (!cancelled) setError(String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [runId]);

	if (error) return <DetailMessage>Failed to load run: {error}</DetailMessage>;
	if (!initial) return <DetailMessage>Loading run...</DetailMessage>;

	return <DetailBody initial={initial} />;
}

function DetailBody({ initial }: { initial: Run }) {
	const { run, error } = useRunPolling(initial);
	// Derive children from the live polled run so new spawn_agent completions
	// are reflected without a page reload.
	const spawned = useMemo(() => deriveChildren(run), [run]);
	return (
		<div className="mx-auto max-w-7xl">
			{error && (
				<div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
					Polling error: {error} (the run may still be progressing)
				</div>
			)}
			<RunHeader run={run} />
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
				<RunTranscript run={run} />
				<RunSidebar run={run} spawned={spawned} />
			</div>
		</div>
	);
}

// Children are derived from the spawn_agent tool calls in the parent's
// result.toolCalls — no extra round-trip needed for v1.
function deriveChildren(run: Run): ChildSummary[] {
	const out: ChildSummary[] = [];
	for (const tc of run.result?.toolCalls ?? []) {
		if (tc.name !== "spawn_agent") continue;
		const o = tc.output as Record<string, unknown> | null;
		if (!o) continue;
		const childId = typeof o.runId === "string" ? o.runId : null;
		const childAgent = typeof o.agentId === "string" ? o.agentId : "(agent)";
		if (!childId) continue;
		out.push({ id: childId, agentId: childAgent, status: "completed" });
	}
	return out;
}

function DetailMessage({ children }: { children: React.ReactNode }) {
	return (
		<div className="mx-auto max-w-7xl">
			<div className="flex items-center justify-center rounded-[2rem] border border-stone-200 bg-white py-20 shadow-sm">
				<p className="text-zinc-500">{children}</p>
			</div>
		</div>
	);
}
