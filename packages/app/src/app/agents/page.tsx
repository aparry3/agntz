"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { I } from "@/components/v3/icons";
import { Btn, Crumbs, Mono, Tag, ag } from "@/components/v3/primitives";

interface AgentRow {
  id: string;
  name: string;
  description?: string;
  kind?: string;
  model?: string;
  updatedAt?: string;
}

type KindFilter = "all" | "llm" | "pipeline" | "scheduled";

const KIND_TABS: Array<{ key: KindFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "llm", label: "LLM" },
  { key: "pipeline", label: "Pipeline" },
  { key: "scheduled", label: "Scheduled" },
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AgentRow | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const loadAgents = () => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then(setAgents)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/agents/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    loadAgents();
  };

  // Group by displayed "kind" for tab counts. Anything with a sequential/
  // parallel root counts as a pipeline; everything else falls back to llm.
  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: agents.length, llm: 0, pipeline: 0, scheduled: 0 };
    for (const a of agents) {
      const k = displayKind(a.kind);
      if (k === "llm") c.llm++;
      else if (k === "pipeline") c.pipeline++;
      else if (k === "scheduled") c.scheduled++;
    }
    return c;
  }, [agents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      const k = displayKind(a.kind);
      if (kindFilter !== "all" && kindFilter !== k) return false;
      if (q) {
        return (
          a.id.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (a.description ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [agents, search, kindFilter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Header */}
      <div
        style={{
          padding: "20px 32px 18px",
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.bg,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <Crumbs trail={["agntz", "Agents"]} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-0.015em",
                color: ag.ink,
              }}
            >
              Agents
            </h1>
            <div style={{ marginTop: 5, fontSize: 13, color: ag.text2, maxWidth: 540 }}>
              Create, inspect, and revise agent definitions in this workspace.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn
              variant="secondary"
              icon={<I.Filter size={12} style={{ marginRight: 6 }} />}
            >
              Filter
            </Btn>
            <Link
              href="/agents/new"
              style={{
                background: ag.ink,
                color: ag.surface,
                border: `1px solid ${ag.ink}`,
                borderRadius: 4,
                padding: "6px 11px",
                fontSize: 12.5,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                textDecoration: "none",
              }}
            >
              <I.Plus size={12} />
              New Agent
            </Link>
          </div>
        </div>
      </div>

      {/* Toolbar */}
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
            placeholder="Search agents by name or id…"
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
        <div style={{ display: "flex", gap: 4 }}>
          {KIND_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setKindFilter(tab.key)}
              style={{
                background: kindFilter === tab.key ? ag.surface2 : "transparent",
                border: `1px solid ${kindFilter === tab.key ? ag.line : "transparent"}`,
                color: kindFilter === tab.key ? ag.ink : ag.muted,
                fontSize: 12,
                fontWeight: 500,
                padding: "4px 9px",
                borderRadius: 4,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontFamily: "inherit",
              }}
            >
              {tab.label}
              <Mono size={11} color={ag.muted}>
                {counts[tab.key]}
              </Mono>
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <Mono size={11} color={ag.muted}>
          sort: updated ↓
        </Mono>
      </div>

      {/* Table or empty state */}
      <div style={{ padding: "16px 32px 32px", flex: 1, overflow: "auto" }}>
        {loading ? (
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
            Loading agents…
          </div>
        ) : agents.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div
            style={{
              background: ag.surface2,
              border: `1px solid ${ag.line}`,
              borderRadius: 5,
              padding: "40px 24px",
              textAlign: "center",
              color: ag.muted,
              fontSize: 13,
            }}
          >
            No agents match the current filter.
          </div>
        ) : (
          <AgentsTable rows={filtered} onDelete={(agent) => setDeleteTarget(agent)} />
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Agent"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? deleteTarget?.id}"? All versions will be permanently removed.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

const COLUMNS = "minmax(260px,1.6fr) 110px 180px 80px 80px 110px 40px";

function AgentsTable({ rows, onDelete }: { rows: AgentRow[]; onDelete: (a: AgentRow) => void }) {
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
        <div>Agent</div>
        <div>Kind</div>
        <div>Model</div>
        <div style={{ textAlign: "right" }}>Runs</div>
        <div>Status</div>
        <div>Updated</div>
        <div />
      </div>
      {rows.map((row, i) => (
        <AgentRowItem key={row.id} row={row} isLast={i === rows.length - 1} onDelete={onDelete} />
      ))}
    </div>
  );
}

function AgentRowItem({
  row,
  isLast,
  onDelete,
}: {
  row: AgentRow;
  isLast: boolean;
  onDelete: (a: AgentRow) => void;
}) {
  const kind = displayKind(row.kind);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Link
      href={`/agents/${row.id}`}
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
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <KindAvatar kind={kind} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, color: ag.ink }}>{row.name}</div>
          <Mono color={ag.muted} size={11}>
            {row.id}
          </Mono>
        </div>
      </div>
      <div>
        <KindChip kind={kind} />
      </div>
      <Mono size={12}>{row.model ?? "—"}</Mono>
      <Mono size={12} color={ag.text2} style={{ textAlign: "right", display: "block" }}>
        —
      </Mono>
      <div>
        <Tag bg={ag.okBg} color={ag.ok}>
          <I.Dot size={6} color={ag.ok} />
          Ready
        </Tag>
      </div>
      <Mono size={11} color={ag.muted}>
        {formatRelative(row.updatedAt)}
      </Mono>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        onBlur={() => setTimeout(() => setMenuOpen(false), 120)}
        style={{
          justifySelf: "end",
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: 3,
          color: ag.muted,
          padding: "3px 4px",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
        aria-label="Row actions"
      >
        <I.Ellipsis size={14} />
        {menuOpen && (
          <span
            style={{
              position: "absolute",
              right: 24,
              top: 28,
              background: ag.surface2,
              border: `1px solid ${ag.line}`,
              borderRadius: 4,
              padding: 4,
              minWidth: 140,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              zIndex: 10,
              boxShadow: "0 4px 12px rgba(26,25,22,0.08)",
              textAlign: "left",
            }}
          >
            <span
              style={menuItemStyle}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(row);
                setMenuOpen(false);
              }}
            >
              Delete agent
            </span>
          </span>
        )}
      </button>
    </Link>
  );
}

const menuItemStyle = {
  padding: "5px 8px",
  borderRadius: 3,
  fontSize: 12,
  color: ag.ink,
  cursor: "pointer",
  display: "block",
} satisfies React.CSSProperties;

function KindAvatar({ kind }: { kind: "llm" | "pipeline" | "scheduled" }) {
  const palette = {
    llm: { bg: ag.blueBg, fg: ag.blue, Icon: I.Sparkle, iconSize: 11 },
    pipeline: { bg: ag.purpleBg, fg: ag.purple, Icon: I.Box, iconSize: 12 },
    scheduled: { bg: ag.warnBg, fg: ag.warn, Icon: I.Hist, iconSize: 12 },
  }[kind];
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        flex: "0 0 auto",
        background: palette.bg,
        color: palette.fg,
        display: "grid",
        placeItems: "center",
      }}
    >
      <palette.Icon size={palette.iconSize} />
    </div>
  );
}

