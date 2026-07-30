"use client";

import { importDatasetFile } from "@/components/batches/dataset-import";
import { I } from "@/components/v3/icons";
import { Btn, Crumbs, Label, Mono, ag } from "@/components/v3/primitives";
import { YamlEditor } from "@/components/yaml-editor";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parse, stringify } from "yaml";

interface Dataset {
	id: string;
	name: string;
	itemCount?: number;
	items?: unknown[];
}

const INITIAL_MANIFEST = `id: customer-summaries
name: Customer summaries
description: Summarize each customer record for an operations review.
kind: llm
model:
  provider: openai
  name: gpt-5.4-mini
  temperature: 0.2
  maxTokens: 800
instruction: |
  You are a careful operations analyst.
  Summarize the record, call out risks, and recommend the next action.
prompt: |
  Customer record:
  {{input}}
`;

export default function NewBatchPage() {
	const router = useRouter();
	const [manifest, setManifest] = useState(INITIAL_MANIFEST);
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [datasetId, setDatasetId] = useState("");
	const [saving, setSaving] = useState<"save" | "run" | null>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		fetch("/api/datasets")
			.then((response) => response.json())
			.then((rows) => setDatasets(Array.isArray(rows) ? rows : []));
	}, []);

	const chooseDataset = (id: string) => {
		setDatasetId(id);
		try {
			const value = parse(manifest) as Record<string, unknown>;
			if (id) value.defaultDataset = { id };
			else delete value.defaultDataset;
			setManifest(stringify(value, { lineWidth: 0 }));
		} catch {
			// Keep the editor text intact; save will surface the YAML error.
		}
	};

	const save = async (runAfter: boolean) => {
		setSaving(runAfter ? "run" : "save");
		setError("");
		try {
			const response = await fetch("/api/batches", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ manifest }),
			});
			const batch = await response.json();
			if (!response.ok)
				throw new Error(batch.error ?? "Could not create batch");
			if (runAfter) {
				const runResponse = await fetch("/api/batch-runs", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						batchId: batch.id,
						datasetId: datasetId || undefined,
					}),
				});
				const run = await runResponse.json();
				if (!runResponse.ok) {
					throw new Error(run.error ?? "Batch was saved, but the run failed");
				}
			}
			router.push(`/batches/${encodeURIComponent(batch.id)}`);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSaving(null);
		}
	};

	const upload = async (file: File) => {
		setUploading(true);
		setError("");
		try {
			const imported = await importDatasetFile(file);
			setDatasets((current) => [
				...current,
				{ id: imported.id, name: imported.name, itemCount: imported.itemCount },
			]);
			chooseDataset(imported.id);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setUploading(false);
		}
	};

	return (
		<div
			style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
		>
			<header style={headerStyle}>
				<Crumbs
					trail={[
						"agntz",
						<Link key="batches" href="/batches" style={crumbLinkStyle}>
							Batches
						</Link>,
						"New batch",
					]}
				/>
				<div style={headerRowStyle}>
					<div>
						<h1 style={titleStyle}>New batch manifest</h1>
						<p style={subtitleStyle}>
							Use the standard LLM manifest subset. Tools, skills, resources,
							spawnable agents, and runtime state are intentionally unavailable.
						</p>
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<Btn
							variant="secondary"
							disabled={saving !== null}
							onClick={() => void save(false)}
						>
							{saving === "save" ? "Saving…" : "Save manifest"}
						</Btn>
						<Btn
							icon={<I.Play size={11} />}
							disabled={saving !== null || !datasetId}
							onClick={() => void save(true)}
						>
							{saving === "run" ? "Submitting…" : "Save & run"}
						</Btn>
					</div>
				</div>
			</header>

			{error && <div style={errorStyle}>{error}</div>}

			<div style={workspaceStyle}>
				<section style={editorPanelStyle}>
					<div style={panelHeaderStyle}>
						<div>
							<Label>Batch definition</Label>
							<Mono size={11} color={ag.muted}>
								YAML · kind: llm
							</Mono>
						</div>
					</div>
					<div style={{ flex: 1, minHeight: 520 }}>
						<YamlEditor
							value={manifest}
							onChange={setManifest}
							onSaveShortcut={() => void save(false)}
						/>
					</div>
				</section>

				<aside style={sidePanelStyle}>
					<div>
						<Label>Default dataset</Label>
						<p style={helpStyle}>
							Pin a reusable dataset in the manifest. You can override it for
							any run.
						</p>
						<select
							value={datasetId}
							onChange={(event) => chooseDataset(event.target.value)}
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

					<div style={dividerStyle} />

					<div>
						<Label>Upload a dataset</Label>
						<p style={helpStyle}>
							CSV uses the <Mono size={11}>id</Mono> and{" "}
							<Mono size={11}>input</Mono> columns. JSONL accepts one{" "}
							<Mono size={11}>{"{ id, input }"}</Mono> object per line.
						</p>
						<label style={uploadStyle}>
							<I.Plus size={12} />
							{uploading ? "Importing…" : "Choose CSV or JSONL"}
							<input
								type="file"
								accept=".csv,.jsonl,application/x-ndjson,text/csv"
								disabled={uploading}
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) void upload(file);
								}}
								style={{ display: "none" }}
							/>
						</label>
					</div>

					<div style={dividerStyle} />

					<div>
						<Label>Native providers</Label>
						<div style={providerGridStyle}>
							{["openai", "anthropic", "google", "mistral"].map((provider) => (
								<Mono key={provider} size={11} style={providerChipStyle}>
									{provider}
								</Mono>
							))}
						</div>
						<p style={helpStyle}>
							Request and file limits come from the selected provider. Agntz
							does not impose a smaller total batch cap.
						</p>
					</div>
				</aside>
			</div>
		</div>
	);
}

