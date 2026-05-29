"use client";

import { GanttStrip } from "@/components/traces/gantt-strip";
import { SpanDetailPanel } from "@/components/traces/span-detail-panel";
import { SpanTree } from "@/components/traces/span-tree";
import { Mono, ag } from "@/components/v3/primitives";
import type { Span, TraceSummary } from "@agntz/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function makePlaceholderSummary(
	traceId: string,
	agentId: string,
): TraceSummary {
	return {
		traceId,
		ownerId: "",
		rootName: "agent.invoke",
		agentId,
		startedAt: new Date().toISOString(),
		endedAt: null,
		durationMs: null,
		spanCount: 0,
		status: "running",
		totalTokens: 0,
		totalCostUsd: null,
	};
}

/**
 * Subscribes to `/api/traces/:id/stream` for live spans and renders the
 * gantt + tree + detail using the same components as `/traces/[traceId]`.
 * Mount with a non-null `traceId` to begin; remount with a new id to reset.
 */
export function LiveTrace({
	traceId,
	agentId,
}: {
	traceId: string;
	agentId: string;
}) {
	const [summary, setSummary] = useState<TraceSummary>(() =>
		makePlaceholderSummary(traceId, agentId),
	);
	const [spans, setSpans] = useState<Span[]>([]);
	const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

	useEffect(() => {
		setSummary(makePlaceholderSummary(traceId, agentId));
		setSpans([]);
		setSelectedSpanId(null);

		const es = new EventSource(
			`/api/traces/${encodeURIComponent(traceId)}/stream`,
		);

		es.addEventListener("span-start", (e) => {
			try {
				const payload = JSON.parse((e as MessageEvent).data) as { span: Span };
				setSpans((prev) => {
					const next = [...prev, payload.span];
					return next;
				});
				setSelectedSpanId((prev) => prev ?? payload.span.spanId);
			} catch {
				/* skip malformed */
			}
		});

		es.addEventListener("span-end", (e) => {
			try {
				const payload = JSON.parse((e as MessageEvent).data) as {
					spanId: string;
					patch: Partial<Span>;
				};
				setSpans((prev) =>
					prev.map((s) =>
						s.spanId === payload.spanId ? { ...s, ...payload.patch } : s,
					),
				);
			} catch {
				/* skip malformed */
			}
		});

		es.addEventListener("trace-done", (e) => {
			try {
				const payload = JSON.parse((e as MessageEvent).data) as {
					summary: TraceSummary;
				};
				setSummary(payload.summary);
			} catch {
				/* skip malformed */
			}
			es.close();
		});

		es.addEventListener("snapshot", () => {
			es.close();
		});

		es.onerror = () => {
			es.close();
		};

		return () => es.close();
	}, [traceId, agentId]);

	const rootSpan = useMemo(
		() => spans.find((s) => s.parentId === null) ?? spans[0] ?? null,
		[spans],
	);
	const selectedSpan = useMemo(
		() => spans.find((s) => s.spanId === selectedSpanId) ?? rootSpan,
		[spans, selectedSpanId, rootSpan],
	);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
				}}
			>
				<div
					style={{
						fontSize: 10,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: ag.muted,
						fontWeight: 500,
						fontFamily: "var(--font-mono)",
					}}
				>
					Trace
				</div>
				{summary.status !== "running" && (
					<Link
						href={`/traces/${encodeURIComponent(traceId)}`}
						style={{ fontSize: 11, color: ag.muted, textDecoration: "none" }}
					>
						<Mono size={11} color={ag.muted}>
							Open full view →
						</Mono>
					</Link>
				)}
			</div>

			{spans.length === 0 ? (
				<div
					style={{
						padding: "16px 10px",
						border: `1px dashed ${ag.line}`,
						borderRadius: 4,
						color: ag.muted,
						fontSize: 11.5,
						textAlign: "center",
					}}
				>
					Waiting for spans…
				</div>
			) : (
				<>
					<GanttStrip
						spans={spans}
						summary={summary}
						selectedSpanId={selectedSpanId}
						onSelect={setSelectedSpanId}
					/>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "minmax(180px, 220px) 1fr",
							gap: 10,
							alignItems: "start",
						}}
					>
						<SpanTree
							spans={spans}
							selectedSpanId={selectedSpanId}
							onSelect={setSelectedSpanId}
						/>
						<SpanDetailPanel span={selectedSpan ?? null} />
					</div>
				</>
			)}
		</div>
	);
}
