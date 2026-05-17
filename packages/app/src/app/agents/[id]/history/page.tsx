// Agent version history.
// Two view modes: "diff" (selected → current) and "snapshot" (read-only YAML
// with kind-aware summary cards). The versions rail manages selection and
// exposes copy-ref / alias-management affordances so SDK callers can pin a
// version from code.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { parse as parseYAML } from "yaml";
import { I } from "@/components/v3/icons";
import { Avatar, Btn, Crumbs, Label, Mono, Tag, ag } from "@/components/v3/primitives";
import { diffLines, diffStat, type DiffLine } from "@/components/v3/history/yaml-diff";
import { snapshotCards } from "@/components/v3/history/snapshot-cards";
import { dayBucket, formatAbsolute, relativeWhen, formatMonthDay } from "@/components/v3/history/format";

interface VersionSummary {
  createdAt: string;
  activatedAt: string | null;
  aliases: string[];
}

type ViewMode = "diff" | "snapshot";

// Diff palette — softer than the primitives' red/green so YAML stays readable.
const H = {
  addBg: "#E7F1E5",
  addGutter: "#CFE2CB",
  addText: "#1F5A2E",
  remBg: "#F6E2DC",
  remGutter: "#E8C9BF",
  remText: "#7E2A1C",
  hunkBg: "#EEEAD9",
  lineNum: "#A9A698",
} as const;

