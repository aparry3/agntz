"use client";

import {
	EditableNumber,
	EditableSelect,
	EditableText,
} from "@/components/v3/editor/editable-fields";
import { I } from "@/components/v3/icons";
import {
	Btn,
	Crumbs,
	Mono,
	Spinner,
	Tag,
	ag,
} from "@/components/v3/primitives";
import type {
	AgentVersionSummary,
	EvalCriterion,
	EvalDataset,
	EvalDefinition,
	EvalInput,
	EvalLatestScore,
	EvalRun,
	EvalVersionSummary,
	ModelConfig,
} from "@agntz/core";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { InputForm } from "../playground/input-form";

type TabKey = "overview" | "rubric" | "dataset" | "runs" | "compare";
type DatasetItem = EvalDataset["items"][number];

interface AgentResponse {
	id?: string;
	name?: string;
	metadata?: { manifest?: unknown };
	updatedAt?: string;
}

const TABS: Array<{ key: TabKey; label: string }> = [
	{ key: "overview", label: "Overview" },
	{ key: "rubric", label: "Rubric" },
	{ key: "dataset", label: "Dataset" },
	{ key: "runs", label: "Runs" },
	{ key: "compare", label: "Compare" },
];

const EMPTY_EVAL_ID = "__new_eval__";
const EMPTY_DATASET_ID = "__new_dataset__";

