"use client";

import { Mono, ag } from "@/components/v3/primitives";
import type { SpanStatus, TraceSummary } from "@agntz/core";
import Link from "next/link";

const COLUMNS = "150px 160px 100px 110px 100px 70px 90px 90px";

export function TraceList({ rows }: { rows: TraceSummary[] }) {
	return (
		<div
			style={{
				background: ag.surface2,
				border: `1px solid ${ag.line}`,
				borderRadius: 5,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: COLUMNS,
					padding: "9px 16px",
					gap: 12,
					alignItems: "center",
					background: ag.surface,
					borderBottom: `1px solid ${ag.line}`,
					fontSize: 10.5,
					textTransform: "uppercase",
					letterSpacing: "0.08em",
					color: ag.muted,
					fontWeight: 500,
				}}
			>
				<div>Trace</div>
				<div>Agent</div>
				<div>Status</div>
				<div>Started</div>
				<div style={{ textAlign: "right" }}>Duration</div>
				<div style={{ textAlign: "right" }}>Spans</div>
				<div style={{ textAlign: "right" }}>Tokens</div>
				<div style={{ textAlign: "right" }}>Cost</div>
			</div>
			{rows.map((row, i) => (
				<TraceRow key={row.traceId} row={row} isLast={i === rows.length - 1} />
			))}
		</div>
	);
}

function TraceRow({ row, isLast }: { row: TraceSummary; isLast: boolean }) {
	return (
		<Link
			href={`/traces/${row.traceId}`}
			style={{
				display: "grid",
				gridTemplateColumns: COLUMNS,
				padding: "12px 16px",
				gap: 12,
				alignItems: "center",
				borderBottom: isLast ? "none" : `1px solid ${ag.line2}`,
				fontSize: 13,
				textDecoration: "none",
				color: "inherit",
				background: "transparent",
			}}
		>
			<Mono size={12} color={ag.ink} style={{ fontWeight: 500 }}>
				{row.traceId}
			</Mono>
			<span
				style={{
					color: ag.text2,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{row.agentId ?? "—"}
			</span>
			<div>
				<StatusChip status={row.status} />
			</div>
			<Mono size={11} color={ag.muted}>
				{formatRelativeIso(row.startedAt)}
			</Mono>
			<Mono
				size={11}
				color={ag.text2}
				style={{ textAlign: "right", display: "block" }}
			>
				{formatDuration(row.durationMs)}
			</Mono>
			<Mono
				size={11}
				color={ag.text2}
				style={{ textAlign: "right", display: "block" }}
			>
				{row.spanCount}
			</Mono>
			<Mono
				size={11}
				color={ag.text2}
				style={{ textAlign: "right", display: "block" }}
			>
				{row.totalTokens.toLocaleString()}
			</Mono>
			<Mono
				size={11}
				color={ag.text2}
				style={{ textAlign: "right", display: "block" }}
			>
				{row.totalCostUsd === null ? "—" : `$${row.totalCostUsd.toFixed(4)}`}
			</Mono>
		</Link>
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
				padding: "2px 7px",
				borderRadius: 3,
				fontSize: 10.5,
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

function formatDuration(ms: number | null): string {
	if (ms === null) return "—";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function formatRelativeIso(iso: string): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return iso;
	const diff = Math.max(0, Date.now() - t);
	const s = Math.round(diff / 1000);
	if (s < 5) return "just now";
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d}d ago`;
	return new Date(t).toLocaleDateString();
}

export const TraceTable = TraceList;