function KindChip({ kind }: { kind: "llm" | "pipeline" | "scheduled" }) {
  const m = {
    llm: { bg: ag.blueBg, fg: ag.blue, label: "LLM" },
    pipeline: { bg: ag.purpleBg, fg: ag.purple, label: "Pipeline" },
    scheduled: { bg: ag.warnBg, fg: ag.warn, label: "Scheduled" },
  }[kind];
  return (
    <Tag bg={m.bg} color={m.fg} mono>
      {m.label}
    </Tag>
  );
}

function displayKind(rawKind?: string): "llm" | "pipeline" | "scheduled" {
  if (rawKind === "sequential" || rawKind === "parallel" || rawKind === "pipeline") return "pipeline";
  if (rawKind === "scheduled") return "scheduled";
  return "llm";
}

function formatRelative(timestamp?: string): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const now = Date.now();
  const diff = Math.max(0, now - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
        <I.Agents size={20} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: ag.ink, marginBottom: 4 }}>No agents yet</div>
      <div style={{ fontSize: 12.5, color: ag.muted, marginBottom: 16 }}>
        Create your first agent to get started.
      </div>
      <Link
        href="/agents/new"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: ag.ink,
          color: ag.surface,
          padding: "8px 14px",
          borderRadius: 4,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: "none",
        }}
      >
        <I.Plus size={12} />
        Create your first agent
      </Link>
    </div>
  );
}
