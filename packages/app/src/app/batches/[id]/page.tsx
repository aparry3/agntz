"use client";

import { I } from "@/components/v3/icons";
import { Btn, Crumbs, Label, Mono, Tag, ag } from "@/components/v3/primitives";
import { YamlEditor } from "@/components/yaml-editor";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { parse, stringify } from "yaml";

interface Dataset {
	id: string;
	name: string;
	itemCount?: number;
	items?: unknown[];
}

interface BatchDefinition {
	id: string;
	name?: string;
	description?: string;
	manifest: string;
	provider: string;
	model: string;
	defaultDataset?: { id: string; version?: string };
	version?: string;
	updatedAt?: string;
}

interface BatchCounts {
	total: number;
	pending: number;
	succeeded: number;
	failed: number;
	expired: number;
	cancelled: number;
}

interface BatchRun {
	id: string;
	batchId: string;
	batchVersion: string;
	datasetId?: string;
	datasetVersion?: string;
	provider: string;
	model: string;
	status: string;
	counts: BatchCounts;
	createdAt: string;
	endedAt?: string;
	error?: string;
}

interface BatchRunItem {
	runId: string;
	itemId: string;
	ordinal: number;
	status: string;
	input: unknown;
	output?: unknown;
	rawOutput?: string;
	error?: string;
}

interface ComparisonRow {
	itemId: string;
	input?: unknown;
	left?: BatchRunItem;
	right?: BatchRunItem;
}

interface Comparison {
	leftRun: BatchRun;
	rightRun: BatchRun;
	rows: ComparisonRow[];
	datasetVersionsMatch: boolean;
}

const ACTIVE_STATUSES = new Set([
	"validating",
	"submitting",
	"queued",
	"running",
	"cancelling",
]);
const PROVIDERS = ["openai", "anthropic", "google", "mistral"];

