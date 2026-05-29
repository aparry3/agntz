"use client";

import { StatusBadge } from "@/components/status-badge";
import type { Run } from "@agntz/core";
import Link from "next/link";

function formatDurationMs(ms: number | null | undefined): string {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

interface ChildSummary {
	id: string;
	agentId: string;
	status: Run["status"];
}

export function RunSidebar({
	run,
	spawned,
}: { run: Run; spawned: ChildSummary[] }) {
	const usage = run.result?.usage;
	const dur = run.endedAt && run.startedAt ? run.endedAt - run.startedAt : null;

	return (
		<aside className="flex flex-col gap-3">
			<Card title="Usage">
				{usage ? (
					<ul className="space-y-1 text-sm text-zinc-700">
						<li>{usage.totalTokens.toLocaleString()} tokens</li>
						<li>
							{usage.promptTokens.toLocaleString()} prompt ·{" "}
							{usage.completionTokens.toLocaleString()} completion
						</li>
						<li className="font-mono text-xs text-zinc-500">
							{formatDurationMs(dur)} · {run.result?.model ?? "—"}
						</li>
					</ul>
				) : (
					<p className="text-sm text-zinc-500">No usage data yet.</p>
				)}
			</Card>

			<Card title={`Children (${spawned.length})`}>
				{spawned.length === 0 ? (
					<p className="text-sm text-zinc-500">No spawned runs.</p>
				) : (
					<ul className="space-y-2 text-sm">
						{spawned.map((c) => (
							<li key={c.id} className="flex items-center gap-2">
								<Link
									href={`/runs/${encodeURIComponent(c.id)}`}
									className="font-mono text-zinc-800 hover:underline"
								>
									{c.agentId}
								</Link>
								<StatusBadge status={c.status} />
							</li>
						))}
					</ul>
				)}
			</Card>

			<Card title="Trace">
				<Link
					href={`/traces/${encodeURIComponent(run.rootId)}`}
					className="text-sm text-blue-700 hover:underline"
				>
					View spans →
				</Link>
			</Card>
		</aside>
	);
}

function Card({
	title,
	children,
}: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
			<div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
				{title}
			</div>
			{children}
		</div>
	);
}