export default function AgentHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentManifest, setCurrentManifest] = useState<string>("");
  const [selectedManifest, setSelectedManifest] = useState<string>("");
  const [agentName, setAgentName] = useState<string>(id);
  const [view, setView] = useState<ViewMode>("diff");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"restore" | "duplicate" | "alias" | null>(null);
  const [filter, setFilter] = useState<"all" | "aliased">("all");
  const [search, setSearch] = useState("");

  // Initial load: agent (for current YAML + name) + versions list.
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentRes, versionsRes] = await Promise.all([
        fetch(`/api/agents/${encodeURIComponent(id)}`),
        fetch(`/api/agents/${encodeURIComponent(id)}/versions`),
      ]);
      if (!agentRes.ok) throw new Error(`Failed to load agent (HTTP ${agentRes.status})`);
      if (!versionsRes.ok) throw new Error(`Failed to load versions (HTTP ${versionsRes.status})`);
      const agent = await agentRes.json();
      const list = await versionsRes.json();
      const versionList = (Array.isArray(list) ? list : list.versions ?? []) as VersionSummary[];

      setAgentName(typeof agent?.name === "string" ? agent.name : id);
      const manifest = (agent?.metadata?.manifest as string | undefined) ?? "";
      setCurrentManifest(manifest);
      setVersions(versionList);

      // Pick a default selection: prefer an older version with an alias, else
      // the most recent non-current version, else the current one. This makes
      // the diff actually show something on load.
      if (versionList.length > 0) {
        const aliased = versionList.find((v, i) => i > 0 && v.aliases.length > 0);
        const older = versionList[1];
        setSelectedId((prev) => prev ?? aliased?.createdAt ?? older?.createdAt ?? versionList[0].createdAt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  // Fetch the YAML for the selected version whenever the selection changes.
  useEffect(() => {
    if (!selectedId) {
      setSelectedManifest("");
      return;
    }
    let cancelled = false;
    fetch(`/api/agents/${encodeURIComponent(id)}/versions/${encodeURIComponent(selectedId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((agent) => {
        if (cancelled) return;
        setSelectedManifest((agent?.metadata?.manifest as string | undefined) ?? "");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [id, selectedId]);

  const selectedVersion = useMemo(
    () => versions.find((v) => v.createdAt === selectedId) ?? null,
    [versions, selectedId],
  );
  const currentVersion = versions[0] ?? null;
  const isSelectedCurrent = selectedVersion !== null && selectedVersion.createdAt === currentVersion?.createdAt;

  const diff: DiffLine[] = useMemo(() => {
    if (!selectedManifest || !currentManifest) return [];
    return diffLines(selectedManifest, currentManifest);
  }, [selectedManifest, currentManifest]);
  const stat = useMemo(() => diffStat(diff), [diff]);

  const parsedSelected = useMemo(() => {
    if (!selectedManifest.trim()) return null;
    try {
      const v = parseYAML(selectedManifest);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }, [selectedManifest]);
  const cards = useMemo(() => snapshotCards(parsedSelected), [parsedSelected]);
  const isPipelineKind = parsedSelected?.kind === "sequential" || parsedSelected?.kind === "parallel";

  // Restore = activate the selected version (server already exposes activate).
  const handleRestore = async () => {
    if (!selectedVersion || isSelectedCurrent) return;
    setPendingAction("restore");
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(id)}/versions/${encodeURIComponent(selectedVersion.createdAt)}/activate`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push(`/agents/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  };

  // Duplicate = bring the user back to the editor with the selected YAML
  // pre-filled, where they can save it as a fresh agent.
  const handleDuplicate = () => {
    if (!selectedManifest) return;
    try { sessionStorage.setItem("agntz.duplicateManifest", selectedManifest); } catch { /* ignore */ }
    router.push(`/agents/new?from=duplicate`);
  };

  const handleAddAlias = async (alias: string) => {
    if (!selectedVersion) return;
    setPendingAction("alias");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}/aliases/${encodeURIComponent(alias)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createdAt: selectedVersion.createdAt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  };

  const handleRemoveAlias = async (alias: string) => {
    setPendingAction("alias");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}/aliases/${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  };

  const filteredVersions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return versions.filter((v) => {
      if (filter === "aliased" && v.aliases.length === 0) return false;
      if (!term) return true;
      if (v.createdAt.toLowerCase().includes(term)) return true;
      if (v.aliases.some((a) => a.toLowerCase().includes(term))) return true;
      return false;
    });
  }, [versions, filter, search]);

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: ag.muted, fontSize: 13 }}>
        Loading version history…
      </div>
    );
  }

  if (error && versions.length === 0) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: ag.danger, fontSize: 13 }}>
        {error}
      </div>
    );
  }

  const oldest = versions.length > 0 ? versions[versions.length - 1].createdAt : null;
  const restoreLabel = selectedVersion?.aliases[0]
    ? `Restore @${selectedVersion.aliases[0]}`
    : selectedVersion
      ? "Restore this version"
      : "Restore";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 0 }}>
      <HistoryHeader
        agentName={agentName}
        agentId={id}
        kindTag={
          <Tag bg={isPipelineKind ? ag.purpleBg : ag.blueBg} color={isPipelineKind ? ag.purple : ag.blue} mono>
            {isPipelineKind ? String(parsedSelected?.kind ?? "Pipeline") : "LLM"}
          </Tag>
        }
        versionsCount={versions.length}
        oldestDate={oldest ? formatMonthDay(new Date(oldest).getTime()) : "—"}
        view={view}
        onChangeView={setView}
        actions={
          <>
            <Btn
              variant="secondary"
              icon={<I.X size={11} style={{ marginRight: 6 }} />}
              onClick={() => router.push(`/agents/${encodeURIComponent(id)}`)}
            >
              Close
            </Btn>
            <Btn
              variant="secondary"
              icon={<I.Copy size={11} style={{ marginRight: 6 }} />}
              onClick={handleDuplicate}
              disabled={!selectedManifest || pendingAction !== null}
            >
              Duplicate as new
            </Btn>
            <Btn
              variant="primary"
              icon={<I.Hist size={11} style={{ marginRight: 6 }} />}
              onClick={handleRestore}
              disabled={!selectedVersion || isSelectedCurrent || pendingAction !== null}
              title={isSelectedCurrent ? "This is already the current version" : undefined}
            >
              {pendingAction === "restore" ? "Restoring…" : restoreLabel}
            </Btn>
          </>
        }
      />

      {error && (
        <div
          style={{
            padding: "8px 28px", background: "#FBEFEA", borderBottom: `1px solid ${ag.line2}`,
            color: ag.danger, fontSize: 12, display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <I.X size={11} />
          {error}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <VersionsRail
          versions={filteredVersions}
          totalCount={versions.length}
          agentId={id}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filter={filter}
          onChangeFilter={setFilter}
          search={search}
          onChangeSearch={setSearch}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: ag.bg }}>
          {selectedVersion && (
            <SelectedVersionMeta
              entry={selectedVersion}
              agentId={id}
              isCurrent={isSelectedCurrent}
              diffStat={view === "diff" ? stat : null}
              onAddAlias={handleAddAlias}
              onRemoveAlias={handleRemoveAlias}
              pending={pendingAction === "alias"}
            />
          )}

          <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 24px" }}>
            {view === "diff" ? (
              isSelectedCurrent ? (
                <EmptyDiff />
              ) : (
                <DiffPanel
                  lines={diff}
                  label={
                    <>
                      <Mono size={11.5} color={ag.text2}>manifest.yaml</Mono>
                      <Mono size={10.5} color={ag.muted}>
                        {selectedVersion?.aliases[0]
                          ? `@${selectedVersion.aliases[0]} → current`
                          : `${shortId(selectedId)} → current`}
                      </Mono>
                    </>
                  }
                />
              )
            ) : (
              <>
                {cards.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${cards.length}, 1fr)`,
                      gap: 10,
                      marginBottom: 16,
                    }}
                  >
                    {cards.map((c) => <SnapCardView key={c.label} card={c} />)}
                  </div>
                )}
                <YamlPanel
                  text={selectedManifest}
                  label={
                    <>
                      <Mono size={11.5} color={ag.text2}>manifest.yaml</Mono>
                      <Mono size={10.5} color={ag.muted}>
                        @{selectedVersion?.aliases[0] ?? selectedId}
                      </Mono>
                      <Tag bg={ag.line2} color={ag.muted} mono>read-only</Tag>
                      <div style={{ flex: 1 }} />
                      <CopyButton text={selectedManifest} label="Copy YAML" />
                    </>
                  }
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────────────────

function HistoryHeader({
  agentName, agentId, kindTag, versionsCount, oldestDate, view, onChangeView, actions,
}: {
  agentName: string;
  agentId: string;
  kindTag: React.ReactNode;
  versionsCount: number;
  oldestDate: string;
  view: ViewMode;
  onChangeView: (v: ViewMode) => void;
  actions: React.ReactNode;
}) {
  return (
    <div style={{ padding: "16px 28px 14px", borderBottom: `1px solid ${ag.line2}`, background: ag.bg }}>
      <div style={{ marginBottom: 8 }}>
        <Crumbs trail={["agntz", "Agents", agentName, "History"]} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", whiteSpace: "nowrap" }}>
            Version history
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              border: `1px solid ${ag.line}`, borderRadius: 4, padding: "3px 8px", background: ag.surface2,
            }}>
              <Mono size={11.5}>{agentId}</Mono>
              <I.Copy size={11} style={{ color: ag.muted }} />
            </div>
            {kindTag}
            <Mono size={11} color={ag.muted}>
              {versionsCount} version{versionsCount === 1 ? "" : "s"} · oldest {oldestDate}
            </Mono>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" }}>{actions}</div>
      </div>

      <div style={{ marginTop: 14, marginBottom: -14, display: "flex", alignItems: "center", gap: 12 }}>
        <Label>View</Label>
        <div style={{
          display: "flex", padding: 2, background: ag.surface2,
          border: `1px solid ${ag.line}`, borderRadius: 4,
        }}>
          {(
            [
              { label: "Diff", Ic: I.Code, mode: "diff" as const },
              { label: "Snapshot", Ic: I.Eye, mode: "snapshot" as const },
            ]
          ).map(({ label, Ic, mode }) => {
            const on = view === mode;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChangeView(mode)}
                style={{
                  padding: "5px 11px", borderRadius: 3, fontSize: 12,
                  background: on ? ag.bg : "transparent",
                  color: on ? ag.ink : ag.text2, border: "none", cursor: "pointer", fontWeight: 500,
                  display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit",
                }}
              >
                <Ic size={11} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Versions rail
// ──────────────────────────────────────────────────────────────────────────

function VersionsRail({
  versions, totalCount, agentId, selectedId, onSelect, filter, onChangeFilter, search, onChangeSearch,
}: {
  versions: VersionSummary[];
  totalCount: number;
  agentId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: "all" | "aliased";
  onChangeFilter: (f: "all" | "aliased") => void;
  search: string;
  onChangeSearch: (s: string) => void;
}) {
  const groups: Array<{ label: string; rows: VersionSummary[] }> = useMemo(() => {
    const today: VersionSummary[] = [];
    const yesterday: VersionSummary[] = [];
    const earlier: VersionSummary[] = [];
    for (const v of versions) {
      const b = dayBucket(v.createdAt);
      if (b === "today") today.push(v);
      else if (b === "yesterday") yesterday.push(v);
      else earlier.push(v);
    }
    const out: Array<{ label: string; rows: VersionSummary[] }> = [];
    if (today.length) out.push({ label: "Today", rows: today });
    if (yesterday.length) out.push({ label: "Yesterday", rows: yesterday });
    if (earlier.length) out.push({ label: "Earlier", rows: earlier });
    return out;
  }, [versions]);

  const aliasedCount = versions.filter((v) => v.aliases.length > 0).length;

  return (
    <aside style={{
      width: 320, background: ag.surface, borderRight: `1px solid ${ag.line2}`,
      display: "flex", flexDirection: "column", flex: "0 0 auto", minHeight: 0,
    }}>
      <div style={{
        padding: "11px 14px", borderBottom: `1px solid ${ag.line2}`,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 7, flex: 1,
          padding: "4px 9px", border: `1px solid ${ag.line}`,
          background: ag.surface2, borderRadius: 4,
        }}>
          <I.Search size={11} style={{ color: ag.muted }} />
          <input
            value={search}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Filter by alias or timestamp…"
            style={{
              border: "none", outline: "none", background: "transparent",
              fontFamily: "inherit", fontSize: 11.5, color: ag.ink, width: "100%",
            }}
          />
        </div>
      </div>

      <div style={{
        padding: "8px 14px", display: "flex", flexWrap: "wrap", gap: 4,
        borderBottom: `1px solid ${ag.line2}`,
      }}>
        <FilterPill on={filter === "all"} onClick={() => onChangeFilter("all")}>
          All <Mono color={ag.muted} size={10.5} style={{ marginLeft: 4 }}>{totalCount}</Mono>
        </FilterPill>
        <FilterPill on={filter === "aliased"} onClick={() => onChangeFilter("aliased")}>
          Aliased <Mono color={ag.muted} size={10.5} style={{ marginLeft: 4 }}>{aliasedCount}</Mono>
        </FilterPill>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {groups.length === 0 && (
          <div style={{ padding: 18, color: ag.muted, fontSize: 12 }}>No versions match.</div>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <DayLabel>{g.label}</DayLabel>
            {g.rows.map((row) => (
              <VersionRow
                key={row.createdAt}
                entry={row}
                agentId={agentId}
                selected={row.createdAt === selectedId}
                onSelect={() => onSelect(row.createdAt)}
              />
            ))}
          </div>
        ))}
      </div>

      <div style={{
        padding: "8px 14px", borderTop: `1px solid ${ag.line}`, background: ag.bg,
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 10.5, color: ag.muted, fontFamily: "var(--font-mono)",
      }}>
        <I.Sparkle size={10} />
        Aliased versions kept indefinitely. Others age out after 90 days.
      </div>
    </aside>
  );
}

function FilterPill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "3px 8px", border: "1px solid transparent", borderRadius: 3,
        background: on ? ag.surface2 : "transparent",
        color: on ? ag.ink : ag.muted,
        fontFamily: "inherit", fontSize: 12, cursor: "pointer", fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}

function DayLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "8px 14px 4px", fontSize: 9.5, letterSpacing: "0.1em",
      textTransform: "uppercase", color: ag.muted, fontWeight: 500,
      background: ag.bg, borderTop: `1px solid ${ag.line2}`,
    }}>
      {children}
    </div>
  );
}

