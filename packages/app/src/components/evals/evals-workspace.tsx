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
	EvalCriterion,
	EvalDataset,
	EvalDefinition,
	EvalInput,
	EvalLatestScore,
	EvalVersionSummary,
	ModelConfig,
} from "@agntz/core";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { InputForm } from "../playground/input-form";

type TabKey = "general" | "rubric" | "dataset";
type DatasetItem = EvalDataset["items"][number];

interface AgentResponse {
	id?: string;
	name?: string;
	metadata?: { manifest?: unknown };
	updatedAt?: string;
}

const TABS: Array<{ key: TabKey; label: string }> = [
	{ key: "general", label: "General" },
	{ key: "rubric", label: "Rubric" },
	{ key: "dataset", label: "Dataset" },
];

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
	const [scores, setScores] = useState<EvalLatestScore[]>([]);
	const [evalVersions, setEvalVersions] = useState<EvalVersionSummary[]>([]);
	const [datasetVersions, setDatasetVersions] = useState<EvalVersionSummary[]>(
		[],
	);
	const [selectedDatasetId, setSelectedDatasetId] = useState(
		() => searchParams.get("dataset") ?? "",
	);
	const [tab, setTab] = useState<TabKey>(
		() => asTab(searchParams.get("tab")) ?? "general",
	);
	const [selectedCriterionId, setSelectedCriterionId] = useState(
		() => searchParams.get("criterion") ?? "",
	);
	const [draftEval, setDraftEval] = useState<EvalDefinition | null>(null);
	const [draftDataset, setDraftDataset] = useState<EvalDataset | null>(null);
	const [selectedCaseId, setSelectedCaseId] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState<"eval" | "dataset" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const selectedEval = useMemo(() => evals[0] ?? null, [evals]);
	const selectedDataset = useMemo(
		() =>
			datasets.find((row) => row.id === selectedDatasetId) ??
			datasets.find((row) => row.id === selectedEvalDatasetId(selectedEval)) ??
			datasets[0] ??
			null,
		[datasets, selectedDatasetId, selectedEval],
	);
	const latestScore = useMemo(
		() => latestScoreFor(scores, selectedEval?.id, selectedDataset?.id),
		[scores, selectedEval, selectedDataset],
	);
	const evalVersionOptions = useMemo(
		() => buildObjectVersionOptions(evalVersions),
		[evalVersions],
	);
	const datasetVersionOptions = useMemo(
		() => buildObjectVersionOptions(datasetVersions),
		[datasetVersions],
	);
	const selectedCriterion = useMemo(() => {
		const criteria = draftEval?.criteria ?? [];
		return (
			criteria.find((criterion) => criterion.id === selectedCriterionId) ??
			criteria[0] ??
			null
		);
	}, [draftEval, selectedCriterionId]);
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
		const [agentRes, evalRes, datasetRes, scoreRes] = await Promise.all([
			fetch(`/api/agents/${encodeURIComponent(agentId)}`),
			fetch(`/api/evals?agentId=${encodeURIComponent(agentId)}`),
			fetch(`/api/datasets?agentId=${encodeURIComponent(agentId)}`),
			fetch(`/api/eval-scores?agentId=${encodeURIComponent(agentId)}`),
		]);
		const [agent, evalRows, datasetRows, scoreRows] = await Promise.all([
			readJson<AgentResponse>(agentRes),
			readJson<EvalDefinition[]>(evalRes),
			readJson<EvalDataset[]>(datasetRes),
			readJson<EvalLatestScore[]>(scoreRes),
		]);
		setAgentName(agent.name ?? agent.id ?? agentId);
		setManifest(parseManifest(agent, agentId));
		setEvals(Array.isArray(evalRows) ? evalRows : []);
		setDatasets(Array.isArray(datasetRows) ? datasetRows : []);
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
		if (!draftEval && selectedEval) {
			setDraftEval(clone(selectedEval));
		}
	}, [draftEval, selectedEval]);

	useEffect(() => {
		const criteria = draftEval?.criteria ?? [];
		if (criteria.length === 0) return;
		if (criteria.some((criterion) => criterion.id === selectedCriterionId))
			return;
		const nextId = criteria[0].id;
		setSelectedCriterionId(nextId);
		updateQuery({ criterion: nextId });
	}, [draftEval, selectedCriterionId, updateQuery]);

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
		const datasetId = selectedDataset?.id;
		if (!datasetId) {
			setDatasetVersions([]);
			return;
		}
		fetch(`/api/datasets/${encodeURIComponent(datasetId)}/versions`)
			.then((res) => readJson<EvalVersionSummary[]>(res))
			.then((rows) => setDatasetVersions(Array.isArray(rows) ? rows : []))
			.catch((err) => setError(formatError(err)));
	}, [selectedDataset]);

	const selectDataset = (datasetId: string) => {
		const dataset = datasets.find((row) => row.id === datasetId) ?? null;
		setSelectedDatasetId(datasetId);
		setDraftDataset(dataset ? clone(dataset) : null);
		setSelectedCaseId(dataset?.items[0]?.id ?? "");
		updateQuery({ dataset: datasetId });
	};

	const selectTab = (key: TabKey) => {
		setTab(key);
		updateQuery({ tab: key });
	};

	const initializeEval = () => {
		const next = newEval(agentId, datasets[0]);
		setDraftEval(next);
		setSelectedCriterionId(next.criteria[0]?.id ?? "");
		setTab("rubric");
		updateQuery({
			criterion: next.criteria[0]?.id ?? null,
			tab: "rubric",
		});
	};

	const selectCriterion = (criterionId: string) => {
		setSelectedCriterionId(criterionId);
		setTab("rubric");
		updateQuery({ criterion: criterionId, tab: "rubric" });
	};

	const addCriterion = () => {
		const base = draftEval ?? selectedEval;
		if (!base) {
			initializeEval();
			return;
		}
		const criterion: EvalCriterion = {
			id: nextCriterionId(base.criteria ?? []),
			name: "New criterion",
			weight: 1,
			rubric: "Score this criterion from 0 to 1.",
		};
		setDraftEval({
			...base,
			criteria: [...(base.criteria ?? []), criterion],
		});
		setSelectedCriterionId(criterion.id);
		setTab("rubric");
		updateQuery({ criterion: criterion.id, tab: "rubric" });
	};

	const startNewDataset = () => {
		const next = newDataset(agentId);
		setSelectedDatasetId(EMPTY_DATASET_ID);
		setDraftDataset(next);
		setSelectedCaseId(next.items[0]?.id ?? "");
		setTab("dataset");
		updateQuery({ dataset: null, tab: "dataset" });
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
			setDraftEval(clone(saved));
			updateQuery({
				criterion: selectedCriterionId || saved.criteria[0]?.id || null,
			});
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
			setDraftDataset(clone(saved));
			updateQuery({ dataset: saved.id });
		} catch (err) {
			setError(formatError(err));
		} finally {
			setSaving(null);
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
			const existing = draftEval ?? selectedEval;
			const base = existing ?? newEval(agentId, datasets[0]);
			const next = cleanEval({
				...base,
				...parsed,
				id: existing?.id ?? parsed.id ?? base.id,
				agentId,
			});
			setDraftEval(next);
			setSelectedCriterionId(next.criteria[0]?.id ?? "");
			setTab("rubric");
			updateQuery({
				criterion: next.criteria[0]?.id ?? null,
				tab: "rubric",
			});
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
				<main style={mainStyle}>
					<TabBar active={tab} onSelect={selectTab} />
					<div style={contentStyle}>
						{tab === "general" && draftEval && (
							<GeneralTab
								evalDefinition={draftEval}
								datasets={datasets}
								latestScore={latestScore}
								saving={saving === "eval"}
								versionOptions={evalVersionOptions}
								onChange={setDraftEval}
								onSelectCriterion={(criterionId) => {
									setSelectedCriterionId(criterionId);
									setTab("rubric");
									updateQuery({ criterion: criterionId, tab: "rubric" });
								}}
								onAddCriterion={addCriterion}
								onSave={saveEval}
								onExport={exportEvalYaml}
							/>
						)}
						{tab === "general" && !draftEval && (
							<EmptyMain
								title="No eval initialized"
								body="Initialize the agent eval to define criteria, pass policy, and judge model."
								action="Initialize Eval"
								onAction={initializeEval}
							/>
						)}
						{tab === "rubric" && draftEval && (
							<RubricTab
								value={draftEval}
								saving={saving === "eval"}
								versionOptions={evalVersionOptions}
								selectedCriterion={selectedCriterion}
								selectedCriterionId={selectedCriterionId}
								onChange={setDraftEval}
								onSelectCriterion={(criterionId) => {
									setSelectedCriterionId(criterionId);
									updateQuery({ criterion: criterionId || null });
								}}
								onAddCriterion={addCriterion}
								onSave={saveEval}
							/>
						)}
						{tab === "rubric" && !draftEval && (
							<EmptyMain
								title="No eval initialized"
								body="Initialize the agent eval to define criteria, pass policy, and judge model."
								action="Initialize Eval"
								onAction={initializeEval}
							/>
						)}
						{tab === "dataset" && draftDataset && (
							<DatasetTab
								value={draftDataset}
								manifest={manifest}
								selectedCase={selectedCase}
								saving={saving === "dataset"}
								versionOptions={datasetVersionOptions}
								datasets={datasets}
								onChange={setDraftDataset}
								onSelectDataset={selectDataset}
								onSelectCase={setSelectedCaseId}
								onNewDataset={startNewDataset}
								onSave={saveDataset}
								onImport={importDatasetYaml}
								onExport={exportDatasetYaml}
							/>
						)}
						{tab === "dataset" && !draftDataset && (
							<EmptyMain
								title="No dataset selected"
								body="Create a dataset to collect example inputs for this eval."
								action="New Dataset"
								onAction={startNewDataset}
							/>
						)}
					</div>
				</main>
			</div>
		</div>
	);
}