export default function BatchDetailPage() {
	const params = useParams<{ id: string }>();
	const batchId = decodeURIComponent(params.id);
	const [batch, setBatch] = useState<BatchDefinition | null>(null);
	const [manifest, setManifest] = useState("");
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [runs, setRuns] = useState<BatchRun[]>([]);
	const [datasetId, setDatasetId] = useState("");
	const [selectedRunId, setSelectedRunId] = useState("");
	const [items, setItems] = useState<BatchRunItem[]>([]);
	const [compareIds, setCompareIds] = useState<string[]>([]);
	const [comparison, setComparison] = useState<Comparison | null>(null);
	const [saving, setSaving] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [loadingItems, setLoadingItems] = useState(false);
	const [comparing, setComparing] = useState(false);
	const [error, setError] = useState("");

	const loadRuns = useCallback(async () => {
		const response = await fetch(
			`/api/batch-runs?batchId=${encodeURIComponent(batchId)}&limit=200`,
		);
		const page = await response.json();
		if (!response.ok) throw new Error(page.error ?? "Could not load runs");
		setRuns(Array.isArray(page.rows) ? page.rows : []);
	}, [batchId]);

	const load = useCallback(async () => {
		try {
			const [batchResponse, datasetsResponse] = await Promise.all([
				fetch(`/api/batches/${encodeURIComponent(batchId)}`),
				fetch("/api/datasets"),
			]);
			const [definition, datasetRows] = await Promise.all([
				batchResponse.json(),
				datasetsResponse.json(),
			]);
			if (!batchResponse.ok) {
				throw new Error(definition.error ?? "Could not load batch");
			}
			if (!datasetsResponse.ok) {
				throw new Error(datasetRows.error ?? "Could not load datasets");
			}
			setBatch(definition);
			setManifest(definition.manifest);
			setDatasetId(definition.defaultDataset?.id ?? "");
			setDatasets(Array.isArray(datasetRows) ? datasetRows : []);
			await loadRuns();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [batchId, loadRuns]);

	useEffect(() => {
		void load();
	}, [load]);

	const hasActiveRun = runs.some((run) => ACTIVE_STATUSES.has(run.status));
	useEffect(() => {
		if (!hasActiveRun) return;
		const timer = window.setInterval(() => {
			void loadRuns().catch((cause) =>
				setError(cause instanceof Error ? cause.message : String(cause)),
			);
		}, 8_000);
		return () => window.clearInterval(timer);
	}, [hasActiveRun, loadRuns]);

	const manifestModel = useMemo(() => readManifestModel(manifest), [manifest]);
	const selectedRun = runs.find((run) => run.id === selectedRunId);

	const updateManifestModel = (provider: string, model: string) => {
		try {
			const value = parse(manifest) as Record<string, unknown>;
			const current =
				typeof value.model === "object" && value.model !== null
					? (value.model as Record<string, unknown>)
					: {};
			value.model = { ...current, provider, name: model };
			setManifest(stringify(value, { lineWidth: 0 }));
			setError("");
		} catch {
			setError("Fix the YAML before changing provider or model.");
		}
	};

	const save = async () => {
		setSaving(true);
		setError("");
		try {
			const response = await fetch(
				`/api/batches/${encodeURIComponent(batchId)}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ manifest }),
				},
			);
			const definition = await response.json();
			if (!response.ok) {
				throw new Error(definition.error ?? "Could not save batch version");
			}
			setBatch(definition);
			setManifest(definition.manifest);
			setDatasetId(definition.defaultDataset?.id ?? datasetId);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSaving(false);
		}
	};

	const run = async (source?: BatchRun) => {
		setSubmitting(true);
		setError("");
		try {
			const response = await fetch("/api/batch-runs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					batchId,
					datasetId: (source?.datasetId ?? datasetId) || undefined,
					datasetVersion: source?.datasetVersion,
				}),
			});
			const created = await response.json();
			if (!response.ok) {
				throw new Error(created.error ?? "Could not submit batch");
			}
			setRuns((current) => [
				created,
				...current.filter((candidate) => candidate.id !== created.id),
			]);
			setSelectedRunId(created.id);
			setItems([]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSubmitting(false);
		}
	};

	const showRun = async (runId: string) => {
		setSelectedRunId(runId);
		setLoadingItems(true);
		setError("");
		try {
			const response = await fetch(
				`/api/batch-runs/${encodeURIComponent(runId)}/items?limit=1000`,
			);
			const page = await response.json();
			if (!response.ok) {
				throw new Error(page.error ?? "Could not load batch items");
			}
			setItems(Array.isArray(page.rows) ? page.rows : []);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoadingItems(false);
		}
	};

	const cancel = async (runId: string) => {
		setError("");
		try {
			const response = await fetch(
				`/api/batch-runs/${encodeURIComponent(runId)}/cancel`,
				{ method: "POST" },
			);
			const updated = await response.json();
			if (!response.ok) {
				throw new Error(updated.error ?? "Could not cancel batch");
			}
			setRuns((current) =>
				current.map((candidate) =>
					candidate.id === updated.id ? updated : candidate,
				),
			);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const deleteRun = async (runId: string) => {
		if (
			!window.confirm(
				"Delete this batch run and its retained normalized results?",
			)
		) {
			return;
		}
		setError("");
		try {
			const response = await fetch(
				`/api/batch-runs/${encodeURIComponent(runId)}`,
				{ method: "DELETE" },
			);
			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body.error ?? "Could not delete batch run");
			}
			setRuns((current) => current.filter((run) => run.id !== runId));
			setCompareIds((current) => current.filter((id) => id !== runId));
			setComparison(null);
			if (selectedRunId === runId) {
				setSelectedRunId("");
				setItems([]);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const toggleCompare = (runId: string) => {
		setComparison(null);
		setCompareIds((current) => {
			if (current.includes(runId)) {
				return current.filter((id) => id !== runId);
			}
			return [...current.slice(-1), runId];
		});
	};

	const compare = async () => {
		if (compareIds.length !== 2) return;
		setComparing(true);
		setError("");
		try {
			const query = new URLSearchParams({
				left: compareIds[0],
				right: compareIds[1],
				limit: "1000",
			});
			const response = await fetch(`/api/batch-runs/compare?${query}`);
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error ?? "Could not compare runs");
			}
			setComparison(result);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setComparing(false);
		}
	};

	if (!batch && !error) {
		return <EmptyState text="Loading batch…" />;
	}

	return (
		<div style={{ minHeight: "100vh" }}>
			<header style={headerStyle}>
				<Crumbs
					trail={[
						"agntz",
						<Link key="batches" href="/batches" style={crumbLinkStyle}>
							Batches
						</Link>,
						batch?.name ?? batchId,
					]}
				/>
				<div style={headerRowStyle}>
					<div>
						<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
							<h1 style={titleStyle}>{batch?.name ?? batchId}</h1>
							{batch && (
								<Tag bg={ag.blueBg} color={ag.blue} mono>
									{batch.provider}
								</Tag>
							)}
						</div>
						<p style={subtitleStyle}>
							{batch?.description ??
								"Version the manifest, run a dataset, and compare model outputs."}
						</p>
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<Btn
							variant="secondary"
							disabled={saving}
							onClick={() => void save()}
						>
							{saving ? "Saving…" : "Save new version"}
						</Btn>
						<Btn
							icon={<I.Play size={11} />}
							disabled={submitting || !datasetId}
							onClick={() => void run()}
						>
							{submitting ? "Submitting…" : "Run batch"}
						</Btn>
					</div>
				</div>
			</header>

			{error && <div style={errorStyle}>{error}</div>}

			<section style={definitionGridStyle}>
				<div style={editorPanelStyle}>
					<div style={panelHeaderStyle}>
						<div>
							<Label>Definition</Label>
							<Mono size={11} color={ag.muted}>
								{batch?.version
									? `version ${batch.version}`
									: "YAML · kind: llm"}
							</Mono>
						</div>
						<Mono size={10} color={ag.muted}>
							⌘S to save
						</Mono>
					</div>
					<div style={{ height: 430 }}>
						<YamlEditor
							value={manifest}
							onChange={setManifest}
							onSaveShortcut={() => void save()}
						/>
					</div>
				</div>

				<aside style={controlsStyle}>
					<div>
						<Label>Model swap</Label>
						<p style={helpStyle}>
							Change only the model, save a version, then rerun the same dataset
							for a clean comparison.
						</p>
						<div style={twoColumnStyle}>
							<select
								value={manifestModel.provider}
								onChange={(event) =>
									updateManifestModel(event.target.value, manifestModel.model)
								}
								style={controlStyle}
							>
								{PROVIDERS.map((provider) => (
									<option key={provider} value={provider}>
										{provider}
									</option>
								))}
							</select>
							<input
								value={manifestModel.model}
								onChange={(event) =>
									updateManifestModel(
										manifestModel.provider,
										event.target.value,
									)
								}
								placeholder="Model name"
								style={controlStyle}
							/>
						</div>
					</div>

					<div style={dividerStyle} />

					<div>
						<Label>Run dataset</Label>
						<p style={helpStyle}>
							This selection overrides the manifest default for the next run.
						</p>
						<select
							value={datasetId}
							onChange={(event) => setDatasetId(event.target.value)}
							style={controlStyle}
						>
							<option value="">Select a dataset…</option>
							{datasets.map((dataset) => (
								<option key={dataset.id} value={dataset.id}>
									{dataset.name} (
									{dataset.itemCount ?? dataset.items?.length ?? 0})
								</option>
							))}
						</select>
					</div>

					<div style={definitionFactsStyle}>
						<Fact label="Batch id" value={batchId} />
						<Fact label="Active version" value={batch?.version ?? "—"} />
						<Fact
							label="Default dataset"
							value={batch?.defaultDataset?.id ?? "—"}
						/>
						<Fact label="Runs" value={String(runs.length)} />
					</div>
				</aside>
			</section>

			<section style={runsSectionStyle}>
				<div style={sectionTitleRowStyle}>
					<div>
						<h2 style={sectionTitleStyle}>Runs</h2>
						<p style={sectionSubtitleStyle}>
							Select two completed runs to compare their item-level outputs.
						</p>
					</div>
					<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
						<Mono size={11} color={ag.muted}>
							{compareIds.length}/2 selected
						</Mono>
						<Btn
							variant="secondary"
							icon={<I.Code size={11} />}
							disabled={compareIds.length !== 2 || comparing}
							onClick={() => void compare()}
						>
							{comparing ? "Comparing…" : "Compare"}
						</Btn>
					</div>
				</div>

				{runs.length === 0 ? (
					<EmptyState text="No runs yet. Select a dataset and submit this manifest." />
				) : (
					<div style={runTableStyle}>
						<div style={{ ...runRowStyle, ...tableHeaderStyle }}>
							<div>Compare</div>
							<div>Run</div>
							<div>Model</div>
							<div>Dataset</div>
							<div>Progress</div>
							<div>Status</div>
							<div />
						</div>
						{runs.map((row) => (
							<div
								key={row.id}
								style={{
									...runRowStyle,
									background:
										selectedRunId === row.id ? ag.surfaceWarm : ag.surface,
								}}
							>
								<div>
									<input
										type="checkbox"
										aria-label={`Compare run ${row.id}`}
										checked={compareIds.includes(row.id)}
										disabled={
											!compareIds.includes(row.id) && compareIds.length === 2
										}
										onChange={() => toggleCompare(row.id)}
									/>
								</div>
								<button
									style={runLinkStyle}
									onClick={() => void showRun(row.id)}
								>
									<Mono size={11}>{shortId(row.id)}</Mono>
									<Mono size={10} color={ag.muted}>
										{formatTime(row.createdAt)}
									</Mono>
								</button>
								<div>
									<Mono size={11}>{row.model}</Mono>
									<div>
										<Mono size={10} color={ag.muted}>
											{row.provider} · {shortVersion(row.batchVersion)}
										</Mono>
									</div>
								</div>
								<Mono size={11}>{row.datasetId ?? "inline"}</Mono>
								<Progress counts={row.counts} />
								<RunStatus status={row.status} />
								<div style={{ display: "flex", gap: 4, justifyContent: "end" }}>
									{ACTIVE_STATUSES.has(row.status) ? (
										<Btn
											size="sm"
											variant="danger"
											onClick={() => void cancel(row.id)}
										>
											Cancel
										</Btn>
									) : (
										<>
											<Btn
												size="sm"
												variant="ghost"
												icon={<I.Play size={9} />}
												disabled={submitting}
												onClick={() => void run(row)}
											>
												Rerun
											</Btn>
											<Btn
												size="sm"
												variant="danger"
												onClick={() => void deleteRun(row.id)}
											>
												Delete
											</Btn>
										</>
									)}
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			{comparison ? (
				<ComparisonPanel comparison={comparison} />
			) : selectedRun ? (
				<ResultsPanel run={selectedRun} items={items} loading={loadingItems} />
			) : null}
		</div>
	);
}

function ComparisonPanel({ comparison }: { comparison: Comparison }) {
	return (
		<section style={resultsSectionStyle}>
			<div style={sectionTitleRowStyle}>
				<div>
					<h2 style={sectionTitleStyle}>Output comparison</h2>
					<p style={sectionSubtitleStyle}>
						<Mono size={11}>{comparison.leftRun.model}</Mono> against{" "}
						<Mono size={11}>{comparison.rightRun.model}</Mono>
					</p>
				</div>
				<Tag
					bg={comparison.datasetVersionsMatch ? ag.okBg : ag.warnBg}
					color={comparison.datasetVersionsMatch ? ag.ok : ag.warn}
				>
					{comparison.datasetVersionsMatch
						? "same dataset version"
						: "dataset versions differ"}
				</Tag>
			</div>
			<div style={comparisonHeaderStyle}>
				<div>Input</div>
				<div>{comparison.leftRun.model}</div>
				<div>{comparison.rightRun.model}</div>
			</div>
			{comparison.rows.map((row) => (
				<div key={row.itemId} style={comparisonRowStyle}>
					<OutputCell label={row.itemId} status="input" value={row.input} />
					<OutputCell
						status={row.left?.status ?? "missing"}
						value={row.left?.output ?? row.left?.error}
					/>
					<OutputCell
						status={row.right?.status ?? "missing"}
						value={row.right?.output ?? row.right?.error}
					/>
				</div>
			))}
		</section>
	);
}

function ResultsPanel({
	run,
	items,
	loading,
}: {
	run: BatchRun;
	items: BatchRunItem[];
	loading: boolean;
}) {
	return (
		<section style={resultsSectionStyle}>
			<div style={sectionTitleRowStyle}>
				<div>
					<h2 style={sectionTitleStyle}>Run results</h2>
					<p style={sectionSubtitleStyle}>
						<Mono size={11}>{run.id}</Mono>
					</p>
				</div>
				<a
					href={`/api/batch-runs/${encodeURIComponent(run.id)}/results.jsonl`}
					style={downloadLinkStyle}
				>
					<I.Code size={11} /> Export normalized JSONL
				</a>
			</div>
			{run.error && <div style={inlineErrorStyle}>{run.error}</div>}
			{loading ? (
				<EmptyState text="Loading result items…" />
			) : items.length === 0 ? (
				<EmptyState text="No item results are available yet." />
			) : (
				<div style={itemsTableStyle}>
					{items.map((item) => (
						<div key={item.itemId} style={itemRowStyle}>
							<div>
								<Mono size={11}>{item.itemId}</Mono>
								<div style={{ marginTop: 5 }}>
									<RunStatus status={item.status} />
								</div>
							</div>
							<pre style={preStyle}>{renderValue(item.input)}</pre>
							<pre style={preStyle}>
								{renderValue(item.output ?? item.rawOutput ?? item.error)}
							</pre>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

function OutputCell({
	label,
	status,
	value,
}: {
	label?: string;
	status: string;
	value: unknown;
}) {
	return (
		<div style={outputCellStyle}>
			<div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
				{label ? (
					<Mono size={10} color={ag.muted}>
						{label}
					</Mono>
				) : (
					<span />
				)}
				<Mono size={10} color={statusColor(status)}>
					{status}
				</Mono>
			</div>
			<pre style={{ ...preStyle, marginTop: 8 }}>{renderValue(value)}</pre>
		</div>
	);
}

function Progress({ counts }: { counts: BatchCounts }) {
	const finished = Math.max(0, counts.total - counts.pending);
	const width = counts.total ? `${(finished / counts.total) * 100}%` : "0%";
	return (
		<div>
			<div style={progressTrackStyle}>
				<div style={{ ...progressFillStyle, width }} />
			</div>
			<Mono size={10} color={ag.muted}>
				{finished}/{counts.total}
				{counts.failed ? ` · ${counts.failed} failed` : ""}
			</Mono>
		</div>
	);
}

function RunStatus({ status }: { status: string }) {
	const color = statusColor(status);
	const background =
		color === ag.ok ? ag.okBg : color === ag.warn ? ag.warnBg : ag.blueBg;
	return (
		<Tag bg={background} color={color}>
			<I.Dot size={6} color={color} />
			{status}
		</Tag>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<Label>{label}</Label>
			<Mono size={11}>{value}</Mono>
		</div>
	);
}

function EmptyState({ text }: { text: string }) {
	return (
		<div style={emptyStyle}>
			<I.Box size={22} />
			{text}
		</div>
	);
}

function readManifestModel(value: string) {
	try {
		const doc = parse(value) as {
			model?: { provider?: string; name?: string } | string;
		};
		if (typeof doc.model === "string") {
			return { provider: "openai", model: doc.model };
		}
		return {
			provider: doc.model?.provider ?? "openai",
			model: doc.model?.name ?? "",
		};
	} catch {
		return { provider: "openai", model: "" };
	}
}

function renderValue(value: unknown) {
	if (value === undefined || value === null) return "—";
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

function statusColor(status: string) {
	if (["completed", "succeeded"].includes(status)) return ag.ok;
	if (["failed", "expired", "cancelled", "missing"].includes(status)) {
		return ag.warn;
	}
	return ag.blue;
}

function shortId(value: string) {
	return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function shortVersion(value: string) {
	return value.length > 12 ? value.slice(0, 12) : value;
}

function formatTime(value: string) {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(value));
}

const headerStyle = {
	padding: "20px 28px 16px",
	borderBottom: `1px solid ${ag.line2}`,
} satisfies CSSProperties;
const headerRowStyle = {
	display: "flex",
	alignItems: "flex-end",
	justifyContent: "space-between",
	gap: 20,
	marginTop: 8,
} satisfies CSSProperties;
const titleStyle = {
	margin: 0,
	fontSize: 23,
	fontWeight: 600,
	letterSpacing: "-0.015em",
} satisfies CSSProperties;
const subtitleStyle = {
	margin: "5px 0 0",
	maxWidth: 720,
	fontSize: 12.5,
	lineHeight: 1.5,
	color: ag.text2,
} satisfies CSSProperties;
const crumbLinkStyle = {
	color: "inherit",
	textDecoration: "none",
} satisfies CSSProperties;
const errorStyle = {
	padding: "9px 28px",
	background: "var(--ag-danger-bg, #fff0ef)",
	color: ag.danger,
	borderBottom: `1px solid ${ag.line}`,
	fontSize: 12,
} satisfies CSSProperties;
const definitionGridStyle = {
	display: "grid",
	gridTemplateColumns: "minmax(0, 1fr) 350px",
	borderBottom: `1px solid ${ag.line}`,
} satisfies CSSProperties;
const editorPanelStyle = {
	minWidth: 0,
	background: ag.surface2,
	borderRight: `1px solid ${ag.line}`,
} satisfies CSSProperties;
const panelHeaderStyle = {
	height: 51,
	padding: "0 16px",
	borderBottom: `1px solid ${ag.line}`,
	background: ag.surface,
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
} satisfies CSSProperties;
const controlsStyle = {
	padding: 18,
	background: ag.surface,
	display: "flex",
	flexDirection: "column",
	gap: 18,
} satisfies CSSProperties;
const helpStyle = {
	margin: "6px 0 10px",
	color: ag.text2,
	fontSize: 12,
	lineHeight: 1.5,
} satisfies CSSProperties;
const twoColumnStyle = {
	display: "grid",
	gridTemplateColumns: "120px minmax(0, 1fr)",
	gap: 7,
} satisfies CSSProperties;
const controlStyle = {
	width: "100%",
	minWidth: 0,
	padding: "7px 8px",
	border: `1px solid ${ag.line}`,
	borderRadius: 4,
	background: ag.surface2,
	color: ag.ink,
	fontFamily: "inherit",
	fontSize: 12,
	outline: "none",
} satisfies CSSProperties;
const dividerStyle = {
	height: 1,
	background: ag.line2,
} satisfies CSSProperties;
const definitionFactsStyle = {
	display: "grid",
	gridTemplateColumns: "1fr 1fr",
	gap: 17,
	padding: 14,
	background: ag.surface2,
	border: `1px solid ${ag.line2}`,
	borderRadius: 4,
	marginTop: "auto",
} satisfies CSSProperties;
const runsSectionStyle = {
	padding: "22px 28px 28px",
	borderBottom: `1px solid ${ag.line}`,
} satisfies CSSProperties;
const resultsSectionStyle = {
	padding: "22px 28px 40px",
} satisfies CSSProperties;
const sectionTitleRowStyle = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	gap: 20,
	marginBottom: 12,
} satisfies CSSProperties;
const sectionTitleStyle = {
	margin: 0,
	fontSize: 16,
	fontWeight: 600,
} satisfies CSSProperties;
const sectionSubtitleStyle = {
	margin: "3px 0 0",
	fontSize: 11.5,
	color: ag.muted,
} satisfies CSSProperties;
const runTableStyle = {
	border: `1px solid ${ag.line}`,
	borderRadius: 5,
	overflow: "hidden",
} satisfies CSSProperties;
const runRowStyle = {
	display: "grid",
	gridTemplateColumns:
		"54px minmax(135px, .75fr) minmax(150px, 1fr) minmax(100px, .7fr) minmax(100px, .6fr) 105px 100px",
	alignItems: "center",
	gap: 12,
	minHeight: 54,
	padding: "0 12px",
	borderBottom: `1px solid ${ag.line2}`,
	fontSize: 12,
} satisfies CSSProperties;
const tableHeaderStyle = {
	minHeight: 34,
	background: ag.surface2,
	color: ag.muted,
	fontSize: 10.5,
	textTransform: "uppercase",
	letterSpacing: "0.04em",
} satisfies CSSProperties;
const runLinkStyle = {
	padding: 0,
	border: 0,
	background: "transparent",
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	gap: 3,
	cursor: "pointer",
	textAlign: "left",
} satisfies CSSProperties;
const progressTrackStyle = {
	width: 82,
	height: 3,
	borderRadius: 2,
	background: ag.line2,
	marginBottom: 5,
	overflow: "hidden",
} satisfies CSSProperties;
const progressFillStyle = {
	height: "100%",
	background: ag.ok,
} satisfies CSSProperties;
const downloadLinkStyle = {
	display: "inline-flex",
	alignItems: "center",
	gap: 5,
	padding: "6px 9px",
	border: `1px solid ${ag.line}`,
	borderRadius: 4,
	background: ag.surface2,
	color: ag.ink,
	fontSize: 11.5,
	textDecoration: "none",
} satisfies CSSProperties;
const itemsTableStyle = {
	border: `1px solid ${ag.line}`,
	borderRadius: 5,
	overflow: "hidden",
} satisfies CSSProperties;
const itemRowStyle = {
	display: "grid",
	gridTemplateColumns: "130px minmax(0, 1fr) minmax(0, 1fr)",
	gap: 14,
	padding: 14,
	borderBottom: `1px solid ${ag.line2}`,
} satisfies CSSProperties;
const preStyle = {
	margin: 0,
	padding: 10,
	maxHeight: 240,
	overflow: "auto",
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
	borderRadius: 3,
	background: ag.surface2,
	color: ag.text2,
	fontFamily: "var(--font-mono)",
	fontSize: 10.5,
	lineHeight: 1.5,
} satisfies CSSProperties;
const comparisonHeaderStyle = {
	display: "grid",
	gridTemplateColumns: "minmax(0, .8fr) minmax(0, 1fr) minmax(0, 1fr)",
	gap: 1,
	padding: "8px 11px",
	background: ag.surface2,
	border: `1px solid ${ag.line}`,
	color: ag.muted,
	fontSize: 10.5,
} satisfies CSSProperties;
const comparisonRowStyle = {
	display: "grid",
	gridTemplateColumns: "minmax(0, .8fr) minmax(0, 1fr) minmax(0, 1fr)",
	gap: 1,
	background: ag.line2,
	borderLeft: `1px solid ${ag.line}`,
	borderRight: `1px solid ${ag.line}`,
	borderBottom: `1px solid ${ag.line}`,
} satisfies CSSProperties;
const outputCellStyle = {
	minWidth: 0,
	padding: 11,
	background: ag.surface,
} satisfies CSSProperties;
const inlineErrorStyle = {
	marginBottom: 12,
	padding: 10,
	background: ag.warnBg,
	color: ag.warn,
	borderRadius: 4,
	fontSize: 12,
} satisfies CSSProperties;
const emptyStyle = {
	minHeight: 120,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	gap: 8,
	color: ag.muted,
	fontSize: 12,
} satisfies CSSProperties;
