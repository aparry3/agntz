"use client";

import { GanttStrip } from "@/components/traces/gantt-strip";
import { SpanDetailPanel } from "@/components/traces/span-detail-panel";
import { SpanTree } from "@/components/traces/span-tree";
import { Crumbs, Mono, ag } from "@/components/v3/primitives";
import type { Span, SpanStatus, TraceSummary } from "@agntz/core";
import Link from "next/link";
import { use, useEffect, useState } from "react";

interface DetailResponse {
	summary: TraceSummary;
	spans: Span[];
}

export default function TraceDetailPage({
	params,
}: {
	params: Promise<{ traceId: string }>;
}) {
	const { traceId } = use(params);
	const [data, setData] = useState<DetailResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		fetch(`/api/traces/${encodeURIComponent(traceId)}`)
			.then(async (r) => {
				if (!r.ok) {
					const body = (await r.json().catch(() => ({}))) as { error?: string };
					throw new Error(body.error ?? `${r.status} ${r.statusText}`);
				}
				return (await r.json()) as DetailResponse;
			})
			.then((d) => {
				if (cancelled) return;
				setData(d);
				const root =
					d.spans.find((s) => s.parentId === null) ?? d.spans[0] ?? null;
				if (root) setSelectedSpanId(root.spanId);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(String(err));
			})
			.finally(() => {
				if (cancelled) return;
				setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [traceId]);

	useEffect(() => {
		if (!data || data.summary.status !== "running") return;
		const es = new EventSource(
			`/api/traces/${encodeURIComponent(traceId)}/stream`,
		);

		es.addEventListener("span-start", (e) => {
			try {
				const payload = JSON.parse((e as MessageEvent).data) as { span: Span };
				setData((prev) =>
					prev ? { ...prev, spans: [...prev.spans, payload.span] } : prev,
				);
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
				setData((prev) =>
					prev
						? {
								...prev,
								spans: prev.spans.map((s) =>
									s.spanId === payload.spanId ? { ...s, ...payload.patch } : s,
								),
							}
						: prev,
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
				setData((prev) =>
					prev ? { ...prev, summary: payload.summary } : prev,
				);
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
	}, [data?.summary.status, data?.summary.traceId, traceId]);

	if (loading) return <CardMessage>Loading trace…</CardMessage>;
	if (error) return <CardMessage>Failed to load trace: {error}</CardMessage>;
	if (!data) return <CardMessage>Trace not found.</CardMessage>;

	const { summary, spans } = data;
	const selectedSpan = spans.find((s) => s.spanId === selectedSpanId) ?? null;

	return (
		<div
			style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
		>
			<div
				style={{
					padding: "20px 32px 18px",
					borderBottom: `1px solid ${ag.line2}`,
					background: ag.bg,
				}}
			>
				<div style={{ marginBottom: 8 }}>
					<Crumbs
						trail={[
							<Link
								key="ws"
								href="/agents"
								style={{ color: "inherit", textDecoration: "none" }}
							>
								agntz
							</Link>,
							<Link
								key="tr"
								href="/traces"
								style={{ color: "inherit", textDecoration: "none" }}
							>
								Traces
							</Link>,
							<Mono key="id" size={11.5} color={ag.ink}>
								{summary.traceId}
							</Mono>,
						]}
					/>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "flex-end",
						justifyContent: "space-between",
						gap: 24,
					}}
				>
					<div style={{ minWidth: 0, flex: 1 }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 12,
								flexWrap: "wrap",
							}}
						>
							<Mono
								size={22}
								color={ag.ink}
								style={{ fontWeight: 600, letterSpacing: "-0.01em" }}
							>
								{summary.traceId}
							</Mono>
							<StatusChip status={summary.status} />
						</div>
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: 18,
								marginTop: 10,
								fontSize: 11.5,
							}}
						>
							<MetaPair k="agent" v={summary.agentId ?? "—"} />
							<MetaPair
								k="started"
								v={new Date(summary.startedAt).toLocaleString()}
							/>
							<MetaPair
								k="duration"
								v={
									summary.durationMs === null
										? "—"
										: `${(summary.durationMs / 1000).toFixed(2)}s`
								}
							/>
							<MetaPair k="spans" v={String(summary.spanCount)} />
							<MetaPair k="tokens" v={summary.totalTokens.toLocaleString()} />
							<MetaPair
								k="cost"
								v={
									summary.totalCostUsd === null
										? "—"
										: `$${summary.totalCostUsd.toFixed(4)}`
								}
							/>
						</div>
					</div>
				</div>
			</div>

			<div
				style={{
					padding: "16px 32px 32px",
					flex: 1,
					overflow: "auto",
					display: "flex",
					flexDirection: "column",
					gap: 16,
				}}
			>
				<GanttStrip
					spans={spans}
					summary={summary}
					selectedSpanId={selectedSpanId}
					onSelect={setSelectedSpanId}
				/>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "minmax(260px, 360px) 1fr",
						gap: 16,
						alignItems: "start",
					}}
				>
					<SpanTree
						spans={spans}
						selectedSpanId={selectedSpanId}
						onSelect={setSelectedSpanId}
					/>
					<SpanDetailPanel span={selectedSpan} />
				</div>
			</div>
		</div>
	);
}

function MetaPair({ k, v }: { k: string; v: string }) {
	return (
		<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
			<span style={{ color: ag.muted, fontSize: 11, letterSpacing: "0.04em" }}>
				{k}
			</span>
			<Mono size={11.5} color={ag.ink}>
				{v}
			</Mono>
		</span>
	);
}

function StatusChip({ status }: { status: SpanStatus }) {
	const M: Record<
		SpanStatus,
		{ bg: string; fg: string; label: string; pulse?: boolean }
	> = {
		ok: { bg: ag.okBg, fg: ag.ok, label: "OK" },
		error: { bg: "#F2DCDE", fg: ag.danger, label: "Error" },
		cancelled: { bg: ag.line2, fg: ag.text2, label: "Cancelled" },
		running: { bg: ag.blueBg, fg: ag.blue, label: "Running", pulse: true },
	};
	const m = M[status] ?? { bg: ag.line2, fg: ag.text2, label: status };
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				background: m.bg,
				color: m.fg,
				padding: "2px 8px",
				borderRadius: 3,
				fontSize: 11,
				fontWeight: 500,
			}}
		>
			<span
				style={{
					width: 6,
					height: 6,
					borderRadius: 999,
					background: m.fg,
					animation: m.pulse
						? "agntz-pulse 1.4s ease-in-out infinite"
						: undefined,
				}}
			/>
			{m.label}
		</span>
	);
}

function CardMessage({ children }: { children: React.ReactNode }) {
	return (
		<div style={{ padding: "32px" }}>
			<div
				style={{
					background: ag.surface2,
					border: `1px solid ${ag.line}`,
					borderRadius: 5,
					padding: "60px 24px",
					textAlign: "center",
					color: ag.muted,
					fontSize: 13,
				}}
			>
				{children}
			</div>
		</div>
	);
}