function GeneralTab({
	evalDefinition,
	datasets,
	latestScore,
	saving,
	versionOptions,
	onChange,
	onSelectCriterion,
	onAddCriterion,
	onSave,
	onExport,
}: {
	evalDefinition: EvalDefinition;
	datasets: EvalDataset[];
	latestScore: EvalLatestScore | null;
	saving: boolean;
	versionOptions: VersionOption[];
	onChange: (next: EvalDefinition) => void;
	onSelectCriterion: (criterionId: string) => void;
	onAddCriterion: () => void;
	onSave: () => void;
	onExport: () => void;
}) {
	const patch = (patchValue: Partial<EvalDefinition>) =>
		onChange({ ...evalDefinition, ...patchValue });
	const score = latestScore?.summary;
	return (
		<div style={tabGridStyle}>
			<Panel
				title="Eval Settings"
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
				<EvalSettingsFields
					value={evalDefinition}
					datasets={datasets}
					onChange={patch}
				/>
			</Panel>

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
				title="Criteria"
				right={
					<Btn
						size="sm"
						variant="secondary"
						icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
						onClick={onAddCriterion}
					>
						Add criterion
					</Btn>
				}
			>
				<CriterionList
					criteria={evalDefinition.criteria}
					summary={score?.criteria}
					onSelectCriterion={onSelectCriterion}
				/>
			</Panel>
		</div>
	);
}