export function EvalsWorkspace({ agentId }: { agentId: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const [agentName, setAgentName] = useState(agentId);
	const [manifest, setManifest] = useState<Record<string, unknown>>({
		id: agentId,
	});
	const [evals, setEvals] = useState<EvalDefinition[]>([]);
	const [datasets, setDatasets] = useState<EvalDataset[]>([]);
	const [runs, setRuns] = useState<EvalRun[]>([]);
	const [scores, setScores] = useState<EvalLatestScore[]>([]);
	const [agentVersions, setAgentVersions] = useState<AgentVersionSummary[]>([]);
	const [evalVersions, setEvalVersions] = useState<EvalVersionSummary[]>([]);
	const [datasetVersions, setDatasetVersions] = useState<EvalVersionSummary[]>(
		[],
	);
	const [selectedEvalId, setSelectedEvalId] = useState(
		() => searchParams.get("eval") ?? "",
	);
	const [selectedDatasetId, setSelectedDatasetId] = useState(
		() => searchParams.get("dataset") ?? "",
	);
	const [selectedRunId, setSelectedRunId] = useState(
		() => searchParams.get("run") ?? "",
	);
	const [tab, setTab] = useState<TabKey>(
		() => asTab(searchParams.get("tab")) ?? "overview",
	);
	const [evalSearch, setEvalSearch] = useState("");
	const [runEvalVersion, setRunEvalVersion] = useState("current");
	const [runDatasetId, setRunDatasetId] = useState("");
	const [runDatasetVersion, setRunDatasetVersion] = useState("current");
	const [runAgentVersion, setRunAgentVersion] = useState("current");
	const [diagnosticIds, setDiagnosticIds] = useState<string[]>([]);
	const [draftEval, setDraftEval] = useState<EvalDefinition | null>(null);
	const [draftDataset, setDraftDataset] = useState<EvalDataset | null>(null);
	const [selectedCaseId, setSelectedCaseId] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState<"eval" | "dataset" | null>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedEval = useMemo(
		() => evals.find((row) => row.id === selectedEvalId) ?? evals[0] ?? null,
		[evals, selectedEvalId],
	);
	const selectedDataset = useMemo(
		() =>
			datasets.find((row) => row.id === selectedDatasetId) ??
			datasets.find((row) => row.id === selectedEvalDatasetId(selectedEval)) ??
			datasets[0] ??
			null,
		[datasets, selectedDatasetId, selectedEval],
	);
	const selectedRun = useMemo(
		() =>
			runs.find((run) => run.id === selectedRunId) ??
			runs.find((run) => run.evalId === selectedEval?.id) ??
			runs[0] ??
			null,
		[runs, selectedRunId, selectedEval],
	);
	const latestScore = useMemo(
		() => latestScoreFor(scores, selectedEval?.id, selectedDataset?.id),
		[scores, selectedEval, selectedDataset],
	);
	const recentRuns = useMemo(
		() =>
			selectedEval
				? runs.filter((run) => run.evalId === selectedEval.id)
				: runs,
		[runs, selectedEval],
	);
	const versionOptions = useMemo(
		() => buildVersionOptions(agentVersions),
		[agentVersions],
	);
	const evalVersionOptions = useMemo(
		() => buildObjectVersionOptions(evalVersions),
		[evalVersions],
	);
	const datasetVersionOptions = useMemo(
		() => buildObjectVersionOptions(datasetVersions),
		[datasetVersions],
	);
	const filteredEvals = useMemo(() => {
		const q = evalSearch.trim().toLowerCase();
		if (!q) return evals;
		return evals.filter(
			(row) =>
				row.id.toLowerCase().includes(q) ||
				row.name.toLowerCase().includes(q) ||
				(row.description ?? "").toLowerCase().includes(q),
		);
	}, [evals, evalSearch]);
	const selectedCase = useMemo(() => {
		if (!draftDataset) return null;
		return (
			draftDataset.items.find((item) => item.id === selectedCaseId) ??
			draftDataset.items[0] ??
			null
		);
	}, [draftDataset, selectedCaseId]);

	const updateQuery = useCallback(
		(patch: Record<string, string | null>) => {
			const next = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(patch)) {
				if (value) next.set(key, value);
				else next.delete(key);
			}
			const suffix = next.toString();
			router.replace(suffix ? `${pathname}?${suffix}` : pathname, {
				scroll: false,
			});
		},
		[pathname, router, searchParams],
	);

	const load = useCallback(async () => {
		setError(null);
		const [agentRes, evalRes, datasetRes, runRes, versionRes, scoreRes] =
			await Promise.all([
				fetch(`/api/agents/${encodeURIComponent(agentId)}`),
				fetch(`/api/evals?agentId=${encodeURIComponent(agentId)}`),
				fetch(`/api/datasets?agentId=${encodeURIComponent(agentId)}`),
				fetch(
					`/api/eval-runs?agentId=${encodeURIComponent(agentId)}&limit=100`,
				),
				fetch(`/api/agents/${encodeURIComponent(agentId)}/versions`),
				fetch(`/api/eval-scores?agentId=${encodeURIComponent(agentId)}`),
			]);
		const [agent, evalRows, datasetRows, runRows, versionRows, scoreRows] =
			await Promise.all([
				readJson<AgentResponse>(agentRes),
				readJson<EvalDefinition[]>(evalRes),
				readJson<EvalDataset[]>(datasetRes),
				readJson<{ rows?: EvalRun[] }>(runRes),
				readJson<AgentVersionSummary[]>(versionRes),
				readJson<EvalLatestScore[]>(scoreRes),
			]);
		setAgentName(agent.name ?? agent.id ?? agentId);
		setManifest(parseManifest(agent, agentId));
		setEvals(Array.isArray(evalRows) ? evalRows : []);
		setDatasets(Array.isArray(datasetRows) ? datasetRows : []);
		setRuns(Array.isArray(runRows.rows) ? runRows.rows : []);
		setAgentVersions(Array.isArray(versionRows) ? versionRows : []);
		setScores(Array.isArray(scoreRows) ? scoreRows : []);
		setLoading(false);
	}, [agentId]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		load().catch((err) => {
			if (cancelled) return;
			setError(formatError(err));
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [load]);

	useEffect(() => {
		if (!selectedEval && evals[0]) {
			setSelectedEvalId(evals[0].id);
			updateQuery({ eval: evals[0].id });
		}
	}, [selectedEval, evals, updateQuery]);

	useEffect(() => {
		const datasetId =
			selectedEvalDatasetId(selectedEval) ?? selectedDataset?.id;
		if (!runDatasetId && datasetId) setRunDatasetId(datasetId);
	}, [selectedEval, selectedDataset, runDatasetId]);

	useEffect(() => {
		if (!draftEval && selectedEval) {
			setDraftEval(clone(selectedEval));
			setDiagnosticIds([]);
		}
	}, [draftEval, selectedEval]);

	useEffect(() => {
		if (!draftDataset && selectedDataset) {
			setDraftDataset(clone(selectedDataset));
			setSelectedCaseId(selectedDataset.items[0]?.id ?? "");
		}
	}, [draftDataset, selectedDataset]);

	useEffect(() => {
		if (!selectedEval) {
			setEvalVersions([]);
			return;
		}
		fetch(`/api/evals/${encodeURIComponent(selectedEval.id)}/versions`)
			.then((res) => readJson<EvalVersionSummary[]>(res))
			.then((rows) => setEvalVersions(Array.isArray(rows) ? rows : []))
			.catch((err) => setError(formatError(err)));
	}, [selectedEval]);

	useEffect(() => {
		const datasetId = runDatasetId || selectedDataset?.id;
		if (!datasetId) {
			setDatasetVersions([]);
			return;
		}
		fetch(`/api/datasets/${encodeURIComponent(datasetId)}/versions`)
			.then((res) => readJson<EvalVersionSummary[]>(res))
			.then((rows) => setDatasetVersions(Array.isArray(rows) ? rows : []))
			.catch((err) => setError(formatError(err)));
	}, [runDatasetId, selectedDataset]);

	useEffect(() => {
		if (
			!runs.some((run) => run.status === "running" || run.status === "pending")
		)
			return;
		const timer = window.setInterval(() => {
			load().catch((err) => setError(formatError(err)));
		}, 1500);
		return () => window.clearInterval(timer);
	}, [runs, load]);

	const selectEval = (evalId: string) => {
		const next = evals.find((row) => row.id === evalId) ?? null;
		setSelectedEvalId(evalId);
		setDraftEval(next ? clone(next) : null);
		const datasetId = selectedEvalDatasetId(next) ?? "";
		if (datasetId) {
			const dataset = datasets.find((row) => row.id === datasetId) ?? null;
			setSelectedDatasetId(datasetId);
			setDraftDataset(dataset ? clone(dataset) : null);
			setSelectedCaseId(dataset?.items[0]?.id ?? "");
			setRunDatasetId(datasetId);
		}
		updateQuery({ eval: evalId, dataset: datasetId || null, run: null });
	};

	const selectDataset = (datasetId: string) => {
		const dataset = datasets.find((row) => row.id === datasetId) ?? null;
		setSelectedDatasetId(datasetId);
		setDraftDataset(dataset ? clone(dataset) : null);
		setSelectedCaseId(dataset?.items[0]?.id ?? "");
		setRunDatasetId(datasetId);
		updateQuery({ dataset: datasetId, run: null });
	};

	const selectTab = (key: TabKey) => {
		setTab(key);
		updateQuery({ tab: key });
	};

	const startNewEval = () => {
		const next = newEval(agentId, datasets[0]);
		setSelectedEvalId(EMPTY_EVAL_ID);
		setDraftEval(next);
		setTab("rubric");
		updateQuery({ eval: null, tab: "rubric", run: null });
	};

	const startNewDataset = () => {
		const next = newDataset(agentId);
		setSelectedDatasetId(EMPTY_DATASET_ID);
		setDraftDataset(next);
		setSelectedCaseId(next.items[0]?.id ?? "");
		setTab("dataset");
		updateQuery({ dataset: null, tab: "dataset", run: null });
	};

	const saveEval = async () => {
		if (!draftEval) return;
		setSaving("eval");
		setError(null);
		try {
			const exists = evals.some((row) => row.id === draftEval.id);
			const res = await fetch(
				exists
					? `/api/evals/${encodeURIComponent(draftEval.id)}`
					: "/api/evals",
				{
					method: exists ? "PUT" : "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(cleanEval(draftEval)),
				},
			);
			const saved = await readJson<EvalDefinition>(res);
			await load();
			setSelectedEvalId(saved.id);
			setDraftEval(clone(saved));
			updateQuery({ eval: saved.id });
		} catch (err) {
			setError(formatError(err));
		} finally {
			setSaving(null);
		}
	};

	const saveDataset = async () => {
		if (!draftDataset) return;
		setSaving("dataset");
		setError(null);
		try {
			const exists = datasets.some((row) => row.id === draftDataset.id);
			const res = await fetch(
				exists
					? `/api/datasets/${encodeURIComponent(draftDataset.id)}`
					: "/api/datasets",
				{
					method: exists ? "PUT" : "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(cleanDataset(draftDataset)),
				},
			);
			const saved = await readJson<EvalDataset>(res);
			await load();
			setSelectedDatasetId(saved.id);
			setRunDatasetId(saved.id);
			setDraftDataset(clone(saved));
			updateQuery({ dataset: saved.id });
		} catch (err) {
			setError(formatError(err));
		} finally {
			setSaving(null);
		}
	};

	const runSelectedEval = async (criterionIds?: string[]) => {
		const evalId = draftEval?.id ?? selectedEval?.id;
		if (!evalId) return;
		setRunning(true);
		setError(null);
		try {
			const payload: Record<string, unknown> = {
				evalId,
				datasetId: runDatasetId || selectedDataset?.id,
			};
			if (runEvalVersion !== "current") payload.evalVersion = runEvalVersion;
			if (runDatasetVersion !== "current")
				payload.datasetVersion = runDatasetVersion;
			if (runAgentVersion !== "current") payload.agentVersion = runAgentVersion;
			if (criterionIds?.length) payload.criterionIds = criterionIds;
			const res = await fetch("/api/eval-runs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const run = await readJson<EvalRun>(res);
			await load();
			setSelectedRunId(run.id);
			setTab("runs");
			updateQuery({ run: run.id, tab: "runs" });
		} catch (err) {
			setError(formatError(err));
		} finally {
			setRunning(false);
		}
	};

	const cancelRun = async (runId: string) => {
		setError(null);
		try {
			const res = await fetch(
				`/api/eval-runs/${encodeURIComponent(runId)}/cancel`,
				{ method: "POST" },
			);
			const run = await readJson<EvalRun>(res);
			await load();
			setSelectedRunId(run.id);
		} catch (err) {
			setError(formatError(err));
		}
	};

	const exportEvalYaml = () => {
		if (!draftEval) return;
		void navigator.clipboard?.writeText(stringifyYAML(cleanEval(draftEval)));
	};

	const exportDatasetYaml = () => {
		if (!draftDataset) return;
		void navigator.clipboard?.writeText(
			stringifyYAML(cleanDataset(draftDataset)),
		);
	};

	const importEvalYaml = () => {
		const raw = window.prompt("Paste eval YAML");
		if (!raw) return;
		try {
			const parsed = parseYAML(raw) as Partial<EvalDefinition>;
			setDraftEval(cleanEval({ ...newEval(agentId), ...parsed, agentId }));
			setTab("rubric");
		} catch (err) {
			setError(`Invalid eval YAML: ${formatError(err)}`);
		}
	};

	const importDatasetYaml = () => {
		const raw = window.prompt("Paste dataset YAML");
		if (!raw) return;
		try {
			const parsed = parseYAML(raw) as Partial<EvalDataset>;
			const next = cleanDataset({ ...newDataset(agentId), ...parsed, agentId });
			setDraftDataset(next);
			setSelectedCaseId(next.items[0]?.id ?? "");
			setTab("dataset");
		} catch (err) {
			setError(`Invalid dataset YAML: ${formatError(err)}`);
		}
	};

	if (loading) {
		return (
			<div style={pageStyle}>
				<div style={centerStyle}>
					<Spinner size={14} />
					<Mono color={ag.muted}>loading eval workspace</Mono>
				</div>
			</div>
		);
	}

	return (
		<div style={pageStyle}>
			<header style={headerStyle}>
				<div style={{ marginBottom: 8 }}>
					<Crumbs trail={["agntz", "Agents", agentName, "Evals"]} />
				</div>
				<div style={headerRowStyle}>
					<div style={{ minWidth: 0 }}>
						<h1 style={titleStyle}>Evals</h1>
						<div style={subtitleStyle}>
							{agentName} <Mono size={11}>{agentId}</Mono>
						</div>
					</div>
					<div style={actionRowStyle}>
						<LinkButton href={`/agents/${encodeURIComponent(agentId)}`}>
							Build
						</LinkButton>
						<LinkButton
							href={`/agents/${encodeURIComponent(agentId)}?mode=play`}
						>
							Playground
						</LinkButton>
						<LinkButton href={`/agents/${encodeURIComponent(agentId)}/history`}>
							History
						</LinkButton>
						<Btn
							variant="secondary"
							icon={<I.Code size={11} style={{ marginRight: 6 }} />}
							onClick={importEvalYaml}
						>
							Import YAML
						</Btn>
						<Btn
							variant="secondary"
							icon={<I.Plus size={11} style={{ marginRight: 6 }} />}
							onClick={startNewDataset}
						>
							New Dataset
						</Btn>
						<Btn
							icon={<I.Plus size={11} style={{ marginRight: 6 }} />}
							onClick={startNewEval}
						>
							New Eval
						</Btn>
					</div>
				</div>
			</header>

			{error && (
				<div style={errorStyle}>
					<I.X size={11} />
					<span>{error}</span>
				</div>
			)}

			<div style={workspaceStyle}>
				<EvalRail
					evals={filteredEvals}
					datasets={datasets}
					scores={scores}
					runs={runs}
					selectedEvalId={selectedEval?.id ?? ""}
					selectedDatasetId={selectedDataset?.id ?? ""}
					search={evalSearch}
					onSearch={setEvalSearch}
					onSelectEval={selectEval}
					onSelectDataset={selectDataset}
					onNewEval={startNewEval}
					onNewDataset={startNewDataset}
				/>

				<main style={mainStyle}>
					<TabBar active={tab} onSelect={selectTab} />
					<div style={contentStyle}>
						{tab === "overview" && (
							<OverviewTab
								evalDefinition={draftEval ?? selectedEval}
								dataset={draftDataset ?? selectedDataset}
								latestScore={latestScore}
								recentRuns={recentRuns}
								scores={scores}
								agentVersions={agentVersions}
								onSelectRun={(runId) => {
									setSelectedRunId(runId);
									setTab("runs");
									updateQuery({ run: runId, tab: "runs" });
								}}
								onRun={() => runSelectedEval()}
							/>
						)}
						{tab === "rubric" && draftEval && (
							<RubricTab
								value={draftEval}
								datasets={datasets}
								saving={saving === "eval"}
								versionOptions={evalVersionOptions}
								onChange={setDraftEval}
								onSave={saveEval}
								onExport={exportEvalYaml}
							/>
						)}
						{tab === "rubric" && !draftEval && (
							<EmptyMain
								title="No eval selected"
								body="Create an eval to define criteria, pass policy, and judge model."
								action="New Eval"
								onAction={startNewEval}
							/>
						)}
						{tab === "dataset" && draftDataset && (
							<DatasetTab
								value={draftDataset}
								manifest={manifest}
								selectedCase={selectedCase}
								saving={saving === "dataset"}
								versionOptions={datasetVersionOptions}
								onChange={setDraftDataset}
								onSelectCase={setSelectedCaseId}
								onSave={saveDataset}
								onImport={importDatasetYaml}
								onExport={exportDatasetYaml}
							/>
						)}
						{tab === "dataset" && !draftDataset && (
							<EmptyMain
								title="No dataset selected"
								body="Create a dataset to collect agent inputs for eval runs."
								action="New Dataset"
								onAction={startNewDataset}
							/>
						)}
						{tab === "runs" && (
							<RunsTab
								runs={recentRuns}
								selectedRun={selectedRun}
								onSelectRun={(runId) => {
									setSelectedRunId(runId);
									updateQuery({ run: runId });
								}}
								onCancel={cancelRun}
							/>
						)}
						{tab === "compare" && (
							<CompareTab
								evalDefinition={draftEval ?? selectedEval}
								dataset={draftDataset ?? selectedDataset}
								agentVersions={agentVersions}
								scores={scores}
							/>
						)}
					</div>
				</main>

				<RunSetupPanel
					evalDefinition={draftEval ?? selectedEval}
					datasets={datasets}
					selectedRun={selectedRun}
					evalVersion={runEvalVersion}
					datasetId={runDatasetId}
					datasetVersion={runDatasetVersion}
					agentVersion={runAgentVersion}
					evalVersionOptions={evalVersionOptions}
					datasetVersionOptions={datasetVersionOptions}
					agentVersionOptions={versionOptions}
					diagnosticIds={diagnosticIds}
					running={running}
					onEvalVersion={setRunEvalVersion}
					onDatasetId={(id) => {
						setRunDatasetId(id);
						setRunDatasetVersion("current");
					}}
					onDatasetVersion={setRunDatasetVersion}
					onAgentVersion={setRunAgentVersion}
					onToggleCriterion={(id) => {
						setDiagnosticIds((current) =>
							current.includes(id)
								? current.filter((row) => row !== id)
								: [...current, id],
						);
					}}
					onRunFull={() => runSelectedEval()}
					onRunDiagnostic={() => runSelectedEval(diagnosticIds)}
					onCancel={cancelRun}
				/>
			</div>
		</div>
	);
}

function EvalRail({
	evals,
	datasets,
	scores,
	runs,
	selectedEvalId,
	selectedDatasetId,
	search,
	onSearch,
	onSelectEval,
	onSelectDataset,
	onNewEval,
	onNewDataset,
}: {
	evals: EvalDefinition[];
	datasets: EvalDataset[];
	scores: EvalLatestScore[];
	runs: EvalRun[];
	selectedEvalId: string;
	selectedDatasetId: string;
	search: string;
	onSearch: (value: string) => void;
	onSelectEval: (evalId: string) => void;
	onSelectDataset: (datasetId: string) => void;
	onNewEval: () => void;
	onNewDataset: () => void;
}) {
	return (
		<aside style={railStyle}>
			<div style={searchBoxStyle}>
				<I.Search size={12} />
				<input
					value={search}
					onChange={(event) => onSearch(event.target.value)}
					placeholder="Search evals..."
					style={bareInputStyle}
				/>
			</div>
			<div style={railHeaderStyle}>
				<SectionLabel>Evals</SectionLabel>
				<button type="button" onClick={onNewEval} style={iconButtonStyle}>
					<I.Plus size={11} />
				</button>
			</div>
			<div style={{ display: "grid", gap: 7 }}>
				{evals.map((definition) => {
					const datasetId = selectedEvalDatasetId(definition);
					const latest = latestScoreFor(scores, definition.id, datasetId);
					const lastRun = runs.find((run) => run.evalId === definition.id);
					return (
						<button
							key={definition.id}
							type="button"
							onClick={() => onSelectEval(definition.id)}
							style={{
								...railRowStyle,
								background:
									selectedEvalId === definition.id
										? ag.surface2
										: "transparent",
								borderColor:
									selectedEvalId === definition.id ? ag.line : ag.line2,
							}}
						>
							<div style={{ minWidth: 0, flex: 1 }}>
								<div style={railRowTitleStyle}>{definition.name}</div>
								<Mono size={10.5} color={ag.muted}>
									{definition.criteria.length} criteria ·{" "}
									{datasetId ?? "no dataset"}
								</Mono>
								<div style={{ marginTop: 7, display: "flex", gap: 5 }}>
									{latest ? (
										<OutcomeTag
											outcome={latest.summary?.outcome}
											passed={latest.passed}
											score={latest.overallScore}
										/>
									) : (
										<Tag bg="transparent" color={ag.muted}>
											not run
										</Tag>
									)}
									{lastRun?.partial && (
										<Tag bg="transparent" color={ag.muted}>
											partial
										</Tag>
									)}
								</div>
							</div>
						</button>
					);
				})}
				{evals.length === 0 && <RailEmpty>No evals yet</RailEmpty>}
			</div>

			<div style={{ ...railHeaderStyle, marginTop: 18 }}>
				<SectionLabel>Datasets</SectionLabel>
				<button type="button" onClick={onNewDataset} style={iconButtonStyle}>
					<I.Plus size={11} />
				</button>
			</div>
			<div style={{ display: "grid", gap: 7 }}>
				{datasets.map((dataset) => (
					<button
						key={dataset.id}
						type="button"
						onClick={() => onSelectDataset(dataset.id)}
						style={{
							...railRowStyle,
							background:
								selectedDatasetId === dataset.id ? ag.surface2 : "transparent",
							borderColor:
								selectedDatasetId === dataset.id ? ag.line : ag.line2,
						}}
					>
						<div style={{ minWidth: 0, flex: 1 }}>
							<div style={railRowTitleStyle}>{dataset.name}</div>
							<Mono size={10.5} color={ag.muted}>
								{dataset.items.length} cases
							</Mono>
						</div>
					</button>
				))}
				{datasets.length === 0 && <RailEmpty>No datasets yet</RailEmpty>}
			</div>
		</aside>
	);
}

function OverviewTab({
	evalDefinition,
	dataset,
	latestScore,
	recentRuns,
	scores,
	agentVersions,
	onSelectRun,
	onRun,
}: {
	evalDefinition: EvalDefinition | null;
	dataset: EvalDataset | null;
	latestScore: EvalLatestScore | null;
	recentRuns: EvalRun[];
	scores: EvalLatestScore[];
	agentVersions: AgentVersionSummary[];
	onSelectRun: (runId: string) => void;
	onRun: () => void;
}) {
	if (!evalDefinition) {
		return (
			<EmptyMain
				title="No eval selected"
				body="Create an eval to start tracking quality for this agent."
				action="Run setup will appear after an eval exists"
			/>
		);
	}
	const score = latestScore?.summary;
	return (
		<div style={tabGridStyle}>
			<div style={metricGridStyle}>
				<Metric
					label="Latest Score"
					value={latestScore ? percent(latestScore.overallScore) : "none"}
					tone={latestScore?.passed === false ? "warn" : "ok"}
				/>
				<Metric
					label="Outcome"
					value={outcomeLabel(score?.outcome, latestScore?.passed)}
					tone={score?.outcome === "failed" ? "warn" : "ok"}
				/>
				<Metric label="Dataset" value={dataset?.name ?? "none"} />
				<Metric label="Cases" value={String(dataset?.items.length ?? 0)} />
			</div>

			{score?.gateFailures && score.gateFailures.length > 0 && (
				<Panel title="Gate Failures">
					<div style={{ display: "grid", gap: 6 }}>
						{score.gateFailures.map((failure) => (
							<div key={failure} style={failureStyle}>
								<I.X size={11} />
								{failure}
							</div>
						))}
					</div>
				</Panel>
			)}

			<Panel
				title="Criterion Summary"
				right={
					<Btn size="sm" variant="secondary" onClick={onRun}>
						Run eval
					</Btn>
				}
			>
				<CriteriaSummary
					criteria={evalDefinition.criteria}
					summary={score?.criteria}
				/>
			</Panel>

			<Panel title="Recent Runs">
				<RunList rows={recentRuns.slice(0, 8)} onSelect={onSelectRun} />
			</Panel>

			<Panel title="Agent Version Scores">
				<CompareRows
					evalId={evalDefinition.id}
					datasetId={dataset?.id}
					agentVersions={agentVersions}
					scores={scores}
				/>
			</Panel>
		</div>
	);
}

function RubricTab({
	value,
	datasets,
	saving,
	versionOptions,
	onChange,
	onSave,
	onExport,
}: {
	value: EvalDefinition;
	datasets: EvalDataset[];
	saving: boolean;
	versionOptions: VersionOption[];
	onChange: (next: EvalDefinition) => void;
	onSave: () => void;
	onExport: () => void;
}) {
	const patch = (patchValue: Partial<EvalDefinition>) =>
		onChange({ ...value, ...patchValue });
	const criteria = value.criteria ?? [];
	return (
		<div style={tabGridStyle}>
			<Panel
				title="Eval Definition"
				right={
					<div style={{ display: "flex", gap: 8 }}>
						<VersionBadge options={versionOptions} />
						<Btn size="sm" variant="secondary" onClick={onExport}>
							Export YAML
						</Btn>
						<Btn size="sm" onClick={onSave} disabled={saving}>
							{saving ? "Saving" : "Save Eval"}
						</Btn>
					</div>
				}
			>
				<div style={formGridStyle}>
					<EditableText
						label="Name"
						value={value.name}
						onChange={(name) => patch({ name })}
					/>
					<EditableText
						label="ID"
						value={value.id}
						onChange={(id) => patch({ id: slug(id) || id })}
					/>
					<EditableSelect
						label="Default dataset"
						value={selectedEvalDatasetId(value) ?? ""}
						options={[
							["", "None"],
							...datasets.map((dataset) => [dataset.id, dataset.name] as const),
						]}
						onChange={(id) =>
							patch({
								defaultDataset: id ? { id } : undefined,
								defaultDatasetId: id || undefined,
							})
						}
					/>
					<EditableNumber
						label="Minimum score"
						value={value.passPolicy?.minimumScore}
						min={0}
						max={1}
						step={0.01}
						placeholder="score-only"
						hint="Blank means score-only unless a criterion has a hard gate."
						onChange={(minimumScore) =>
							patch({
								passPolicy:
									typeof minimumScore === "number"
										? { minimumScore }
										: undefined,
								passThreshold: undefined,
							})
						}
					/>
					<ModelFields
						model={value.judge?.model ?? value.judgeModel}
						onChange={(model) =>
							patch({
								judge: model ? { model } : undefined,
								judgeModel: undefined,
							})
						}
					/>
				</div>
				<div style={{ marginTop: 12 }}>
					<EditableText
						label="Description"
						value={value.description ?? ""}
						onChange={(description) =>
							patch({ description: description || undefined })
						}
						multiline
						rows={2}
					/>
				</div>
			</Panel>

			<Panel
				title="Criteria"
				right={
					<Btn
						size="sm"
						variant="secondary"
						icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
						onClick={() =>
							patch({
								criteria: [
									...criteria,
									{
										id: nextCriterionId(criteria),
										name: "New criterion",
										weight: 1,
										rubric: "Score this criterion from 0 to 1.",
									},
								],
							})
						}
					>
						Add criterion
					</Btn>
				}
			>
				<div style={{ display: "grid", gap: 12 }}>
					{criteria.map((criterion, index) => (
						<CriterionEditor
							key={`${criterion.id}:${index}`}
							criterion={criterion}
							index={index}
							onChange={(next) =>
								patch({
									criteria: criteria.map((row, rowIndex) =>
										rowIndex === index ? next : row,
									),
								})
							}
							onDuplicate={() =>
								patch({
									criteria: [
										...criteria.slice(0, index + 1),
										{
											...criterion,
											id: `${criterion.id}_copy`,
											name: `${criterion.name} copy`,
										},
										...criteria.slice(index + 1),
									],
								})
							}
							onDelete={() =>
								patch({
									criteria: criteria.filter(
										(_, rowIndex) => rowIndex !== index,
									),
								})
							}
							onMove={(direction) => {
								const next = [...criteria];
								const target = index + direction;
								if (target < 0 || target >= next.length) return;
								[next[index], next[target]] = [next[target], next[index]];
								patch({ criteria: next });
							}}
						/>
					))}
					{criteria.length === 0 && (
						<div style={emptyBoxStyle}>
							No criteria. Add one before running.
						</div>
					)}
				</div>
			</Panel>
		</div>
	);
}

function DatasetTab({
	value,
	manifest,
	selectedCase,
	saving,
	versionOptions,
	onChange,
	onSelectCase,
	onSave,
	onImport,
	onExport,
}: {
	value: EvalDataset;
	manifest: Record<string, unknown>;
	selectedCase: DatasetItem | null;
	saving: boolean;
	versionOptions: VersionOption[];
	onChange: (next: EvalDataset) => void;
	onSelectCase: (caseId: string) => void;
	onSave: () => void;
	onImport: () => void;
	onExport: () => void;
}) {
	const patch = (patchValue: Partial<EvalDataset>) =>
		onChange({ ...value, ...patchValue });
	const updateItem = (caseId: string, next: DatasetItem) =>
		patch({
			items: value.items.map((item) => (item.id === caseId ? next : item)),
		});
	return (
		<div style={tabGridStyle}>
			<Panel
				title="Dataset"
				right={
					<div style={{ display: "flex", gap: 8 }}>
						<VersionBadge options={versionOptions} />
						<Btn size="sm" variant="secondary" onClick={onImport}>
							Import YAML
						</Btn>
						<Btn size="sm" variant="secondary" onClick={onExport}>
							Export YAML
						</Btn>
						<Btn size="sm" onClick={onSave} disabled={saving}>
							{saving ? "Saving" : "Save Dataset"}
						</Btn>
					</div>
				}
			>
				<div style={formGridStyle}>
					<EditableText
						label="Name"
						value={value.name}
						onChange={(name) => patch({ name })}
					/>
					<EditableText
						label="ID"
						value={value.id}
						onChange={(id) => patch({ id: slug(id) || id })}
					/>
				</div>
				<div style={{ marginTop: 12 }}>
					<EditableText
						label="Description"
						value={value.description ?? ""}
						onChange={(description) =>
							patch({ description: description || undefined })
						}
						multiline
						rows={2}
					/>
				</div>
			</Panel>

			<div style={datasetGridStyle}>
				<Panel
					title="Cases"
					right={
						<Btn
							size="sm"
							variant="secondary"
							icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
							onClick={() => {
								const item = newCase(value.items);
								patch({ items: [...value.items, item] });
								onSelectCase(item.id);
							}}
						>
							Add case
						</Btn>
					}
				>
					<div style={{ display: "grid", gap: 6 }}>
						{value.items.map((item) => (
							<button
								key={item.id}
								type="button"
								onClick={() => onSelectCase(item.id)}
								style={{
									...caseRowStyle,
									background:
										selectedCase?.id === item.id ? ag.surface2 : "transparent",
								}}
							>
								<div style={{ minWidth: 0, flex: 1 }}>
									<div style={railRowTitleStyle}>{item.name || item.id}</div>
									<Mono size={10.5} color={ag.muted}>
										{previewInput(item.input)}
									</Mono>
								</div>
							</button>
						))}
						{value.items.length === 0 && (
							<div style={emptyBoxStyle}>No cases yet.</div>
						)}
					</div>
				</Panel>

				<Panel title="Case Editor">
					{selectedCase ? (
						<CaseEditor
							item={selectedCase}
							manifest={manifest}
							onChange={(next) => updateItem(selectedCase.id, next)}
							onDuplicate={() => {
								const copy = {
									...selectedCase,
									id: `${selectedCase.id}_copy`,
									name: selectedCase.name
										? `${selectedCase.name} copy`
										: undefined,
								};
								patch({ items: [...value.items, copy] });
								onSelectCase(copy.id);
							}}
							onDelete={() => {
								const next = value.items.filter(
									(item) => item.id !== selectedCase.id,
								);
								patch({ items: next });
								onSelectCase(next[0]?.id ?? "");
							}}
						/>
					) : (
						<div style={emptyBoxStyle}>Select a case to edit.</div>
					)}
				</Panel>
			</div>
		</div>
	);
}

function RunsTab({
	runs,
	selectedRun,
	onSelectRun,
	onCancel,
}: {
	runs: EvalRun[];
	selectedRun: EvalRun | null;
	onSelectRun: (runId: string) => void;
	onCancel: (runId: string) => void;
}) {
	return (
		<div style={runsGridStyle}>
			<Panel title="Run History">
				<RunList
					rows={runs}
					selectedRunId={selectedRun?.id}
					onSelect={onSelectRun}
				/>
			</Panel>
			<Panel
				title="Run Detail"
				right={
					selectedRun &&
					(selectedRun.status === "running" ||
						selectedRun.status === "pending") ? (
						<Btn
							size="sm"
							variant="secondary"
							onClick={() => onCancel(selectedRun.id)}
						>
							Cancel
						</Btn>
					) : null
				}
			>
				{selectedRun ? (
					<RunDetail run={selectedRun} />
				) : (
					<div style={emptyBoxStyle}>No runs yet.</div>
				)}
			</Panel>
		</div>
	);
}

function CompareTab({
	evalDefinition,
	dataset,
	agentVersions,
	scores,
}: {
	evalDefinition: EvalDefinition | null;
	dataset: EvalDataset | null;
	agentVersions: AgentVersionSummary[];
	scores: EvalLatestScore[];
}) {
	if (!evalDefinition || !dataset) {
		return (
			<EmptyMain
				title="Nothing to compare"
				body="Select an eval and dataset to compare agent versions."
			/>
		);
	}
	return (
		<div style={tabGridStyle}>
			<Panel
				title="Fixed Context"
				right={
					<Tag bg="transparent" color={ag.muted}>
						{evalDefinition.id} · {dataset.id}
					</Tag>
				}
			>
				<div style={compareContextStyle}>
					<InfoPair label="Eval" value={evalDefinition.name} />
					<InfoPair label="Dataset" value={dataset.name} />
					<InfoPair label="Cases" value={String(dataset.items.length)} />
					<InfoPair
						label="Criteria"
						value={String(evalDefinition.criteria.length)}
					/>
				</div>
			</Panel>
			<Panel title="Scores by Agent Version">
				<CompareRows
					evalId={evalDefinition.id}
					datasetId={dataset.id}
					agentVersions={agentVersions}
					scores={scores}
					showCriteria={evalDefinition.criteria}
				/>
			</Panel>
		</div>
	);
}

function RunSetupPanel({
	evalDefinition,
	datasets,
	selectedRun,
	evalVersion,
	datasetId,
	datasetVersion,
	agentVersion,
	evalVersionOptions,
	datasetVersionOptions,
	agentVersionOptions,
	diagnosticIds,
	running,
	onEvalVersion,
	onDatasetId,
	onDatasetVersion,
	onAgentVersion,
	onToggleCriterion,
	onRunFull,
	onRunDiagnostic,
	onCancel,
}: {
	evalDefinition: EvalDefinition | null;
	datasets: EvalDataset[];
	selectedRun: EvalRun | null;
	evalVersion: string;
	datasetId: string;
	datasetVersion: string;
	agentVersion: string;
	evalVersionOptions: VersionOption[];
	datasetVersionOptions: VersionOption[];
	agentVersionOptions: VersionOption[];
	diagnosticIds: string[];
	running: boolean;
	onEvalVersion: (value: string) => void;
	onDatasetId: (value: string) => void;
	onDatasetVersion: (value: string) => void;
	onAgentVersion: (value: string) => void;
	onToggleCriterion: (id: string) => void;
	onRunFull: () => void;
	onRunDiagnostic: () => void;
	onCancel: (runId: string) => void;
}) {
	const hasDataset = Boolean(datasetId);
	const canRun = Boolean(evalDefinition && hasDataset && !running);
	const selectedRunning =
		selectedRun?.status === "running" || selectedRun?.status === "pending";
	return (
		<aside style={setupStyle}>
			<SectionLabel>Run Setup</SectionLabel>
			<div style={{ display: "grid", gap: 10, marginTop: 10 }}>
				<EditableSelect
					label="Eval version"
					value={evalVersion}
					options={evalVersionOptions.map((option) => [
						option.value,
						option.label,
					])}
					onChange={onEvalVersion}
				/>
				<EditableSelect
					label="Dataset"
					value={datasetId}
					options={[
						["", "Select dataset"],
						...datasets.map((dataset) => [dataset.id, dataset.name] as const),
					]}
					onChange={onDatasetId}
				/>
				<EditableSelect
					label="Dataset version"
					value={datasetVersion}
					options={datasetVersionOptions.map((option) => [
						option.value,
						option.label,
					])}
					onChange={onDatasetVersion}
				/>
				<EditableSelect
					label="Agent version"
					value={agentVersion}
					options={agentVersionOptions.map((option) => [
						option.value,
						option.label,
					])}
					onChange={onAgentVersion}
				/>
			</div>

			<div style={{ marginTop: 16 }}>
				<SectionLabel>Diagnostic Criteria</SectionLabel>
				<div style={{ display: "grid", gap: 6, marginTop: 8 }}>
					{evalDefinition?.criteria.map((criterion) => (
						<label key={criterion.id} style={checkboxRowStyle}>
							<input
								type="checkbox"
								checked={diagnosticIds.includes(criterion.id)}
								onChange={() => onToggleCriterion(criterion.id)}
							/>
							<span style={{ minWidth: 0 }}>
								<span style={{ fontSize: 12, color: ag.ink }}>
									{criterion.name}
								</span>
								<Mono size={10.5} color={ag.muted} style={{ display: "block" }}>
									{criterion.id}
								</Mono>
							</span>
						</label>
					))}
					{!evalDefinition?.criteria.length && (
						<div style={emptyBoxStyle}>No criteria yet.</div>
					)}
				</div>
			</div>

			<div style={{ display: "grid", gap: 8, marginTop: 16 }}>
				<Btn
					icon={<I.Play size={11} style={{ marginRight: 6 }} />}
					disabled={!canRun}
					onClick={onRunFull}
				>
					{running ? "Running..." : "Run full eval"}
				</Btn>
				<Btn
					variant="secondary"
					disabled={!canRun || diagnosticIds.length === 0}
					onClick={onRunDiagnostic}
				>
					Run selected criteria
				</Btn>
			</div>

			{selectedRun && (
				<div style={{ marginTop: 18 }}>
					<SectionLabel>Selected Run</SectionLabel>
					<div style={setupRunStyle}>
						<div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
							<StatusTag status={selectedRun.status} />
							{selectedRun.partial && (
								<Tag bg="transparent" color={ag.muted}>
									partial
								</Tag>
							)}
						</div>
						<InfoPair label="Run" value={selectedRun.id} mono />
						<InfoPair
							label="Score"
							value={
								selectedRun.summary
									? percent(selectedRun.summary.overallScore)
									: "pending"
							}
						/>
						<InfoPair
							label="Eval version"
							value={selectedRun.evalVersion ?? "current"}
							mono
						/>
						<InfoPair
							label="Dataset version"
							value={selectedRun.datasetVersion ?? "current"}
							mono
						/>
						<InfoPair
							label="Agent version"
							value={selectedRun.agentVersion ?? "current"}
							mono
						/>
						{selectedRunning && (
							<Btn
								size="sm"
								variant="secondary"
								style={{ marginTop: 10 }}
								onClick={() => onCancel(selectedRun.id)}
							>
								Cancel
							</Btn>
						)}
					</div>
				</div>
			)}
		</aside>
	);
}

function CriterionEditor({
	criterion,
	index,
	onChange,
	onDuplicate,
	onDelete,
	onMove,
}: {
	criterion: EvalCriterion;
	index: number;
	onChange: (next: EvalCriterion) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onMove: (direction: -1 | 1) => void;
}) {
	const minimumScore =
		criterion.gate?.minimumScore ?? criterion.threshold ?? undefined;
	const patch = (patchValue: Partial<EvalCriterion>) =>
		onChange({ ...criterion, ...patchValue });
	return (
		<div style={criterionBoxStyle}>
			<div style={criterionHeaderStyle}>
				<Mono size={11} color={ag.muted}>
					#{index + 1}
				</Mono>
				<div style={{ flex: 1 }} />
				<Btn size="sm" variant="ghost" onClick={() => onMove(-1)}>
					Up
				</Btn>
				<Btn size="sm" variant="ghost" onClick={() => onMove(1)}>
					Down
				</Btn>
				<Btn size="sm" variant="secondary" onClick={onDuplicate}>
					Duplicate
				</Btn>
				<Btn size="sm" variant="danger" onClick={onDelete}>
					Delete
				</Btn>
			</div>
			<div style={criterionGridStyle}>
				<EditableText
					label="Name"
					value={criterion.name}
					onChange={(name) => patch({ name })}
				/>
				<EditableText
					label="Stable ID"
					value={criterion.id}
					onChange={(id) => patch({ id: slug(id) || id })}
				/>
				<EditableNumber
					label="Weight"
					value={criterion.weight ?? 1}
					min={0.01}
					step={0.25}
					onChange={(weight) => patch({ weight: weight ?? 1 })}
				/>
				<EditableNumber
					label="Hard gate minimum"
					value={minimumScore}
					min={0}
					max={1}
					step={0.01}
					placeholder="none"
					onChange={(next) =>
						patch({
							gate:
								typeof next === "number" ? { minimumScore: next } : undefined,
							threshold: undefined,
						})
					}
				/>
			</div>
			<div style={{ marginTop: 10 }}>
				<EditableText
					label="Rubric"
					value={criterion.rubric ?? criterion.description ?? ""}
					onChange={(rubric) => patch({ rubric, description: undefined })}
					multiline
					rows={5}
				/>
			</div>
		</div>
	);
}

function CaseEditor({
	item,
	manifest,
	onChange,
	onDuplicate,
	onDelete,
}: {
	item: DatasetItem;
	manifest: Record<string, unknown>;
	onChange: (next: DatasetItem) => void;
	onDuplicate: () => void;
	onDelete: () => void;
}) {
	const [metadataText, setMetadataText] = useState(() =>
		item.metadata ? JSON.stringify(item.metadata, null, 2) : "",
	);
	useEffect(() => {
		setMetadataText(
			item.metadata ? JSON.stringify(item.metadata, null, 2) : "",
		);
	}, [item.id, item.metadata]);
	const hasSchema = isRecord(manifest.inputSchema);
	return (
		<div style={{ display: "grid", gap: 12 }}>
			<div style={formGridStyle}>
				<EditableText
					label="Case ID"
					value={item.id}
					onChange={(id) => onChange({ ...item, id: slug(id) || id })}
				/>
				<EditableText
					label="Name"
					value={item.name ?? ""}
					onChange={(name) => onChange({ ...item, name: name || undefined })}
				/>
			</div>
			{hasSchema ? (
				<InputForm
					manifest={manifest}
					value={item.input}
					onChange={(input) => onChange({ ...item, input: input as EvalInput })}
				/>
			) : (
				<EditableText
					label="Input"
					value={
						typeof item.input === "string"
							? item.input
							: stringifyInput(item.input)
					}
					onChange={(raw) =>
						onChange({ ...item, input: parseLooseInput(raw) as EvalInput })
					}
					multiline
					rows={8}
					mono
				/>
			)}
			<EditableText
				label="Metadata JSON"
				value={metadataText}
				onChange={(raw) => {
					setMetadataText(raw);
					if (!raw.trim()) {
						onChange({ ...item, metadata: undefined });
						return;
					}
					try {
						const parsed = JSON.parse(raw) as unknown;
						if (isRecord(parsed)) onChange({ ...item, metadata: parsed });
					} catch {
						/* keep editing invalid JSON locally */
					}
				}}
				multiline
				rows={5}
				mono
			/>
			<div style={{ display: "flex", gap: 8 }}>
				<Btn size="sm" variant="secondary" onClick={onDuplicate}>
					Duplicate case
				</Btn>
				<Btn size="sm" variant="danger" onClick={onDelete}>
					Delete case
				</Btn>
			</div>
		</div>
	);
}

function RunList({
	rows,
	selectedRunId,
	onSelect,
}: {
	rows: EvalRun[];
	selectedRunId?: string;
	onSelect: (runId: string) => void;
}) {
	if (rows.length === 0) return <div style={emptyBoxStyle}>No runs yet.</div>;
	return (
		<div style={{ display: "grid", gap: 6 }}>
			{rows.map((run) => (
				<button
					key={run.id}
					type="button"
					onClick={() => onSelect(run.id)}
					style={{
						...runRowStyle,
						background: selectedRunId === run.id ? ag.surface2 : "transparent",
					}}
				>
					<div style={{ minWidth: 0, flex: 1 }}>
						<Mono size={11}>{run.id}</Mono>
						<div style={{ marginTop: 5, display: "flex", gap: 5 }}>
							<StatusTag status={run.status} />
							{run.summary ? (
								<OutcomeTag
									outcome={run.summary.outcome}
									passed={run.summary.passed}
									score={run.summary.overallScore}
								/>
							) : null}
							{run.partial && (
								<Tag bg="transparent" color={ag.muted}>
									partial
								</Tag>
							)}
						</div>
					</div>
					<Mono size={10.5} color={ag.muted}>
						{formatDate(run.startedAt)}
					</Mono>
				</button>
			))}
		</div>
	);
}

function RunDetail({ run }: { run: EvalRun }) {
	return (
		<div style={{ display: "grid", gap: 14 }}>
			<div style={compareContextStyle}>
				<InfoPair label="Run" value={run.id} mono />
				<InfoPair label="Status" value={run.status} />
				<InfoPair
					label="Eval version"
					value={run.evalVersion ?? "current"}
					mono
				/>
				<InfoPair
					label="Dataset version"
					value={run.datasetVersion ?? "current"}
					mono
				/>
				<InfoPair
					label="Agent version"
					value={run.agentVersion ?? "current"}
					mono
				/>
				<InfoPair label="Started" value={formatDate(run.startedAt)} />
			</div>
			{run.summary && (
				<>
					<div style={metricGridStyle}>
						<Metric label="Overall" value={percent(run.summary.overallScore)} />
						<Metric
							label="Outcome"
							value={outcomeLabel(run.summary.outcome, run.summary.passed)}
						/>
						<Metric
							label="Completed"
							value={`${run.summary.completedCases}/${run.summary.totalCases}`}
						/>
						<Metric
							label="Failed"
							value={String(run.summary.failedCases)}
							tone={run.summary.failedCases ? "warn" : "ok"}
						/>
					</div>
					<CriteriaSummary
						criteria={run.snapshots.eval.criteria}
						summary={run.summary.criteria}
					/>
				</>
			)}
			{run.error && <div style={failureStyle}>{run.error}</div>}
			<div style={{ display: "grid", gap: 10 }}>
				<SectionLabel>Cases</SectionLabel>
				{run.caseResults.map((result) => (
					<details key={result.itemId} style={caseDetailStyle}>
						<summary style={caseSummaryStyle}>
							<Mono size={11}>{result.itemId}</Mono>
							<StatusTag status={result.status} />
							<OutcomeTag
								outcome={result.outcome}
								passed={result.passed}
								score={result.score}
							/>
						</summary>
						<div style={{ display: "grid", gap: 10, marginTop: 10 }}>
							<Snippet label="Input" value={result.input} />
							{result.output && (
								<Snippet label="Agent output" value={result.output} />
							)}
							{result.error && <div style={failureStyle}>{result.error}</div>}
							{Object.entries(result.criteria).map(([id, criterion]) => (
								<div key={id} style={criterionResultStyle}>
									<div
										style={{ display: "flex", gap: 6, alignItems: "center" }}
									>
										<Mono size={11}>{id}</Mono>
										<OutcomeTag
											passed={criterion.passed}
											score={criterion.score}
											outcome={criterion.passed ? "passed" : "failed"}
										/>
									</div>
									<div style={{ marginTop: 5, fontSize: 12, color: ag.text2 }}>
										{criterion.reason}
									</div>
								</div>
							))}
						</div>
					</details>
				))}
			</div>
		</div>
	);
}

function CriteriaSummary({
	criteria,
	summary,
}: {
	criteria: EvalCriterion[];
	summary?: NonNullable<EvalRun["summary"]>["criteria"];
}) {
	if (criteria.length === 0)
		return <div style={emptyBoxStyle}>No criteria.</div>;
	return (
		<div style={{ overflowX: "auto" }}>
			<table style={tableStyle}>
				<thead>
					<tr>
						<th style={thStyle}>Criterion</th>
						<th style={thStyle}>Weight</th>
						<th style={thStyle}>Gate</th>
						<th style={thStyle}>Latest</th>
						<th style={thStyle}>Cases</th>
					</tr>
				</thead>
				<tbody>
					{criteria.map((criterion) => {
						const row = summary?.[criterion.id];
						const gate = criterion.gate?.minimumScore ?? criterion.threshold;
						return (
							<tr key={criterion.id}>
								<td style={tdStyle}>
									<div style={{ fontWeight: 600 }}>{criterion.name}</div>
									<Mono size={10.5} color={ag.muted}>
										{criterion.id}
									</Mono>
								</td>
								<td style={tdStyle}>{criterion.weight ?? 1}</td>
								<td style={tdStyle}>
									{gate === undefined ? (
										<Mono size={11} color={ag.muted}>
											none
										</Mono>
									) : (
										<Tag bg="transparent" color={ag.muted}>
											{percent(gate)}
										</Tag>
									)}
								</td>
								<td style={tdStyle}>
									{row ? (
										<OutcomeTag
											passed={row.passed}
											score={row.score}
											outcome={row.passed ? "passed" : "failed"}
										/>
									) : (
										<Mono size={11} color={ag.muted}>
											no score
										</Mono>
									)}
								</td>
								<td style={tdStyle}>{row?.completedCases ?? 0}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function CompareRows({
	evalId,
	datasetId,
	agentVersions,
	scores,
	showCriteria,
}: {
	evalId: string;
	datasetId?: string;
	agentVersions: AgentVersionSummary[];
	scores: EvalLatestScore[];
	showCriteria?: EvalCriterion[];
}) {
	if (!datasetId) return <div style={emptyBoxStyle}>Select a dataset.</div>;
	const rows = buildVersionOptions(agentVersions).filter(
		(option) => option.resolvedVersion,
	);
	if (rows.length === 0)
		return <div style={emptyBoxStyle}>No agent versions.</div>;
	return (
		<div style={{ overflowX: "auto" }}>
			<table style={tableStyle}>
				<thead>
					<tr>
						<th style={thStyle}>Agent Version</th>
						<th style={thStyle}>Overall</th>
						<th style={thStyle}>Outcome</th>
						{showCriteria?.map((criterion) => (
							<th key={criterion.id} style={thStyle}>
								{criterion.name}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((version) => {
						const score = scores.find(
							(row) =>
								row.evalId === evalId &&
								row.datasetId === datasetId &&
								row.resolvedAgentVersion === version.resolvedVersion,
						);
						return (
							<tr key={version.value}>
								<td style={tdStyle}>
									<Mono size={11}>{version.label}</Mono>
								</td>
								<td style={tdStyle}>
									{score ? percent(score.overallScore) : "no score"}
								</td>
								<td style={tdStyle}>
									{score ? (
										<OutcomeTag
											outcome={score.summary?.outcome}
											passed={score.passed}
										/>
									) : (
										<Mono size={11} color={ag.muted}>
											-
										</Mono>
									)}
								</td>
								{showCriteria?.map((criterion) => {
									const criterionScore = score?.summary?.criteria[criterion.id];
									return (
										<td key={criterion.id} style={tdStyle}>
											{criterionScore ? (
												<OutcomeTag
													passed={criterionScore.passed}
													score={criterionScore.score}
													outcome={criterionScore.passed ? "passed" : "failed"}
												/>
											) : (
												<Mono size={11} color={ag.muted}>
													-
												</Mono>
											)}
										</td>
									);
								})}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function ModelFields({
	model,
	onChange,
}: {
	model?: ModelConfig;
	onChange: (model: ModelConfig | undefined) => void;
}) {
	const current = model ?? { provider: "openai", name: "gpt-5.4-mini" };
	return (
		<>
			<EditableText
				label="Judge provider"
				value={current.provider}
				onChange={(provider) => onChange({ ...current, provider })}
			/>
			<EditableText
				label="Judge model"
				value={current.name}
				onChange={(name) => onChange({ ...current, name })}
			/>
		</>
	);
}

function TabBar({
	active,
	onSelect,
}: {
	active: TabKey;
	onSelect: (key: TabKey) => void;
}) {
	return (
		<div style={tabBarStyle}>
			{TABS.map((tab) => (
				<button
					key={tab.key}
					type="button"
					onClick={() => onSelect(tab.key)}
					style={{
						...tabButtonStyle,
						background: active === tab.key ? ag.surface2 : "transparent",
						color: active === tab.key ? ag.ink : ag.muted,
						borderColor: active === tab.key ? ag.line : "transparent",
					}}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

function Panel({
	title,
	right,
	children,
}: {
	title: string;
	right?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section style={panelStyle}>
			<div style={panelHeaderStyle}>
				<SectionLabel>{title}</SectionLabel>
				{right}
			</div>
			{children}
		</section>
	);
}

function EmptyMain({
	title,
	body,
	action,
	onAction,
}: {
	title: string;
	body: string;
	action?: string;
	onAction?: () => void;
}) {
	return (
		<div style={emptyMainStyle}>
			<div style={{ fontSize: 15, fontWeight: 650, color: ag.ink }}>
				{title}
			</div>
			<div style={{ marginTop: 5, fontSize: 13, color: ag.text2 }}>{body}</div>
			{action && onAction && (
				<Btn style={{ marginTop: 14 }} onClick={onAction}>
					{action}
				</Btn>
			)}
			{action && !onAction && (
				<Mono
					size={11}
					color={ag.muted}
					style={{ marginTop: 12, display: "block" }}
				>
					{action}
				</Mono>
			)}
		</div>
	);
}

function Metric({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "ok" | "warn";
}) {
	return (
		<div style={metricStyle}>
			<SectionLabel>{label}</SectionLabel>
			<div
				style={{
					marginTop: 7,
					fontSize: 22,
					fontWeight: 650,
					color: tone === "warn" ? ag.warn : tone === "ok" ? ag.ok : ag.ink,
					overflowWrap: "anywhere",
				}}
			>
				{value}
			</div>
		</div>
	);
}

function InfoPair({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div style={{ minWidth: 0 }}>
			<Mono size={10.5} color={ag.muted}>
				{label}
			</Mono>
			<div
				style={{
					marginTop: 3,
					fontSize: 12,
					color: ag.ink,
					fontFamily: mono ? "var(--font-mono)" : "inherit",
					overflowWrap: "anywhere",
				}}
			>
				{value}
			</div>
		</div>
	);
}

function OutcomeTag({
	outcome,
	passed,
	score,
}: {
	outcome?: string;
	passed?: boolean;
	score?: number;
}) {
	const failed = outcome === "failed" || passed === false;
	const label =
		score === undefined ? outcomeLabel(outcome, passed) : percent(score);
	return (
		<Tag bg={failed ? ag.warnBg : ag.okBg} color={failed ? ag.warn : ag.ok}>
			{label}
		</Tag>
	);
}

function StatusTag({ status }: { status: string }) {
	const tone =
		status === "completed"
			? [ag.okBg, ag.ok]
			: status === "failed" || status === "cancelled"
				? [ag.warnBg, ag.warn]
				: ["transparent", ag.muted];
	return (
		<Tag bg={tone[0]} color={tone[1]}>
			{status}
		</Tag>
	);
}

function Snippet({ label, value }: { label: string; value: unknown }) {
	return (
		<div>
			<Mono size={10.5} color={ag.muted}>
				{label}
			</Mono>
			<pre style={snippetStyle}>
				{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
}

function LinkButton({
	href,
	children,
}: {
	href: string;
	children: ReactNode;
}) {
	return (
		<Link href={href} style={linkButtonStyle}>
			{children}
		</Link>
	);
}

function VersionBadge({ options }: { options: VersionOption[] }) {
	const latest = options.find((option) => option.value === "latest");
	return (
		<Tag bg="transparent" color={ag.muted}>
			{latest ? `latest ${latest.short}` : "no versions"}
		</Tag>
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return <div style={sectionLabelStyle}>{children}</div>;
}

function RailEmpty({ children }: { children: ReactNode }) {
	return <div style={{ color: ag.muted, fontSize: 12 }}>{children}</div>;
}

interface VersionOption {
	value: string;
	label: string;
	short?: string;
	resolvedVersion?: string;
}

function buildVersionOptions(versions: AgentVersionSummary[]): VersionOption[] {
	const latest = versions[0];
	const current = versions.find((version) => version.activatedAt) ?? latest;
	const options: VersionOption[] = [
		{
			value: "current",
			label: current
				? `current · ${shortVersion(current.createdAt)}`
				: "current",
		},
	];
	if (latest) {
		options.push({
			value: "latest",
			label: `latest · ${shortVersion(latest.createdAt)}`,
			short: shortVersion(latest.createdAt),
			resolvedVersion: latest.createdAt,
		});
	}
	if (current) {
		options[0] = {
			value: "current",
			label: `current · ${shortVersion(current.createdAt)}`,
			short: shortVersion(current.createdAt),
			resolvedVersion: current.createdAt,
		};
	}
	for (const version of versions) {
		for (const alias of version.aliases) {
			options.push({
				value: alias,
				label: `@${alias} · ${shortVersion(version.createdAt)}`,
				short: alias,
				resolvedVersion: version.createdAt,
			});
		}
	}
	for (const version of versions.slice(0, 8)) {
		options.push({
			value: version.createdAt,
			label: shortVersion(version.createdAt),
			short: shortVersion(version.createdAt),
			resolvedVersion: version.createdAt,
		});
	}
	return dedupeOptions(options);
}

function buildObjectVersionOptions(
	versions: EvalVersionSummary[],
): VersionOption[] {
	const latest = versions[0];
	const current = versions.find((version) => version.activatedAt) ?? latest;
	const options: VersionOption[] = [
		{
			value: "current",
			label: current
				? `current · ${shortVersion(current.createdAt)}`
				: "current",
		},
	];
	if (latest) {
		options.push({
			value: "latest",
			label: `latest · ${shortVersion(latest.createdAt)}`,
			short: shortVersion(latest.createdAt),
			resolvedVersion: latest.createdAt,
		});
	}
	for (const version of versions) {
		for (const alias of version.aliases) {
			options.push({
				value: alias,
				label: `@${alias} · ${shortVersion(version.createdAt)}`,
				short: alias,
				resolvedVersion: version.createdAt,
			});
		}
	}
	for (const version of versions.slice(0, 8)) {
		options.push({
			value: version.createdAt,
			label: shortVersion(version.createdAt),
			short: shortVersion(version.createdAt),
			resolvedVersion: version.createdAt,
		});
	}
	return dedupeOptions(options);
}

function dedupeOptions(options: VersionOption[]): VersionOption[] {
	const seen = new Set<string>();
	return options.filter((option) => {
		if (seen.has(option.value)) return false;
		seen.add(option.value);
		return true;
	});
}

function newEval(agentId: string, dataset?: EvalDataset): EvalDefinition {
	return {
		id: "quality_check",
		agentId,
		name: "Quality Check",
		description: "",
		defaultDataset: dataset ? { id: dataset.id } : undefined,
		defaultDatasetId: dataset?.id,
		passPolicy: { minimumScore: 0.7 },
		judge: { model: { provider: "openai", name: "gpt-5.4-mini" } },
		criteria: [
			{
				id: "quality",
				name: "Quality",
				weight: 1,
				rubric: "Score whether the agent output satisfies the user request.",
			},
		],
	};
}

function newDataset(agentId: string): EvalDataset {
	return {
		id: "regression_cases",
		agentId,
		name: "Regression Cases",
		description: "",
		items: [newCase([])],
	};
}

function newCase(items: DatasetItem[]): DatasetItem {
	return {
		id: `case_${String(items.length + 1).padStart(3, "0")}`,
		input: "",
	};
}

function cleanEval(value: EvalDefinition): EvalDefinition {
	return {
		...value,
		id: slug(value.id) || value.id,
		name: value.name.trim() || value.id,
		description: value.description?.trim() || undefined,
		defaultDataset: value.defaultDataset?.id ? value.defaultDataset : undefined,
		defaultDatasetId: value.defaultDataset?.id ?? value.defaultDatasetId,
		passPolicy:
			typeof value.passPolicy?.minimumScore === "number"
				? { minimumScore: value.passPolicy.minimumScore }
				: undefined,
		passThreshold: undefined,
		judge: value.judge?.model ? { model: value.judge.model } : undefined,
		judgeModel: undefined,
		criteria: value.criteria.map((criterion, index) => ({
			id: slug(criterion.id) || `criterion_${index + 1}`,
			name: criterion.name.trim() || `Criterion ${index + 1}`,
			rubric: criterion.rubric ?? criterion.description ?? "",
			weight: criterion.weight ?? 1,
			gate: criterion.gate,
			description: undefined,
			threshold: undefined,
		})),
	};
}

function cleanDataset(value: EvalDataset): EvalDataset {
	return {
		...value,
		id: slug(value.id) || value.id,
		name: value.name.trim() || value.id,
		description: value.description?.trim() || undefined,
		items: value.items.map((item, index) => ({
			id: slug(item.id) || `case_${index + 1}`,
			name: item.name?.trim() || undefined,
			input: item.input,
			metadata: item.metadata,
		})),
	};
}

function selectedEvalDatasetId(
	definition: EvalDefinition | null,
): string | undefined {
	return definition?.defaultDataset?.id ?? definition?.defaultDatasetId;
}

function latestScoreFor(
	scores: EvalLatestScore[],
	evalId?: string,
	datasetId?: string,
): EvalLatestScore | null {
	if (!evalId) return null;
	const rows = scores.filter(
		(score) =>
			score.evalId === evalId && (!datasetId || score.datasetId === datasetId),
	);
	return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

async function readJson<T>(res: Response): Promise<T> {
	const data = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) {
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
	return data;
}

function parseManifest(
	agent: AgentResponse,
	agentId: string,
): Record<string, unknown> {
	const source = agent.metadata?.manifest;
	if (typeof source !== "string" || !source.trim()) return { id: agentId };
	try {
		const parsed = parseYAML(source) as unknown;
		return isRecord(parsed) ? parsed : { id: agentId };
	} catch {
		return { id: agentId };
	}
}

function asTab(value: string | null): TabKey | undefined {
	return TABS.some((tab) => tab.key === value) ? (value as TabKey) : undefined;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextCriterionId(criteria: EvalCriterion[]): string {
	let index = criteria.length + 1;
	while (criteria.some((criterion) => criterion.id === `criterion_${index}`)) {
		index += 1;
	}
	return `criterion_${index}`;
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

function shortVersion(value: string): string {
	return value.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function outcomeLabel(outcome?: string, passed?: boolean): string {
	if (outcome === "score_only") return "score-only";
	if (outcome === "passed") return "passed";
	if (outcome === "failed") return "failed";
	if (passed === true) return "passed";
	if (passed === false) return "failed";
	return "not run";
}

function previewInput(value: unknown): string {
	const raw = typeof value === "string" ? value : JSON.stringify(value);
	return raw.length > 72 ? `${raw.slice(0, 69)}...` : raw;
}

function stringifyInput(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function parseLooseInput(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		try {
			return JSON.parse(trimmed) as unknown;
		} catch {
			return raw;
		}
	}
	return raw;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const pageStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	minHeight: "100vh",
	background: ag.bg,
};

const headerStyle: CSSProperties = {
	padding: "20px 32px 18px",
	borderBottom: `1px solid ${ag.line2}`,
	background: ag.bg,
};

const headerRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "flex-end",
	justifyContent: "space-between",
	gap: 24,
	flexWrap: "wrap",
};

const titleStyle: CSSProperties = {
	margin: 0,
	fontSize: 24,
	fontWeight: 600,
	letterSpacing: "-0.015em",
	color: ag.ink,
};

const subtitleStyle: CSSProperties = {
	marginTop: 5,
	fontSize: 13,
	color: ag.text2,
};

const actionRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	flexWrap: "wrap",
};

const linkButtonStyle: CSSProperties = {
	background: ag.surface2,
	color: ag.ink,
	border: `1px solid ${ag.line}`,
	borderRadius: 4,
	padding: "6px 11px",
	fontSize: 12.5,
	fontWeight: 500,
	textDecoration: "none",
};

const errorStyle: CSSProperties = {
	padding: "8px 32px",
	background: "#FBEFEA",
	borderBottom: `1px solid ${ag.line2}`,
	color: ag.danger,
	fontSize: 12,
	display: "flex",
	alignItems: "center",
	gap: 8,
};

const workspaceStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "280px minmax(0, 1fr) 320px",
	minHeight: 0,
	flex: 1,
};

const railStyle: CSSProperties = {
	background: ag.surface,
	borderRight: `1px solid ${ag.line2}`,
	padding: 14,
	overflow: "auto",
};

const mainStyle: CSSProperties = {
	minWidth: 0,
	display: "flex",
	flexDirection: "column",
};

const setupStyle: CSSProperties = {
	background: ag.surface,
	borderLeft: `1px solid ${ag.line2}`,
	padding: 16,
	overflow: "auto",
};

const searchBoxStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 7,
	border: `1px solid ${ag.line}`,
	background: ag.surface2,
	borderRadius: 4,
	padding: "6px 9px",
	color: ag.muted,
	marginBottom: 14,
};

const bareInputStyle: CSSProperties = {
	border: 0,
	outline: 0,
	background: "transparent",
	color: ag.ink,
	fontFamily: "inherit",
	fontSize: 12,
	width: "100%",
};

const railHeaderStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	marginBottom: 8,
};

const sectionLabelStyle: CSSProperties = {
	fontSize: 10.5,
	letterSpacing: "0.08em",
	textTransform: "uppercase",
	color: ag.muted,
	fontWeight: 500,
};

const iconButtonStyle: CSSProperties = {
	width: 24,
	height: 24,
	border: `1px solid ${ag.line}`,
	background: ag.surface2,
	borderRadius: 4,
	display: "grid",
	placeItems: "center",
	color: ag.ink,
	cursor: "pointer",
};

const railRowStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	textAlign: "left",
	border: `1px solid ${ag.line2}`,
	borderRadius: 5,
	padding: 9,
	fontFamily: "inherit",
	cursor: "pointer",
	color: ag.ink,
};

const railRowTitleStyle: CSSProperties = {
	fontSize: 13,
	fontWeight: 650,
	color: ag.ink,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const tabBarStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 4,
	padding: "10px 16px",
	borderBottom: `1px solid ${ag.line2}`,
	background: ag.surface,
};

const tabButtonStyle: CSSProperties = {
	border: "1px solid transparent",
	borderRadius: 4,
	padding: "5px 10px",
	fontFamily: "inherit",
	fontSize: 12,
	fontWeight: 500,
	cursor: "pointer",
};

const contentStyle: CSSProperties = {
	padding: 16,
	overflow: "auto",
	minHeight: 0,
	flex: 1,
};

const tabGridStyle: CSSProperties = {
	display: "grid",
	gap: 14,
};

const panelStyle: CSSProperties = {
	background: ag.surface,
	border: `1px solid ${ag.line2}`,
	borderRadius: 6,
	padding: 14,
	minWidth: 0,
};

const panelHeaderStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: 12,
	marginBottom: 12,
	flexWrap: "wrap",
};

const metricGridStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
	gap: 12,
};

const metricStyle: CSSProperties = {
	background: ag.surface,
	border: `1px solid ${ag.line2}`,
	borderRadius: 6,
	padding: 14,
	minWidth: 0,
};

const formGridStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	gap: 12,
};

const criterionBoxStyle: CSSProperties = {
	border: `1px solid ${ag.line2}`,
	background: ag.surface,
	borderRadius: 5,
	padding: 12,
};

const criterionHeaderStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 6,
	marginBottom: 10,
};

const criterionGridStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr) 120px 160px",
	gap: 10,
};

const datasetGridStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "minmax(260px, 0.8fr) minmax(360px, 1.2fr)",
	gap: 14,
};

const caseRowStyle: CSSProperties = {
	border: `1px solid ${ag.line2}`,
	borderRadius: 5,
	padding: 9,
	display: "flex",
	textAlign: "left",
	fontFamily: "inherit",
	cursor: "pointer",
};

const runsGridStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "minmax(280px, 0.8fr) minmax(420px, 1.2fr)",
	gap: 14,
};

const runRowStyle: CSSProperties = {
	width: "100%",
	display: "flex",
	alignItems: "center",
	gap: 10,
	textAlign: "left",
	border: `1px solid ${ag.line2}`,
	borderRadius: 5,
	padding: 9,
	fontFamily: "inherit",
	cursor: "pointer",
};

const checkboxRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "flex-start",
	gap: 8,
	border: `1px solid ${ag.line2}`,
	borderRadius: 5,
	padding: 8,
	background: ag.surface,
};

const setupRunStyle: CSSProperties = {
	border: `1px solid ${ag.line2}`,
	borderRadius: 5,
	padding: 10,
	marginTop: 8,
	display: "grid",
	gap: 8,
};

const tableStyle: CSSProperties = {
	width: "100%",
	borderCollapse: "collapse",
	fontSize: 12,
};

const thStyle: CSSProperties = {
	textAlign: "left",
	padding: "8px 8px",
	borderBottom: `1px solid ${ag.line2}`,
	color: ag.muted,
	fontWeight: 500,
	fontSize: 10.5,
	textTransform: "uppercase",
	letterSpacing: "0.08em",
};

const tdStyle: CSSProperties = {
	padding: "9px 8px",
	borderBottom: `1px solid ${ag.line2}`,
	verticalAlign: "top",
};

const emptyBoxStyle: CSSProperties = {
	border: `1px dashed ${ag.line}`,
	borderRadius: 5,
	padding: 16,
	color: ag.muted,
	fontSize: 12,
	textAlign: "center",
};

const emptyMainStyle: CSSProperties = {
	background: ag.surface,
	border: `1px solid ${ag.line2}`,
	borderRadius: 6,
	padding: 40,
	textAlign: "center",
};

const centerStyle: CSSProperties = {
	margin: "auto",
	display: "flex",
	alignItems: "center",
	gap: 8,
	color: ag.muted,
};

const failureStyle: CSSProperties = {
	display: "flex",
	alignItems: "flex-start",
	gap: 7,
	padding: "8px 10px",
	border: `1px solid ${ag.line}`,
	background: "#FBEFEA",
	color: ag.danger,
	borderRadius: 5,
	fontSize: 12,
};

const compareContextStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
	gap: 12,
};

const caseDetailStyle: CSSProperties = {
	border: `1px solid ${ag.line2}`,
	borderRadius: 5,
	padding: 10,
	background: ag.surface,
};

const caseSummaryStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	cursor: "pointer",
};

const criterionResultStyle: CSSProperties = {
	borderTop: `1px solid ${ag.line2}`,
	paddingTop: 8,
};

const snippetStyle: CSSProperties = {
	margin: "4px 0 0",
	padding: 10,
	background: ag.surface2,
	border: `1px solid ${ag.line}`,
	borderRadius: 5,
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
	fontFamily: "var(--font-mono)",
	fontSize: 11,
	color: ag.text2,
};
