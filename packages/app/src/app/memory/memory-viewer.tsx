"use client";

import { I } from "@/components/v3/icons";
import {
	Btn,
	Crumbs,
	Mono,
	Spinner,
	Tag,
	ag,
} from "@/components/v3/primitives";
import type { MemoryEntryWire, MemoryTopicSummary } from "@/lib/worker-client";
import { useCallback, useEffect, useMemo, useState } from "react";

const GRANTS_STORAGE_KEY = "agntz.memory.grants";
const PAGE_SIZE = 100;

/**
 * Memory viewer — the deterministic read surface over memrez. Enter the
 * grants an agent would run with and see exactly what that agent sees:
 * the same normalize→expand authorization path serves both.
 */
export function MemoryViewer() {
	const [grantsInput, setGrantsInput] = useState("");
	const [grants, setGrants] = useState<string[]>([]);
	const [topics, setTopics] = useState<MemoryTopicSummary[]>([]);
	const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
	const [entries, setEntries] = useState<MemoryEntryWire[]>([]);
	const [total, setTotal] = useState(0);
	const [audit, setAudit] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [refreshTick, setRefreshTick] = useState(0);

	useEffect(() => {
		const stored = window.localStorage.getItem(GRANTS_STORAGE_KEY);
		if (stored) {
			setGrantsInput(stored);
			setGrants(parseGrants(stored));
		}
	}, []);

	const load = useCallback(() => {
		const parsed = parseGrants(grantsInput);
		window.localStorage.setItem(GRANTS_STORAGE_KEY, grantsInput);
		setGrants(parsed);
		setSelectedTopic(null);
		setRefreshTick((tick) => tick + 1);
	}, [grantsInput]);

	useEffect(() => {
		if (grants.length === 0) return;
		let cancelled = false;
		setLoading(true);
		setError(null);

		const grantsParam = encodeURIComponent(grants.join(","));
		const entriesParams = new URLSearchParams({
			grants: grants.join(","),
			limit: String(PAGE_SIZE),
		});
		if (selectedTopic) entriesParams.set("topics", selectedTopic);
		if (audit) entriesParams.set("includeSuperseded", "true");

		Promise.all([
			fetchJson<{ topics: MemoryTopicSummary[] }>(
				`/api/memory/topics?grants=${grantsParam}`,
			),
			fetchJson<{ entries: MemoryEntryWire[]; total: number }>(
				`/api/memory/entries?${entriesParams}`,
			),
		])
			.then(([topicsRes, entriesRes]) => {
				if (cancelled) return;
				setTopics(topicsRes.topics);
				setEntries(entriesRes.entries);
				setTotal(entriesRes.total);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : String(err));
				setTopics([]);
				setEntries([]);
				setTotal(0);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [grants, selectedTopic, audit, refreshTick]);

	const loadMore = useCallback(async () => {
		const params = new URLSearchParams({
			grants: grants.join(","),
			limit: String(PAGE_SIZE),
			offset: String(entries.length),
		});
		if (selectedTopic) params.set("topics", selectedTopic);
		if (audit) params.set("includeSuperseded", "true");
		try {
			const page = await fetchJson<{
				entries: MemoryEntryWire[];
				total: number;
			}>(`/api/memory/entries?${params}`);
			setEntries((current) => [...current, ...page.entries]);
			setTotal(page.total);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [grants, entries.length, selectedTopic, audit]);

	const correctEntry = useCallback(
		async (id: string, content: string) => {
			const res = await fetch(
				`/api/memory/entries/${encodeURIComponent(id)}/correct`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ grants, content }),
				},
			);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				throw new Error(body.error ?? `Request failed: ${res.status}`);
			}
			setRefreshTick((tick) => tick + 1);
		},
		[grants],
	);

	const entryById = useMemo(() => {
		const map = new Map<string, MemoryEntryWire>();
		for (const entry of entries) map.set(entry.id, entry);
		return map;
	}, [entries]);

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
					<Crumbs trail={["agntz", "Memory"]} />
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
					Memory
				</h1>
				<div
					style={{ marginTop: 5, fontSize: 13, color: ag.text2, maxWidth: 640 }}
				>
					Inspect durable memory exactly as an agent sees it. Enter the
					namespace grants a run would carry — entries from those scopes and
					their ancestors become visible.
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
						minWidth: 260,
						maxWidth: 480,
					}}
				>
					<I.Key size={12} />
					<input
						value={grantsInput}
						onChange={(e) => setGrantsInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") load();
						}}
						placeholder="Grants, comma-separated — e.g. app/user/u_123"
						style={{
							fontSize: 12,
							flex: 1,
							border: 0,
							outline: 0,
							background: "transparent",
							color: ag.ink,
							fontFamily: "var(--font-mono)",
						}}
					/>
				</div>
				<Btn size="sm" onClick={load} disabled={!grantsInput.trim()}>
					Load
				</Btn>
				<label
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						fontSize: 12,
						color: ag.text2,
						cursor: "pointer",
						userSelect: "none",
					}}
				>
					<input
						type="checkbox"
						checked={audit}
						onChange={(e) => setAudit(e.target.checked)}
					/>
					Audit view (include superseded)
				</label>
				<div style={{ flex: 1 }} />
				<Mono size={11} color={ag.muted}>
					{loading
						? "loading…"
						: grants.length === 0
							? "no grants loaded"
							: `${total} entries · ${topics.length} topics`}
				</Mono>
			</div>

			{error && (
				<div
					style={{
						margin: "14px 32px 0",
						padding: "9px 12px",
						background: ag.warnBg,
						color: ag.warn,
						border: `1px solid ${ag.line}`,
						borderRadius: 4,
						fontSize: 12.5,
					}}
				>
					{error}
				</div>
			)}

			<div style={{ padding: "16px 32px 32px", flex: 1, overflow: "auto" }}>
				{grants.length === 0 ? (
					<EmptyState />
				) : loading && entries.length === 0 ? (
					<CardMessage>
						<Spinner size={14} /> Loading memory…
					</CardMessage>
				) : (
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "230px 1fr",
							gap: 16,
							alignItems: "start",
						}}
					>
						<TopicsPanel
							topics={topics}
							selected={selectedTopic}
							onSelect={setSelectedTopic}
						/>
						<div>
							{entries.length === 0 ? (
								<CardMessage>
									No {audit ? "" : "active "}entries
									{selectedTopic ? ` in topic “${selectedTopic}”` : ""} for
									these grants.
								</CardMessage>
							) : (
								<>
									{entries.map((entry) => (
										<EntryCard
											key={entry.id}
											entry={entry}
											supersededByEntry={
												entry.supersededBy
													? entryById.get(entry.supersededBy)
													: undefined
											}
											onCorrect={correctEntry}
										/>
									))}
									{entries.length < total && (
										<div style={{ textAlign: "center", marginTop: 12 }}>
											<Btn size="sm" variant="secondary" onClick={loadMore}>
												Load more ({entries.length} of {total})
											</Btn>
										</div>
									)}
								</>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function TopicsPanel({
	topics,
	selected,
	onSelect,
}: {
	topics: MemoryTopicSummary[];
	selected: string | null;
	onSelect: (topic: string | null) => void;
}) {
	return (
		<div
			style={{
				background: ag.surface2,
				border: `1px solid ${ag.line}`,
				borderRadius: 5,
				overflow: "hidden",
				position: "sticky",
				top: 16,
			}}
		>
			<div
				style={{
					padding: "9px 12px",
					background: ag.surface,
					borderBottom: `1px solid ${ag.line}`,
					fontSize: 10.5,
					textTransform: "uppercase",
					letterSpacing: "0.08em",
					color: ag.muted,
					fontWeight: 500,
				}}
			>
				Topics
			</div>
			<TopicRow
				label="All topics"
				on={selected === null}
				onClick={() => onSelect(null)}
			/>
			{topics.map((topic) => (
				<TopicRow
					key={topic.topic}
					label={topic.topic}
					count={topic.count}
					blurb={topic.blurb}
					dirty={topic.hasUncuratedWrites}
					on={selected === topic.topic}
					onClick={() => onSelect(topic.topic)}
				/>
			))}
		</div>
	);
}

function TopicRow({
	label,
	count,
	blurb,
	dirty,
	on,
	onClick,
}: {
	label: string;
	count?: number;
	blurb?: string;
	dirty?: boolean;
	on: boolean;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			title={blurb}
			style={{
				display: "block",
				width: "100%",
				textAlign: "left",
				border: 0,
				borderBottom: `1px solid ${ag.line2}`,
				background: on ? ag.surface : "transparent",
				padding: "8px 12px",
				cursor: "pointer",
				fontFamily: "inherit",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<Mono
					size={12}
					color={on ? ag.ink : ag.text2}
					style={{
						fontWeight: on ? 600 : 400,
						flex: 1,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{label}
				</Mono>
				{dirty && (
					<span
						title="Has uncurated writes"
						style={{
							width: 6,
							height: 6,
							borderRadius: 999,
							background: ag.warn,
							flex: "0 0 auto",
						}}
					/>
				)}
				{count !== undefined && (
					<Mono size={10.5} color={ag.muted}>
						{count}
					</Mono>
				)}
			</div>
			{blurb && (
				<div
					style={{
						marginTop: 2,
						fontSize: 11,
						color: ag.muted,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{blurb}
				</div>
			)}
		</button>
	);
}

function EntryCard({
	entry,
	supersededByEntry,
	onCorrect,
}: {
	entry: MemoryEntryWire;
	supersededByEntry?: MemoryEntryWire;
	onCorrect: (id: string, content: string) => Promise<void>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(entry.content);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const superseded = entry.status === "superseded";

	const save = async () => {
		setSaving(true);
		setSaveError(null);
		try {
			await onCorrect(entry.id, draft);
			setEditing(false);
		} catch (err) {
			setSaveError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			style={{
				background: ag.surface2,
				border: `1px solid ${ag.line}`,
				borderRadius: 5,
				padding: "12px 14px",
				marginBottom: 10,
				opacity: superseded ? 0.62 : 1,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					flexWrap: "wrap",
					marginBottom: 8,
				}}
			>
				<TypeChip type={entry.type} />
				{entry.topics.map((topic) => (
					<Tag
						key={topic}
						bg={topic === "core" ? ag.purpleBg : "transparent"}
						color={topic === "core" ? ag.purple : ag.text2}
						mono
					>
						{topic}
					</Tag>
				))}
				{superseded && (
					<Tag bg={ag.line2} color={ag.text2}>
						superseded
					</Tag>
				)}
				<div style={{ flex: 1 }} />
				<Mono size={10.5} color={ag.muted}>
					{formatRelativeIso(entry.updatedAt)}
				</Mono>
				{!superseded && !editing && (
					<Btn
						size="sm"
						variant="ghost"
						title="Correct this entry (supersedes it with a new one)"
						onClick={() => {
							setDraft(entry.content);
							setEditing(true);
						}}
						style={{ padding: "2px 6px" }}
					>
						Edit
					</Btn>
				)}
			</div>

			{editing ? (
				<div>
					<textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						rows={3}
						style={{
							width: "100%",
							boxSizing: "border-box",
							fontSize: 13,
							fontFamily: "inherit",
							color: ag.ink,
							background: ag.surface,
							border: `1px solid ${ag.line}`,
							borderRadius: 4,
							padding: "8px 10px",
							resize: "vertical",
						}}
					/>
					{saveError && (
						<div style={{ marginTop: 6, fontSize: 12, color: ag.danger }}>
							{saveError}
						</div>
					)}
					<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
						<Btn
							size="sm"
							onClick={save}
							disabled={saving || draft.trim() === ""}
						>
							{saving ? "Saving…" : "Save correction"}
						</Btn>
						<Btn
							size="sm"
							variant="ghost"
							onClick={() => setEditing(false)}
							disabled={saving}
						>
							Cancel
						</Btn>
						<Mono size={10.5} color={ag.muted} style={{ alignSelf: "center" }}>
							Saves a replacement entry; the original stays in the audit trail.
						</Mono>
					</div>
				</div>
			) : (
				<div style={{ fontSize: 13.5, color: ag.ink, lineHeight: 1.5 }}>
					{entry.content}
				</div>
			)}

			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					marginTop: 9,
					flexWrap: "wrap",
				}}
			>
				<Mono size={10.5} color={ag.muted}>
					{entry.scope}
				</Mono>
				{entry.source?.agentId && (
					<Mono size={10.5} color={ag.muted}>
						via {entry.source.agentId}
					</Mono>
				)}
				<Mono size={10.5} color={ag.muted}>
					{entry.id}
				</Mono>
				{superseded && entry.supersededBy && (
					<Mono size={10.5} color={ag.warn}>
						→ superseded by{" "}
						{supersededByEntry
							? `“${truncate(supersededByEntry.content, 60)}”`
							: entry.supersededBy}
					</Mono>
				)}
			</div>
		</div>
	);
}

function TypeChip({ type }: { type: MemoryEntryWire["type"] }) {
	const M = {
		fact: { bg: ag.blueBg, fg: ag.blue },
		preference: { bg: ag.okBg, fg: ag.ok },
		event: { bg: ag.warnBg, fg: ag.warn },
		summary: { bg: ag.purpleBg, fg: ag.purple },
	}[type] ?? { bg: ag.line2, fg: ag.text2 };
	return (
		<Tag bg={M.bg} color={M.fg}>
			{type}
		</Tag>
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
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				gap: 8,
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
				<I.Memory size={20} />
			</div>
			<div
				style={{
					fontSize: 15,
					fontWeight: 500,
					color: ag.ink,
					marginBottom: 4,
				}}
			>
				Inspect agent memory
			</div>
			<div
				style={{
					fontSize: 12.5,
					color: ag.muted,
					maxWidth: 420,
					margin: "0 auto",
				}}
			>
				Enter the namespace grants a run carries (the{" "}
				<Mono size={12}>context</Mono> array, e.g.{" "}
				<Mono size={12}>app/user/u_123</Mono>) and load to see the topics and
				entries visible to that run.
			</div>
		</div>
	);
}

function parseGrants(raw: string): string[] {
	return raw
		.split(",")
		.map((grant) => grant.trim())
		.filter((grant) => grant.length > 0);
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Request failed: ${res.status}`);
	}
	return res.json() as Promise<T>;
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