function EvalSettingsFields({
	value,
	datasets,
	onChange,
}: {
	value: EvalDefinition;
	datasets: EvalDataset[];
	onChange: (patch: Partial<EvalDefinition>) => void;
}) {
	return (
		<>
			<div style={formGridStyle}>
				<EditableText
					label="Name"
					value={value.name}
					onChange={(name) => onChange({ name })}
				/>
				<ReadonlyField label="ID" value={value.id} />
				<EditableSelect
					label="Default dataset"
					value={selectedEvalDatasetId(value) ?? ""}
					options={[
						["", "None"],
						...datasets.map((dataset) => [dataset.id, dataset.name] as const),
					]}
					onChange={(id) =>
						onChange({
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
						onChange({
							passPolicy:
								typeof minimumScore === "number" ? { minimumScore } : undefined,
							passThreshold: undefined,
						})
					}
				/>
				<ModelFields
					model={value.judge?.model ?? value.judgeModel}
					onChange={(model) =>
						onChange({
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
						onChange({ description: description || undefined })
					}
					multiline
					rows={2}
				/>
			</div>
		</>
	);
}

function CriterionList({
	criteria,
	summary,
	selectedCriterionId,
	onSelectCriterion,
}: {
	criteria: EvalCriterion[];
	summary?: NonNullable<EvalLatestScore["summary"]>["criteria"];
	selectedCriterionId?: string;
	onSelectCriterion: (criterionId: string) => void;
}) {
	if (criteria.length === 0)
		return <div style={emptyBoxStyle}>No criteria yet.</div>;
	return (
		<div style={{ display: "grid", gap: 7 }}>
			{criteria.map((criterion) => {
				const result = summary?.[criterion.id];
				const gate = criterion.gate?.minimumScore ?? criterion.threshold;
				return (
					<button
						key={criterion.id}
						type="button"
						onClick={() => onSelectCriterion(criterion.id)}
						style={{
							...railRowStyle,
							background:
								selectedCriterionId === criterion.id
									? ag.surface2
									: "transparent",
							borderColor:
								selectedCriterionId === criterion.id ? ag.line : ag.line2,
						}}
					>
						<div style={{ minWidth: 0, flex: 1 }}>
							<div style={railRowTitleStyle}>{criterion.name}</div>
							<Mono size={10.5} color={ag.muted}>
								{criterion.id} · weight {criterion.weight ?? 1}
							</Mono>
							<div style={{ marginTop: 7, display: "flex", gap: 5 }}>
								{result ? (
									<OutcomeTag
										outcome={result.passed ? "passed" : "failed"}
										passed={result.passed}
										score={result.score}
									/>
								) : (
									<Tag bg="transparent" color={ag.muted}>
										no score
									</Tag>
								)}
								{gate !== undefined && (
									<Tag bg="transparent" color={ag.muted}>
										gate {percent(gate)}
									</Tag>
								)}
							</div>
						</div>
					</button>
				);
			})}
		</div>
	);
}

function RubricTab({
	value,
	saving,
	versionOptions,
	selectedCriterion,
	selectedCriterionId,
	onChange,
	onSelectCriterion,
	onAddCriterion,
	onSave,
}: {
	value: EvalDefinition;
	saving: boolean;
	versionOptions: VersionOption[];
	selectedCriterion: EvalCriterion | null;
	selectedCriterionId: string;
	onChange: (next: EvalDefinition) => void;
	onSelectCriterion: (criterionId: string) => void;
	onAddCriterion: () => void;
	onSave: () => void;
}) {
	const patch = (patchValue: Partial<EvalDefinition>) =>
		onChange({ ...value, ...patchValue });
	const criteria = value.criteria ?? [];
	const selectedIndex = criteria.findIndex(
		(criterion) => criterion.id === selectedCriterionId,
	);
	return (
		<div style={splitTabStyle}>
			<Panel
				title="Criteria"
				right={
					<button
						type="button"
						onClick={onAddCriterion}
						style={iconButtonStyle}
					>
						<I.Plus size={11} />
					</button>
				}
			>
				<CriterionList
					criteria={criteria}
					selectedCriterionId={selectedCriterionId}
					onSelectCriterion={onSelectCriterion}
				/>
			</Panel>

			<Panel
				title={selectedCriterion ? selectedCriterion.name : "Criterion"}
				right={
					<div style={{ display: "flex", gap: 8 }}>
						<VersionBadge options={versionOptions} />
						<Btn size="sm" onClick={onSave} disabled={saving}>
							{saving ? "Saving" : "Save Eval"}
						</Btn>
					</div>
				}
			>
				{selectedCriterion && selectedIndex >= 0 ? (
					<CriterionEditor
						criterion={selectedCriterion}
						index={selectedIndex}
						onChange={(next) => {
							patch({
								criteria: criteria.map((row, rowIndex) =>
									rowIndex === selectedIndex ? next : row,
								),
							});
							if (next.id !== selectedCriterion.id) onSelectCriterion(next.id);
						}}
						onDuplicate={() => {
							const copy = {
								...selectedCriterion,
								id: `${selectedCriterion.id}_copy`,
								name: `${selectedCriterion.name} copy`,
							};
							patch({
								criteria: [
									...criteria.slice(0, selectedIndex + 1),
									copy,
									...criteria.slice(selectedIndex + 1),
								],
							});
							onSelectCriterion(copy.id);
						}}
						onDelete={() => {
							const nextCriteria = criteria.filter(
								(_, rowIndex) => rowIndex !== selectedIndex,
							);
							patch({ criteria: nextCriteria });
							onSelectCriterion(
								nextCriteria[Math.min(selectedIndex, nextCriteria.length - 1)]
									?.id ?? "",
							);
						}}
						onMove={(direction) => {
							const target = selectedIndex + direction;
							if (target < 0 || target >= criteria.length) return;
							const nextCriteria = [...criteria];
							[nextCriteria[selectedIndex], nextCriteria[target]] = [
								nextCriteria[target],
								nextCriteria[selectedIndex],
							];
							patch({ criteria: nextCriteria });
							onSelectCriterion(selectedCriterion.id);
						}}
					/>
				) : (
					<div style={emptyBoxStyle}>Select or add a criterion.</div>
				)}
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
	datasets,
	onChange,
	onSelectDataset,
	onSelectCase,
	onNewDataset,
	onSave,
	onImport,
	onExport,
}: {
	value: EvalDataset;
	manifest: Record<string, unknown>;
	selectedCase: DatasetItem | null;
	saving: boolean;
	versionOptions: VersionOption[];
	datasets: EvalDataset[];
	onChange: (next: EvalDataset) => void;
	onSelectDataset: (datasetId: string) => void;
	onSelectCase: (caseId: string) => void;
	onNewDataset: () => void;
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
	const datasetOptions = datasets.map(
		(dataset) => [dataset.id, dataset.name] as const,
	);
	if (!datasetOptions.some(([id]) => id === value.id)) {
		datasetOptions.unshift([value.id, `${value.name} (unsaved)`] as const);
	}
	return (
		<div style={tabGridStyle}>
			<Panel
				title="Dataset Settings"
				right={
					<div style={{ display: "flex", gap: 8 }}>
						<VersionBadge options={versionOptions} />
						<Btn size="sm" variant="secondary" onClick={onNewDataset}>
							New Dataset
						</Btn>
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
					<EditableSelect
						label="Active dataset"
						value={value.id}
						options={datasetOptions}
						onChange={onSelectDataset}
					/>
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

			<div style={splitTabStyle}>
				<Panel
					title="Examples"
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
							Add example
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
							<div style={emptyBoxStyle}>No examples yet.</div>
						)}
					</div>
				</Panel>

				<Panel title={selectedCase?.name || selectedCase?.id || "Example"}>
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
						<div style={emptyBoxStyle}>Select an example to edit.</div>
					)}
				</Panel>
			</div>
		</div>
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
					label="Example ID"
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
					Duplicate example
				</Btn>
				<Btn size="sm" variant="danger" onClick={onDelete}>
					Delete example
				</Btn>
			</div>
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

function ReadonlyField({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<SectionLabel>{label}</SectionLabel>
			<div style={readonlyFieldStyle}>
				<Mono size={11.5}>{value}</Mono>
			</div>
		</div>
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

interface VersionOption {
	value: string;
	label: string;
	short?: string;
	resolvedVersion?: string;
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
	display: "flex",
	flexDirection: "column",
	minHeight: 0,
	flex: 1,
};

const mainStyle: CSSProperties = {
	minWidth: 0,
	display: "flex",
	flexDirection: "column",
	minHeight: 0,
};

const readonlyFieldStyle: CSSProperties = {
	display: "block",
	width: "100%",
	marginTop: 5,
	border: `1px solid ${ag.line}`,
	borderRadius: 4,
	padding: "8px 10px",
	background: ag.surface,
	boxSizing: "border-box",
	color: ag.text2,
	minHeight: 38,
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

const splitTabStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "280px minmax(0, 1fr)",
	gap: 14,
	alignItems: "start",
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

const caseRowStyle: CSSProperties = {
	border: `1px solid ${ag.line2}`,
	borderRadius: 5,
	padding: 9,
	display: "flex",
	textAlign: "left",
	fontFamily: "inherit",
	cursor: "pointer",
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
