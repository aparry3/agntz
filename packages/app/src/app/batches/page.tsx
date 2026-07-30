"use client";

import { I } from "@/components/v3/icons";
import { Btn, Crumbs, Mono, Tag, ag } from "@/components/v3/primitives";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface BatchSummary {
	id: string;
	name?: string;
	description?: string;
	provider: string;
	model: string;
	defaultDataset?: { id: string; version?: string };
	updatedAt?: string;
}

interface BatchRun {
	id: string;
	batchId: string;
	status: string;
	createdAt: string;
	counts: { total: number; pending: number };
}

export default function BatchesPage() {
	const [batches, setBatches] = useState<BatchSummary[]>([]);
	const [runs, setRuns] = useState<BatchRun[]>([]);
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		Promise.all([
			fetch("/api/batches").then((response) => response.json()),
			fetch("/api/batch-runs?limit=200").then((response) => response.json()),
		])
			.then(([batchRows, runPage]) => {
				setBatches(Array.isArray(batchRows) ? batchRows : []);
				setRuns(Array.isArray(runPage?.rows) ? runPage.rows : []);
			})
			.finally(() => setLoading(false));
	}, []);

	const latestByBatch = useMemo(() => {
		const map = new Map<string, BatchRun>();
		for (const run of runs) {
			if (!map.has(run.batchId)) map.set(run.batchId, run);
		}
		return map;
	}, [runs]);
	const filtered = batches.filter((batch) => {
		const query = search.trim().toLowerCase();
		return (
			!query ||
			batch.id.toLowerCase().includes(query) ||
			(batch.name ?? "").toLowerCase().includes(query) ||
			batch.model.toLowerCase().includes(query)
		);
	});

	return (
		<div style={{ minHeight: "100vh" }}>
			<header
				style={{
					padding: "20px 32px 18px",
					borderBottom: `1px solid ${ag.line2}`,
				}}
			>
				<Crumbs trail={["agntz", "Batches"]} />
				<div
					style={{
						marginTop: 9,
						display: "flex",
						justifyContent: "space-between",
						alignItems: "flex-end",
					}}
				>
					<div>
						<h1 style={titleStyle}>Batches</h1>
						<p style={subtitleStyle}>
							Version an LLM manifest, run it natively against a dataset, then
							swap models and compare.
						</p>
					</div>
					<Link href="/batches/new" style={primaryLinkStyle}>
						<I.Plus size={12} /> New batch
					</Link>
				</div>
			</header>

			<div
				style={{
					padding: "10px 32px",
					background: ag.surface,
					borderBottom: `1px solid ${ag.line2}`,
				}}
			>
				<div style={searchStyle}>
					<I.Search size={12} />
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search batches by name, id, or model…"
						style={inputResetStyle}
					/>
				</div>
			</div>

			<div style={{ padding: "16px 32px 32px" }}>
				{loading ? (
					<Empty text="Loading batches…" />
				) : filtered.length === 0 ? (
					<Empty
						text={
							batches.length
								? "No batches match this search."
								: "No batch manifests yet. Create one to run a dataset with a provider-native batch API."
						}
						action={!batches.length}
					/>
				) : (
					<div style={tableStyle}>
						<div style={{ ...rowStyle, ...headerStyle }}>
							<div>Batch</div>
							<div>Provider / model</div>
							<div>Default dataset</div>
							<div>Latest run</div>
							<div>Updated</div>
						</div>
						{filtered.map((batch) => {
							const run = latestByBatch.get(batch.id);
							return (
								<Link
									key={batch.id}
									href={`/batches/${encodeURIComponent(batch.id)}`}
									style={{ ...rowStyle, textDecoration: "none" }}
								>
									<div>
										<div style={{ color: ag.ink, fontWeight: 550 }}>
											{batch.name ?? batch.id}
										</div>
										<Mono size={11} color={ag.muted}>
											{batch.id}
										</Mono>
									</div>
									<div>
										<Tag bg={ag.blueBg} color={ag.blue} mono>
											{batch.provider}
										</Tag>{" "}
										<Mono size={11}>{batch.model}</Mono>
									</div>
									<Mono size={11}>{batch.defaultDataset?.id ?? "—"}</Mono>
									<div>
										{run ? (
											<>
												<RunStatus status={run.status} />
												<Mono size={10} color={ag.muted}>
													{" "}
													{run.counts.total - run.counts.pending}/
													{run.counts.total}
												</Mono>
											</>
										) : (
											<Mono size={11} color={ag.muted}>
												Not run
											</Mono>
										)}
									</div>
									<Mono size={11} color={ag.muted}>
										{relativeTime(batch.updatedAt)}
									</Mono>
								</Link>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

function RunStatus({ status }: { status: string }) {
	const terminal = status === "completed";
	const failed = ["failed", "expired", "cancelled"].includes(status);
	return (
		<Tag
			bg={terminal ? ag.okBg : failed ? ag.warnBg : ag.blueBg}
			color={terminal ? ag.ok : failed ? ag.warn : ag.blue}
		>
			<I.Dot size={6} color={terminal ? ag.ok : failed ? ag.warn : ag.blue} />
			{status}
		</Tag>
	);
}

function Empty({ text, action = false }: { text: string; action?: boolean }) {
	return (
		<div style={emptyStyle}>
			<I.Box size={25} />
			<div style={{ maxWidth: 520 }}>{text}</div>
			{action && (
				<Link href="/batches/new" style={{ textDecoration: "none" }}>
					<Btn icon={<I.Plus size={12} />}>Create batch</Btn>
				</Link>
			)}
		</div>
	);
}

function relativeTime(value?: string) {
	if (!value) return "—";
	const elapsed = Date.now() - new Date(value).getTime();
	if (elapsed < 60_000) return "just now";
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
	return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

const titleStyle = {
	margin: 0,
	fontSize: 24,
	fontWeight: 600,
	letterSpacing: "-0.015em",
	color: ag.ink,
} satisfies React.CSSProperties;
const subtitleStyle = {
	margin: "5px 0 0",
	fontSize: 13,
	color: ag.text2,
} satisfies React.CSSProperties;
const primaryLinkStyle = {
	background: ag.ink,
	color: ag.surface,
	borderRadius: 4,
	padding: "7px 11px",
	display: "inline-flex",
	alignItems: "center",
	gap: 6,
	textDecoration: "none",
	fontSize: 12.5,
	fontWeight: 500,
} satisfies React.CSSProperties;
const searchStyle = {
	display: "flex",
	alignItems: "center",
	gap: 7,
	maxWidth: 380,
	padding: "6px 9px",
	border: `1px solid ${ag.line}`,
	borderRadius: 4,
	background: ag.surface2,
	color: ag.muted,
} satisfies React.CSSProperties;
const inputResetStyle = {
	flex: 1,
	border: 0,
	outline: 0,
	background: "transparent",
	color: ag.ink,
	fontFamily: "inherit",
	fontSize: 12,
} satisfies React.CSSProperties;
const tableStyle = {
	border: `1px solid ${ag.line}`,
	borderRadius: 5,
	overflow: "hidden",
	background: ag.surface2,
} satisfies React.CSSProperties;
const rowStyle = {
	display: "grid",
	gridTemplateColumns:
		"minmax(230px,1.4fr) minmax(220px,1.2fr) minmax(150px,.8fr) 150px 90px",
	alignItems: "center",
	gap: 14,
	padding: "12px 16px",
	borderBottom: `1px solid ${ag.line2}`,
	color: ag.text2,
	fontSize: 12.5,
} satisfies React.CSSProperties;
const headerStyle = {
	padding: "9px 16px",
	background: ag.surface,
	color: ag.muted,
	fontSize: 10.5,
	fontWeight: 500,
	textTransform: "uppercase",
	letterSpacing: "0.07em",
} satisfies React.CSSProperties;
const emptyStyle = {
	minHeight: 280,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	gap: 12,
	textAlign: "center",
	color: ag.muted,
	border: `1px solid ${ag.line}`,
	borderRadius: 5,
	background: ag.surface2,
	fontSize: 13,
} satisfies React.CSSProperties;