const headerStyle = {
	padding: "20px 28px 16px",
	borderBottom: `1px solid ${ag.line2}`,
} satisfies React.CSSProperties;
const headerRowStyle = {
	display: "flex",
	alignItems: "flex-end",
	justifyContent: "space-between",
	gap: 20,
	marginTop: 8,
} satisfies React.CSSProperties;
const titleStyle = {
	margin: 0,
	fontSize: 22,
	fontWeight: 600,
	letterSpacing: "-0.015em",
} satisfies React.CSSProperties;
const subtitleStyle = {
	margin: "5px 0 0",
	maxWidth: 720,
	fontSize: 12.5,
	lineHeight: 1.5,
	color: ag.text2,
} satisfies React.CSSProperties;
const crumbLinkStyle = {
	color: "inherit",
	textDecoration: "none",
} satisfies React.CSSProperties;
const errorStyle = {
	padding: "9px 28px",
	background: "var(--ag-danger-bg, #fff0ef)",
	color: ag.danger,
	borderBottom: `1px solid ${ag.line}`,
	fontSize: 12,
} satisfies React.CSSProperties;
const workspaceStyle = {
	display: "grid",
	gridTemplateColumns: "minmax(0, 1fr) 330px",
	flex: 1,
	minHeight: 0,
} satisfies React.CSSProperties;
const editorPanelStyle = {
	minWidth: 0,
	display: "flex",
	flexDirection: "column",
	borderRight: `1px solid ${ag.line}`,
	background: ag.surface2,
} satisfies React.CSSProperties;
const panelHeaderStyle = {
	padding: "11px 16px",
	borderBottom: `1px solid ${ag.line}`,
	background: ag.surface,
	display: "flex",
	justifyContent: "space-between",
} satisfies React.CSSProperties;
const sidePanelStyle = {
	padding: 18,
	display: "flex",
	flexDirection: "column",
	gap: 18,
	background: ag.surface,
} satisfies React.CSSProperties;
const helpStyle = {
	margin: "7px 0 10px",
	color: ag.text2,
	fontSize: 12,
	lineHeight: 1.55,
} satisfies React.CSSProperties;
const controlStyle = {
	width: "100%",
	padding: "7px 8px",
	border: `1px solid ${ag.line}`,
	borderRadius: 4,
	background: ag.surface2,
	color: ag.ink,
	fontFamily: "inherit",
	fontSize: 12,
} satisfies React.CSSProperties;
const dividerStyle = {
	height: 1,
	background: ag.line2,
} satisfies React.CSSProperties;
const uploadStyle = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: 6,
	padding: "9px",
	border: `1px dashed ${ag.line}`,
	borderRadius: 4,
	background: ag.surface2,
	color: ag.ink,
	fontSize: 12,
	cursor: "pointer",
} satisfies React.CSSProperties;
const providerGridStyle = {
	display: "grid",
	gridTemplateColumns: "1fr 1fr",
	gap: 6,
	marginTop: 9,
} satisfies React.CSSProperties;
const providerChipStyle = {
	padding: "6px 8px",
	border: `1px solid ${ag.line}`,
	borderRadius: 4,
	background: ag.surface2,
} satisfies React.CSSProperties;
