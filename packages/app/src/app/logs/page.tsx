"use client";

import { I } from "@/components/v3/icons";
import { Crumbs, Mono, ag } from "@/components/v3/primitives";
import { useEffect, useMemo, useState } from "react";

interface LogEntry {
	id: string;
	agentId: string;
	input: string;
	output: string;
	duration: number;
	model: string;
	timestamp: string;
	error?: string;
}

type LevelFilter = "all" | "info" | "warn" | "error";

const LEVELS: Array<{ value: LevelFilter; label: string }> = [
	{ value: "all", label: "any" },
	{ value: "info", label: "info" },
	{ value: "warn", label: "warn" },
	{ value: "error", label: "error" },
];

const COLUMNS = "60px 160px minmax(220px,1.4fr) 130px 90px 90px";

export default function LogsPage() {
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState("");
	const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
	const [agentFilter, setAgentFilter] = useState("");

	useEffect(() => {
		fetch("/api/logs")
			.then((r) => r.json())
			.then(setLogs)
			.finally(() => setLoading(false));
	}, []);

	const agentIds = useMemo(
		() =>
			Array.from(new Set(logs.map((l) => l.agentId).filter(Boolean))).sort(),
		[logs],
	);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return logs.filter((l) => {
			if (levelFilter !== "all" && deriveLevel(l) !== levelFilter) return false;
			if (agentFilter && l.agentId !== agentFilter) return false;
			if (q) {
				return (
					l.id.toLowerCase().includes(q) ||
					l.agentId.toLowerCase().includes(q) ||
					(l.input ?? "").toLowerCase().includes(q) ||
					(l.output ?? "").toLowerCase().includes(q) ||
					(l.error ?? "").toLowerCase().includes(q)
				);
			}
			return true;
		});
	}, [logs, search, levelFilter, agentFilter]);

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
					<Crumbs trail={["agntz", "Logs"]} />
				</div>
				<h1
					style={{
						margin: 0,
						fontSize: 24,
						fontWeight: 600,
						letterSpacing: "-0.015em",
						color: ag.ink,
					}}
				>
					Logs
				</h1>
				<div
					style={{ marginTop: 5, fontSize: 13, color: ag.text2, maxWidth: 600 }}
				>
					Inspect invocation history, runtime, and failures.
				</div>
			</div>

			<div
				style={{
					padding: "10px 32px",
					display: "flex",
					alignItems: "center",
					gap: 10,
					borderBottom: `1px solid ${ag.line2}`,
					background: ag.surface,
					flexWrap: "wrap",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 7,
						padding: "5px 10px",
						border: `1px solid ${ag.line}`,
						background: ag.surface2,
						borderRadius: 4,
						color: ag.muted,
						flex: 1,
						maxWidth: 360,
					}}
				>
					<I.Search size={12} />
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search message, agent, or input…"
						style={{
							fontSize: 12,
							flex: 1,
							border: 0,
							outline: 0,
							background: "transparent",
							color: ag.ink,
							fontFamily: "inherit",
						}}
					/>
				</div>
				<PillSelect
					label="level"
					value={levelFilter}
					displayValue={levelFilter === "all" ? "any" : levelFilter}
					onChange={(v) => setLevelFilter(v as LevelFilter)}
					options={LEVELS}
				/>
				<PillSelect
					label="agent"
					value={agentFilter}
					displayValue={agentFilter || "any"}
					onChange={setAgentFilter}
					options={[
						{ value: "", label: "any" },
						...agentIds.map((id) => ({ value: id, label: id })),
					]}
				/>
				<div style={{ flex: 1 }} />
				<Mono size={11} color={ag.muted}>
					{loading ? "loading…" : `${filtered.length} entries · sort: time ↓`}
				</Mono>
			</div>

			<div style={{ padding: "16px 32px 32px", flex: 1, overflow: "auto" }}>
				{loading ? (
					<CardMessage>Loading logs…</CardMessage>
				) : logs.length === 0 ? (
					<EmptyState />
				) : filtered.length === 0 ? (
					<CardMessage>No log entries match the current filter.</CardMessage>
				) : (
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
							<div>Level</div>
							<div>Agent</div>
							<div>Message</div>
							<div>Log</div>
							<div style={{ textAlign: "right" }}>Duration</div>
							<div>Time</div>
						</div>
						{filtered.map((log, i) => (
							<LogRow
								key={log.id}
								log={log}
								isLast={i === filtered.length - 1}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function LogRow({ log, isLast }: { log: LogEntry; isLast: boolean }) {
	const level = deriveLevel(log);
	const message = log.error
		? log.error
		: log.output
			? log.output
			: "(no output)";
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: COLUMNS,
				padding: "12px 16px",
				gap: 12,
				alignItems: "center",
				borderBottom: isLast ? "none" : `1px solid ${ag.line2}`,
				fontSize: 13,
			}}
		>
			<div>
				<LevelChip level={level} />
			</div>
			<div
				style={{
					fontWeight: 500,
					color: ag.ink,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{log.agentId}
			</div>
			<div style={{ minWidth: 0, overflow: "hidden" }}>
				<div
					style={{
						color: ag.ink,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{message}
				</div>
				{log.input && (
					<Mono
						size={11}
						color={ag.muted}
						style={{
							marginTop: 2,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							display: "block",
						}}
					>
						↳ {log.input}
					</Mono>
				)}
			</div>
			<Mono size={11} color={ag.muted}>
				{log.id}
			</Mono>
			<Mono
				size={11}
				color={ag.text2}
				style={{ textAlign: "right", display: "block" }}
			>
				{log.duration}ms
			</Mono>
			<Mono size={11} color={ag.muted}>
				{formatRelativeIso(log.timestamp)}
			</Mono>
		</div>
	);
}

function LevelChip({ level }: { level: "info" | "warn" | "error" }) {
	const M = {
		info: { bg: ag.line2, fg: ag.text2, label: "INFO" },
		warn: { bg: ag.warnBg, fg: ag.warn, label: "WARN" },
		error: { bg: "#F2DCDE", fg: ag.danger, label: "ERR" },
	}[level];
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				background: M.bg,
				color: M.fg,
				padding: "2px 6px",
				borderRadius: 3,
				fontSize: 10.5,
				fontFamily: "var(--font-mono)",
				fontWeight: 500,
				letterSpacing: 0,
			}}
		>
			{M.label}
		</span>
	);
}

function PillSelect({
	label,
	value,
	displayValue,
	onChange,
	options,
}: {
	label: string;
	value: string;
	displayValue: string;
	onChange: (v: string) => void;
	options: Array<{ value: string; label: string }>;
}) {
	return (
		<label
			style={{
				position: "relative",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				background: ag.surface2,
				border: `1px solid ${ag.line}`,
				color: ag.ink,
				padding: "4px 9px 4px 11px",
				borderRadius: 4,
				fontSize: 12,
				cursor: "pointer",
			}}
		>
			<span style={{ color: ag.muted }}>{label}:</span>
			<span style={{ color: ag.ink, fontWeight: 500 }}>{displayValue}</span>
			<I.Chev size={10} />
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				style={{
					position: "absolute",
					inset: 0,
					opacity: 0,
					cursor: "pointer",
					fontFamily: "inherit",
				}}
			>
				{options.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
		</label>
	);
}

function CardMessage({ children }: { children: React.ReactNode }) {
	return (
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
	);
}

function EmptyState() {
	return (
		<div
			style={{
				background: ag.surface2,
				border: `1px solid ${ag.line}`,
				borderRadius: 5,
				padding: "60px 24px",
				textAlign: "center",
			}}
		>
			<div
				style={{
					margin: "0 auto 14px",
					width: 44,
					height: 44,
					borderRadius: 6,
					background: ag.line2,
					display: "grid",
					placeItems: "center",
					color: ag.muted,
				}}
			>
				<I.Logs size={20} />
			</div>
			<div
				style={{
					fontSize: 15,
					fontWeight: 500,
					color: ag.ink,
					marginBottom: 4,
				}}
			>
				No invocation logs yet
			</div>
			<div style={{ fontSize: 12.5, color: ag.muted }}>
				Logs appear here as your agents handle requests.
			</div>
		</div>
	);
}

function deriveLevel(log: LogEntry): "info" | "warn" | "error" {
	if (log.error) return "error";
	if (log.duration > 10_000) return "warn";
	return "info";
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
