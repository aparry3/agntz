"use client";

import { I } from "@/components/v3/icons";
import { Btn, Mono, Tag, ag } from "@/components/v3/primitives";
import type {
	AgentVersionSummary,
	EvalDataset,
	EvalDefinition,
	EvalLatestScore,
	EvalRun,
} from "@agntz/core";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

export function EvalPanel({ agentId }: { agentId: string }) {
	const [evals, setEvals] = useState<EvalDefinition[]>([]);
	const [datasets, setDatasets] = useState<EvalDataset[]>([]);
	const [runs, setRuns] = useState<EvalRun[]>([]);
	const [versions, setVersions] = useState<AgentVersionSummary[]>([]);
	const [latestScores, setLatestScores] = useState<EvalLatestScore[]>([]);
	const [selectedVersionRefs, setSelectedVersionRefs] = useState<string[]>([
		"latest",
	]);
	const [selectedDatasetId, setSelectedDatasetId] = useState("");
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [runningEvalId, setRunningEvalId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [evalName, setEvalName] = useState("Quality check");
	const [criterionName, setCriterionName] = useState("Accuracy");
	const [criterionDescription, setCriterionDescription] = useState(
		"Output should answer the input correctly and match the expected result when one is provided.",
	);
	const [datasetName, setDatasetName] = useState("Regression cases");
	const [datasetLines, setDatasetLines] = useState(
		"Question => Expected answer",
	);

	const load = async () => {
		setError(null);
		const [evalRows, datasetRows, runRows, versionRows, scoreRows] =
			await Promise.all([
				fetch(`/api/evals?agentId=${encodeURIComponent(agentId)}`).then((r) =>
					r.json(),
				),
				fetch(`/api/datasets?agentId=${encodeURIComponent(agentId)}`).then(
					(r) => r.json(),
				),
				fetch(`/api/eval-runs?agentId=${encodeURIComponent(agentId)}`).then(
					(r) => r.json(),
				),
				fetch(`/api/agents/${encodeURIComponent(agentId)}/versions`).then((r) =>
					r.json(),
				),
				fetch(`/api/eval-scores?agentId=${encodeURIComponent(agentId)}`).then(
					(r) => r.json(),
				),
			]);
		setEvals(Array.isArray(evalRows) ? evalRows : []);
		setDatasets(Array.isArray(datasetRows) ? datasetRows : []);
		setRuns(Array.isArray(runRows.rows) ? runRows.rows : []);
		setVersions(Array.isArray(versionRows) ? versionRows : []);
		setLatestScores(Array.isArray(scoreRows) ? scoreRows : []);
		if (!selectedDatasetId && Array.isArray(datasetRows) && datasetRows[0]) {
			setSelectedDatasetId(datasetRows[0].id);
		}
		setLoading(false);
	};

	useEffect(() => {
		void load().catch((err) => {
			setError(String(err));
			setLoading(false);
		});
	}, [agentId]);

	useEffect(() => {
		if (
			!runs.some((run) => run.status === "running" || run.status === "pending")
		) {
			return;
		}
		const timer = window.setInterval(() => {
			void load().catch((err) => setError(String(err)));
		}, 1500);
		return () => window.clearInterval(timer);
	}, [runs, agentId]);

	const latestByEval = useMemo(() => {
		const map = new Map<string, EvalRun>();
		for (const run of runs) {
			if (!map.has(run.evalId)) map.set(run.evalId, run);
		}
		return map;
	}, [runs]);

	const versionOptions = useMemo(
		() => buildVersionOptions(versions),
		[versions],
	);

	const latestScoreByKey = useMemo(() => {
		const map = new Map<string, EvalLatestScore>();
		for (const score of latestScores) {
			map.set(
				scoreKey(score.evalId, score.datasetId, score.resolvedAgentVersion),
				score,
			);
		}
		return map;
	}, [latestScores]);

	const selectedRun =
		runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

	const createDataset = async () => {
		setError(null);
		const items = datasetLines
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line, index) => {
				const [input, ...expectedParts] = line.split("=>");
				return {
					id: `case_${String(index + 1).padStart(3, "0")}`,
					input: input.trim(),
					expected: expectedParts.join("=>").trim() || undefined,
				};
			});
		const res = await fetch("/api/datasets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ agentId, name: datasetName, items }),
		});
		const data = await res.json();
		if (!res.ok) {
			setError(data.error ?? "Failed to create dataset");
			return;
		}
		setSelectedDatasetId(data.id);
		await load();
	};

	const createEval = async () => {
		setError(null);
		const res = await fetch("/api/evals", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				agentId,
				name: evalName,
				defaultDatasetId: selectedDatasetId || undefined,
				passThreshold: 0.7,
				criteria: [
					{
						id: slug(criterionName) || "quality",
						name: criterionName,
						description: criterionDescription,
						weight: 1,
					},
				],
			}),
		});
		const data = await res.json();
		if (!res.ok) {
			setError(data.error ?? "Failed to create eval");
			return;
		}
		await load();
	};

	const runEval = async (definition: EvalDefinition, versionRef?: string) => {
		setError(null);
		setRunningEvalId(definition.id);
		try {
			const datasetId = definition.defaultDatasetId || selectedDatasetId;
			const res = await fetch("/api/eval-runs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					evalId: definition.id,
					datasetId,
					agentVersion: versionRef === "current" ? undefined : versionRef,
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				setError(data.error ?? "Failed to run eval");
				return;
			}
			setSelectedRunId(data.id);
			await load();
		} finally {
			setRunningEvalId(null);
		}
	};

	const cancelRun = async (runId: string) => {
		setError(null);
		const res = await fetch(
			`/api/eval-runs/${encodeURIComponent(runId)}/cancel`,
			{ method: "POST" },
		);
		const data = await res.json();
		if (!res.ok) {
			setError(data.error ?? "Failed to cancel eval run");
			return;
		}
		setSelectedRunId(data.id);
		await load();
	};

	const toggleVersionRef = (value: string) => {
		setSelectedVersionRefs((current) =>
			current.includes(value)
				? current.filter((row) => row !== value)
				: [...current, value],
		);
	};

	return (
		<aside
			style={{
				background: ag.surface,
				borderLeft: `1px solid ${ag.line2}`,
				minHeight: 0,
				overflow: "auto",
				padding: 16,
			}}
		>
			<Header
				title="Evals"
				right={loading ? <Mono size={11}>loading</Mono> : null}
			/>
			{error && (
				<div
					style={{
						color: ag.danger,
						background: "#FBEFEA",
						border: `1px solid ${ag.line}`,
						borderRadius: 4,
						padding: 8,
						fontSize: 12,
						marginBottom: 12,
					}}
				>
					{error}
				</div>
			)}

			<Section label="Compare Versions">
				{versionOptions.map((option) => (
					<label key={option.value} style={checkboxRowStyle}>
						<input
							type="checkbox"
							checked={selectedVersionRefs.includes(option.value)}
							onChange={() => toggleVersionRef(option.value)}
						/>
						<Mono size={11}>{option.label}</Mono>
					</label>
				))}
				{versionOptions.length === 0 && <EmptyText>No versions yet</EmptyText>}
			</Section>

			<Section label="Definitions">
				{evals.map((definition) => {
					const latest = latestByEval.get(definition.id);
					const datasetId = definition.defaultDatasetId || selectedDatasetId;
					const compareOptions = versionOptions.filter((option) =>
						selectedVersionRefs.includes(option.value),
					);
					return (
						<div key={definition.id} style={{ ...rowStyle, display: "block" }}>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<div style={{ minWidth: 0, flex: 1 }}>
									<div style={{ fontSize: 13, fontWeight: 600, color: ag.ink }}>
										{definition.name}
									</div>
									<Mono size={11} color={ag.muted}>
										{definition.criteria.length} criteria ·{" "}
										{datasetId || "no dataset"}
									</Mono>
									<div style={{ marginTop: 6 }}>
										{latest ? (
											<ScoreTag run={latest} />
										) : (
											<Tag bg="transparent" color={ag.muted}>
												not run
											</Tag>
										)}
									</div>
								</div>
								<Btn
									size="sm"
									variant="secondary"
									disabled={runningEvalId === definition.id || !datasetId}
									icon={<I.Play size={10} style={{ marginRight: 5 }} />}
									onClick={() => runEval(definition)}
								>
									{runningEvalId === definition.id ? "Running" : "Run"}
								</Btn>
							</div>
							{compareOptions.length > 0 && datasetId && (
								<div style={{ marginTop: 10, display: "grid", gap: 6 }}>
									{compareOptions.map((option) => {
										const score = latestScoreByKey.get(
											scoreKey(
												definition.id,
												datasetId,
												option.resolvedVersion,
											),
										);
										return (
											<div key={option.value} style={compareRowStyle}>
												<Mono size={11}>{option.label}</Mono>
												{score ? (
													<ScorePill score={score} />
												) : (
													<Tag bg="transparent" color={ag.muted}>
														no score
													</Tag>
												)}
												<Btn
													size="sm"
													variant="secondary"
													disabled={runningEvalId === definition.id}
													onClick={() => runEval(definition, option.runVersion)}
												>
													{score ? "Rerun" : "Run"}
												</Btn>
											</div>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
				{evals.length === 0 && <EmptyText>No evals yet</EmptyText>}
			</Section>

			<Section label="Create Eval">
				<Field label="Name" value={evalName} onChange={setEvalName} />
				<Field
					label="Criterion"
					value={criterionName}
					onChange={setCriterionName}
				/>
				<TextArea
					label="Rubric"
					value={criterionDescription}
					onChange={setCriterionDescription}
					rows={3}
				/>
				<select
					value={selectedDatasetId}
					onChange={(e) => setSelectedDatasetId(e.target.value)}
					style={inputStyle}
				>
					<option value="">No dataset</option>
					{datasets.map((dataset) => (
						<option key={dataset.id} value={dataset.id}>
							{dataset.name}
						</option>
					))}
				</select>
				<Btn size="sm" onClick={createEval} style={{ marginTop: 8 }}>
					Create Eval
				</Btn>
			</Section>

			<Section label="Datasets">
				{datasets.map((dataset) => (
					<div key={dataset.id} style={rowStyle}>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ fontSize: 13, fontWeight: 600 }}>
								{dataset.name}
							</div>
							<Mono size={11} color={ag.muted}>
								{dataset.items.length} cases
							</Mono>
						</div>
						<input
							type="radio"
							checked={selectedDatasetId === dataset.id}
							onChange={() => setSelectedDatasetId(dataset.id)}
						/>
					</div>
				))}
				<Field label="Name" value={datasetName} onChange={setDatasetName} />
				<TextArea
					label="Cases"
					value={datasetLines}
					onChange={setDatasetLines}
					rows={4}
				/>
				<Btn size="sm" variant="secondary" onClick={createDataset}>
					Create Dataset
				</Btn>
			</Section>

			<Section label="Run History">
				{runs.map((run) => (
					<button
						key={run.id}
						type="button"
						onClick={() => setSelectedRunId(run.id)}
						style={{
							...rowStyle,
							width: "100%",
							textAlign: "left",
							background:
								selectedRun?.id === run.id ? ag.surface2 : "transparent",
							cursor: "pointer",
							fontFamily: "inherit",
						}}
					>
						<div style={{ flex: 1, minWidth: 0 }}>
							<Mono size={11}>{run.id}</Mono>
							<div style={{ marginTop: 5 }}>
								<ScoreTag run={run} />
							</div>
						</div>
						<Mono size={11} color={ag.muted}>
							{formatDate(run.startedAt)}
						</Mono>
					</button>
				))}
				{runs.length === 0 && <EmptyText>No runs yet</EmptyText>}
			</Section>

			{selectedRun && (
				<Section label="Run Detail">
					<div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
						<ScoreTag run={selectedRun} />
						<Tag bg="transparent" color={ag.muted}>
							{selectedRun.status}
						</Tag>
						{(selectedRun.status === "running" ||
							selectedRun.status === "pending") && (
							<Btn
								size="sm"
								variant="secondary"
								onClick={() => cancelRun(selectedRun.id)}
							>
								Cancel
							</Btn>
						)}
					</div>
					{selectedRun.caseResults.map((result) => (
						<div key={result.itemId} style={caseStyle}>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 8,
								}}
							>
								<Mono size={11}>{result.itemId}</Mono>
								<Tag
									bg={result.passed ? ag.okBg : ag.warnBg}
									color={result.passed ? ag.ok : ag.warn}
								>
									{percent(result.score)}
								</Tag>
							</div>
							<Snippet label="input" value={result.input} />
							{result.expected !== undefined && (
								<Snippet label="expected" value={result.expected} />
							)}
							{result.output && (
								<Snippet label="output" value={result.output} />
							)}
							{Object.entries(result.criteria).map(([id, criterion]) => (
								<div key={id} style={{ marginTop: 8 }}>
									<Mono size={11} color={criterion.passed ? ag.ok : ag.warn}>
										{id} · {percent(criterion.score)}
									</Mono>
									<div style={{ fontSize: 12, color: ag.text2, marginTop: 3 }}>
										{criterion.reason}
									</div>
								</div>
							))}
							{result.error && (
								<div style={{ color: ag.danger, fontSize: 12, marginTop: 8 }}>
									{result.error}
								</div>
							)}
						</div>
					))}
				</Section>
			)}
		</aside>
	);
}

function Header({ title, right }: { title: string; right?: ReactNode }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				marginBottom: 12,
			}}
		>
			<div style={{ fontSize: 15, fontWeight: 650, color: ag.ink }}>
				{title}
			</div>
			{right}
		</div>
	);
}

function Section({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<section
			style={{
				borderTop: `1px solid ${ag.line2}`,
				paddingTop: 12,
				marginTop: 12,
			}}
		>
			<div
				style={{
					fontSize: 10.5,
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					color: ag.muted,
					fontWeight: 500,
					marginBottom: 8,
				}}
			>
				{label}
			</div>
			{children}
		</section>
	);
}

function Field({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<label style={{ display: "block", marginBottom: 8 }}>
			<Mono size={11} color={ag.muted}>
				{label}
			</Mono>
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				style={inputStyle}
			/>
		</label>
	);
}

function TextArea({
	label,
	value,
	onChange,
	rows,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	rows: number;
}) {
	return (
		<label style={{ display: "block", marginBottom: 8 }}>
			<Mono size={11} color={ag.muted}>
				{label}
			</Mono>
			<textarea
				value={value}
				rows={rows}
				onChange={(e) => onChange(e.target.value)}
				style={{ ...inputStyle, resize: "vertical", lineHeight: 1.4 }}
			/>
		</label>
	);
}

function Snippet({ label, value }: { label: string; value: unknown }) {
	return (
		<div style={{ marginTop: 8 }}>
			<Mono size={10.5} color={ag.muted}>
				{label}
			</Mono>
			<pre
				style={{
					margin: "3px 0 0",
					padding: 8,
					background: ag.surface2,
					border: `1px solid ${ag.line}`,
					borderRadius: 4,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					fontFamily: "var(--font-mono)",
					fontSize: 11,
					color: ag.text2,
				}}
			>
				{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
}

function ScoreTag({ run }: { run: EvalRun }) {
	const score = run.summary?.overallScore ?? 0;
	const passed = Boolean(run.summary?.passed);
	return (
		<Tag bg={passed ? ag.okBg : ag.warnBg} color={passed ? ag.ok : ag.warn}>
			{percent(score)}
		</Tag>
	);
}

function ScorePill({ score }: { score: EvalLatestScore }) {
	return (
		<Tag
			bg={score.passed ? ag.okBg : ag.warnBg}
			color={score.passed ? ag.ok : ag.warn}
		>
			{percent(score.overallScore)} · {score.status}
		</Tag>
	);
}

function EmptyText({ children }: { children: ReactNode }) {
	return <div style={{ color: ag.muted, fontSize: 12 }}>{children}</div>;
}

interface VersionOption {
	value: string;
	label: string;
	runVersion?: string;
	resolvedVersion?: string;
}

function buildVersionOptions(versions: AgentVersionSummary[]): VersionOption[] {
	const latest = versions[0];
	const current = versions.find((version) => version.activatedAt) ?? latest;
	const options: VersionOption[] = [];
	if (latest) {
		options.push({
			value: "latest",
			label: "latest",
			runVersion: "latest",
			resolvedVersion: latest.createdAt,
		});
	}
	if (current) {
		options.push({
			value: "current",
			label: "current",
			resolvedVersion: current.createdAt,
		});
	}
	for (const version of versions) {
		for (const alias of version.aliases) {
			options.push({
				value: `alias:${alias}`,
				label: `@${alias}`,
				runVersion: alias,
				resolvedVersion: version.createdAt,
			});
		}
	}
	for (const version of versions.slice(0, 5)) {
		options.push({
			value: `version:${version.createdAt}`,
			label: shortVersion(version.createdAt),
			runVersion: version.createdAt,
			resolvedVersion: version.createdAt,
		});
	}
	const seen = new Set<string>();
	return options.filter((option) => {
		if (seen.has(option.value)) return false;
		seen.add(option.value);
		return true;
	});
}

function scoreKey(
	evalId: string,
	datasetId: string,
	resolvedAgentVersion?: string,
): string {
	return `${evalId}:${datasetId}:${resolvedAgentVersion ?? ""}`;
}

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function formatDate(value: string): string {
	return new Date(value).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

function shortVersion(value: string): string {
	return value.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

const inputStyle: CSSProperties = {
	width: "100%",
	boxSizing: "border-box",
	border: `1px solid ${ag.line}`,
	background: ag.surface2,
	color: ag.ink,
	borderRadius: 4,
	padding: "7px 8px",
	marginTop: 4,
	fontFamily: "inherit",
	fontSize: 12,
};

const rowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	border: `1px solid ${ag.line2}`,
	borderRadius: 4,
	padding: 9,
	marginBottom: 8,
};

const compareRowStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "minmax(0, 1fr) auto auto",
	alignItems: "center",
	gap: 8,
	borderTop: `1px solid ${ag.line2}`,
	paddingTop: 6,
};

const checkboxRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 7,
	marginBottom: 6,
};

const caseStyle: CSSProperties = {
	border: `1px solid ${ag.line2}`,
	borderRadius: 4,
	padding: 9,
	marginBottom: 8,
};