function VersionRow({
  entry, agentId, selected, onSelect,
}: {
  entry: VersionSummary;
  agentId: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const isCurrent = entry.activatedAt !== null;
  const primaryAlias = entry.aliases[0];
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "10px 14px 10px 12px", cursor: "pointer",
        borderLeft: `2px solid ${selected ? ag.ink : "transparent"}`,
        background: selected ? "#FAF7EF" : "transparent",
        borderBottom: `1px solid ${ag.line2}`,
        display: "flex", gap: 10, alignItems: "flex-start",
      }}
    >
      <Avatar name={agentId} size={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <Mono size={11.5} color={ag.ink} style={{ fontWeight: 500 }}>{relativeWhen(entry.createdAt)}</Mono>
          {isCurrent && (
            <Tag bg={ag.okBg} color={ag.ok}>
              <I.Dot size={5} color={ag.ok} />current
            </Tag>
          )}
          <div style={{ flex: 1 }} />
          <CopyButton
            compact
            text={primaryAlias ? `${agentId}@${primaryAlias}` : `${agentId}@${entry.createdAt}`}
            title={`Copy reference · ${primaryAlias ? `@${primaryAlias}` : entry.createdAt}`}
          />
        </div>
        {entry.aliases.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {entry.aliases.map((a) => (
              <AliasChip key={a} agentId={agentId} alias={a} />
            ))}
          </div>
        )}
        <Mono size={10} color={ag.muted} style={{
          marginTop: entry.aliases.length > 0 ? 4 : 2, display: "block",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{entry.createdAt}</Mono>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Selected version meta panel — identity + references + alias management
// ──────────────────────────────────────────────────────────────────────────

function SelectedVersionMeta({
  entry, agentId, isCurrent, diffStat, onAddAlias, onRemoveAlias, pending,
}: {
  entry: VersionSummary;
  agentId: string;
  isCurrent: boolean;
  diffStat: { add: number; rem: number } | null;
  onAddAlias: (alias: string) => void;
  onRemoveAlias: (alias: string) => void;
  pending: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [aliasInput, setAliasInput] = useState("");
  const timestampRef = `${agentId}@${entry.createdAt}`;

  const submitAlias = () => {
    const trimmed = aliasInput.trim();
    if (!trimmed) return;
    onAddAlias(trimmed);
    setAliasInput("");
    setShowAdd(false);
  };

  return (
    <div style={{ borderBottom: `1px solid ${ag.line2}`, background: ag.surface }}>
      <div style={{ padding: "12px 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar name={agentId} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>
              {isCurrent ? "Current version" : "Saved version"}
            </span>
            {isCurrent && (
              <Tag bg={ag.okBg} color={ag.ok}>
                <I.Dot size={5} color={ag.ok} />current
              </Tag>
            )}
            <Mono size={11} color={ag.muted}>{formatAbsolute(entry.createdAt)}</Mono>
          </div>
        </div>
        {diffStat && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            <Mono size={11} color={ag.muted}>diff vs current</Mono>
            <Tag bg={H.addBg} color={H.addText} mono>+{diffStat.add}</Tag>
            <Tag bg={H.remBg} color={H.remText} mono>−{diffStat.rem}</Tag>
          </div>
        )}
      </div>

      <div style={{
        padding: "10px 24px 12px", borderTop: `1px solid ${ag.line2}`,
        background: ag.bg,
        display: "grid", gridTemplateColumns: "78px 1fr", rowGap: 8, columnGap: 14,
        alignItems: "center",
      }}>
        {isCurrent && (
          <>
            <Label>Latest</Label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <CodeRef>{agentId}</CodeRef>
              <CopyButton text={agentId} label="Copy" />
              <Mono size={10.5} color={ag.muted}>resolves to whatever is current</Mono>
            </div>
          </>
        )}

        <Label>{isCurrent ? "Pinned" : "Reference"}</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <CodeRef>{timestampRef}</CodeRef>
          <CopyButton text={timestampRef} label="Copy" />
          <Mono size={10.5} color={ag.muted}>this exact snapshot</Mono>
        </div>

        <Label>Aliases</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {entry.aliases.length === 0 && !showAdd && (
            <Mono size={11} color={ag.muted}>None yet —</Mono>
          )}
          {entry.aliases.map((a) => (
            <AliasChip
              key={a}
              agentId={agentId}
              alias={a}
              removable
              onRemove={() => onRemoveAlias(a)}
            />
          ))}
          {showAdd ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "1px 4px", borderRadius: 3,
              background: ag.surface2, border: `1px solid ${ag.line}`,
            }}>
              <Mono size={11} color={ag.muted}>@</Mono>
              <input
                autoFocus
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitAlias();
                  if (e.key === "Escape") { setShowAdd(false); setAliasInput(""); }
                }}
                placeholder="alias-name"
                style={{
                  border: "none", outline: "none", background: "transparent",
                  fontFamily: "var(--font-mono)", fontSize: 11, color: ag.ink, width: 140,
                }}
              />
              <button
                type="button"
                onClick={submitAlias}
                disabled={pending || aliasInput.trim().length === 0}
                style={{
                  padding: "1px 6px", border: 0, background: "transparent",
                  borderRadius: 2, cursor: "pointer",
                  color: ag.ok, fontFamily: "inherit", fontSize: 11,
                }}
              >
                add
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              disabled={pending}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 8px", border: `1px dashed ${ag.line}`, borderRadius: 3,
                background: "transparent", color: ag.text2, cursor: "pointer",
                fontFamily: "var(--font-mono)", fontSize: 11,
              }}
            >
              <I.Plus size={10} /> Add alias
            </button>
          )}
          {entry.aliases.length > 0 && (
            <Mono size={10.5} color={ag.muted} style={{ marginLeft: 4 }}>
              call <span style={{ color: ag.ink }}>{agentId}@{entry.aliases[0]}</span> to run this version
            </Mono>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Diff / YAML / cards
// ──────────────────────────────────────────────────────────────────────────

function EmptyDiff() {
  return (
    <div style={{
      padding: "24px", border: `1px dashed ${ag.line}`, borderRadius: 5,
      background: ag.surface2, color: ag.muted, fontSize: 12,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <I.Eye size={12} />
      This is the current version — pick an older version on the left to see how it differs.
    </div>
  );
}

function DiffPanel({ lines, label }: { lines: DiffLine[]; label?: React.ReactNode }) {
  let leftNo = 0;
  let rightNo = 0;
  return (
    <div style={{
      background: ag.surface2, border: `1px solid ${ag.line}`, borderRadius: 5,
      overflow: "hidden", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6,
    }}>
      {label && (
        <div style={{
          padding: "7px 12px", borderBottom: `1px solid ${ag.line}`,
          background: ag.surface, display: "flex", alignItems: "center", gap: 8,
        }}>
          {label}
        </div>
      )}
      <div>
        {lines.length === 0 && (
          <div style={{ padding: "12px 16px", color: ag.muted, fontSize: 11 }}>No differences.</div>
        )}
        {lines.map(([kind, text], i) => {
          if (kind === "h") {
            return (
              <div key={i} style={{
                background: H.hunkBg, padding: "4px 12px",
                color: ag.text2, fontSize: 11, letterSpacing: "0.01em",
                borderTop: i === 0 ? "none" : `1px solid ${ag.line2}`,
                borderBottom: `1px solid ${ag.line2}`,
              }}>{text}</div>
            );
          }
          if (kind === "-") leftNo++;
          else if (kind === "+") rightNo++;
          else { leftNo++; rightNo++; }
          const shownNo = kind === "+" ? rightNo : leftNo;
          const bg = kind === "+" ? H.addBg : kind === "-" ? H.remBg : "transparent";
          const gutter = kind === "+" ? H.addGutter : kind === "-" ? H.remGutter : "transparent";
          const fg = kind === "+" ? H.addText : kind === "-" ? H.remText : ag.ink;
          return (
            <div key={i} style={{ display: "flex", background: bg }}>
              <div style={{
                width: 40, padding: "0 8px", textAlign: "right",
                color: H.lineNum, fontSize: 10.5,
                borderRight: `1px solid ${ag.line2}`,
                flex: "0 0 auto", userSelect: "none",
              }}>{shownNo}</div>
              <div style={{
                width: 18, textAlign: "center", color: fg, fontWeight: 600,
                background: gutter, flex: "0 0 auto", userSelect: "none",
              }}>{kind === " " ? "" : kind}</div>
              <div style={{
                padding: "0 12px", color: fg, whiteSpace: "pre",
                flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis",
              }}>{text || " "}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YamlPanel({ text, label }: { text: string; label?: React.ReactNode }) {
  const lines = text.split("\n");
  return (
    <div style={{
      background: ag.surface2, border: `1px solid ${ag.line}`, borderRadius: 5,
      overflow: "hidden", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6,
    }}>
      {label && (
        <div style={{
          padding: "7px 12px", borderBottom: `1px solid ${ag.line}`,
          background: ag.surface, display: "flex", alignItems: "center", gap: 8,
        }}>
          {label}
        </div>
      )}
      <div>
        {lines.map((line, i) => (
          <div key={i} style={{ display: "flex" }}>
            <div style={{
              width: 40, padding: "0 8px", textAlign: "right",
              color: H.lineNum, fontSize: 10.5,
              borderRight: `1px solid ${ag.line2}`,
              flex: "0 0 auto", userSelect: "none",
            }}>{i + 1}</div>
            <div style={{
              padding: "0 12px", color: ag.ink, whiteSpace: "pre",
              flex: 1, minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis",
            }}>{line || " "}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SnapCardView({ card }: { card: ReturnType<typeof snapshotCards>[number] }) {
  return (
    <div style={{
      padding: "10px 12px", border: `1px solid ${ag.line}`, borderRadius: 4,
      background: ag.surface2,
    }}>
      <Label>{card.label}</Label>
      <div style={{
        fontSize: 15, fontWeight: 600, color: ag.ink, letterSpacing: "-0.01em",
        marginTop: 4,
        fontFamily: card.mono ? "var(--font-mono)" : "inherit",
      }}>{card.value}</div>
      <Mono size={10.5} color={ag.muted} style={{
        marginTop: 3, display: "block",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{card.sub}</Mono>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Bits: alias chip, code ref pill, copy button, helpers
// ──────────────────────────────────────────────────────────────────────────

function AliasChip({
  agentId, alias, removable, onRemove,
}: {
  agentId: string;
  alias: string;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ref = `${agentId}@${alias}`;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 4px 2px 7px", borderRadius: 3,
      background: ag.surface2, border: `1px solid ${ag.line}`,
      fontFamily: "var(--font-mono)", fontSize: 11, color: ag.ink,
    }}>
      <span style={{ color: ag.muted, marginRight: 1 }}>@</span>{alias}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          try { navigator.clipboard?.writeText(ref); } catch { /* ignore */ }
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        title={`Copy ${ref}`}
        style={{
          padding: "1px 3px", border: 0, background: "transparent",
          borderRadius: 2, cursor: "pointer",
          color: copied ? ag.ok : ag.muted,
          display: "inline-flex", alignItems: "center",
        }}
      >
        {copied ? <I.Check size={9} /> : <I.Copy size={9} />}
      </button>
      {removable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          title="Remove alias"
          style={{
            padding: "1px 3px", border: 0, background: "transparent",
            borderRadius: 2, cursor: "pointer", color: ag.muted,
            display: "inline-flex", alignItems: "center",
          }}
        >
          <I.X size={9} />
        </button>
      )}
    </span>
  );
}

function CodeRef({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: "var(--font-mono)", fontSize: 12, color: ag.ink,
      padding: "3px 8px", background: ag.surface2,
      border: `1px solid ${ag.line}`, borderRadius: 3,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      maxWidth: 540, display: "inline-block",
    }}>{children}</span>
  );
}

function CopyButton({
  text, compact, label, title,
}: {
  text: string;
  compact?: boolean;
  label?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { navigator.clipboard?.writeText(text); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? `Copy ${text}`}
        style={{
          padding: "3px 5px", border: `1px solid ${ag.line}`, background: ag.surface2,
          borderRadius: 3, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 4,
          color: copied ? ag.ok : ag.text2,
        }}
      >
        {copied ? <I.Check size={10} /> : <I.Copy size={10} />}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `Copy ${text}`}
      style={{
        padding: "4px 9px", border: `1px solid ${ag.line}`, background: ag.surface2,
        borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 12, color: copied ? ag.ok : ag.ink, fontWeight: 500, lineHeight: 1,
      }}
    >
      {copied ? <I.Check size={11} /> : <I.Copy size={11} />}
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}

function shortId(s: string | null): string {
  if (!s) return "—";
  // Keep only the time portion for the header chip — full timestamp shows
  // in the references panel below.
  return s.replace(/\.\d+Z$/, "Z");
}
