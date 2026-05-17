"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Run, RunStatus } from "@agntz/core";
import { I } from "@/components/v3/icons";
import { Crumbs, Mono, ag } from "@/components/v3/primitives";
import { RunsList } from "@/components/runs/runs-table";

interface ListResponse {
  rows: Run[];
  cursor?: string;
}

const TIME_RANGES: Array<{ label: string; value: string; hours: number | null }> = [
  { label: "Last 1h",   value: "1",   hours: 1 },
  { label: "Last 24h",  value: "24",  hours: 24 },
  { label: "Last 7d",   value: "168", hours: 24 * 7 },
  { label: "Last 30d",  value: "720", hours: 24 * 30 },
  { label: "All time",  value: "all", hours: null },
];

const STATUSES: Array<{ value: RunStatus | ""; label: string }> = [
  { value: "",          label: "any" },
  { value: "running",   label: "running" },
  { value: "completed", label: "completed" },
  { value: "failed",    label: "failed" },
  { value: "cancelled", label: "cancelled" },
  { value: "pending",   label: "pending" },
];

export default function RunsPage() {
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "">("");
  const [hoursFilter, setHoursFilter] = useState<number | null>(24);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Run[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRuns({ agentFilter, statusFilter, hoursFilter, cursor: undefined })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows);
        setCursor(data.cursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentFilter, statusFilter, hoursFilter]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchRuns({ agentFilter, statusFilter, hoursFilter, cursor });
      setRows((prev) => [...prev, ...data.rows]);
      setCursor(data.cursor);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const agentIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.agentId).filter((a): a is string => Boolean(a)))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        (r.agentId ?? "").toLowerCase().includes(q) ||
        r.input.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const hoursValue = hoursFilter === null ? "all" : String(hoursFilter);
  const rangeLabel = TIME_RANGES.find((r) => r.value === hoursValue)?.label ?? "24h";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <div style={{ padding: "20px 32px 18px", borderBottom: `1px solid ${ag.line2}`, background: ag.bg }}>
        <div style={{ marginBottom: 8 }}>
          <Crumbs trail={["agntz", "Runs"]} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em", color: ag.ink }}>
              Runs
            </h1>
            <div style={{ marginTop: 5, fontSize: 13, color: ag.text2, maxWidth: 600 }}>
              Inspect every agent invocation. Click a row to see the full transcript.
            </div>
          </div>
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
            placeholder="Search input, run id, or agent…"
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
          label="agent"
          value={agentFilter}
          displayValue={agentFilter || "any"}
          onChange={setAgentFilter}
          options={[{ value: "", label: "any" }, ...agentIds.map((id) => ({ value: id, label: id }))]}
        />
        <PillSelect
          label="status"
          value={statusFilter}
          displayValue={statusFilter || "any"}
          onChange={(v) => setStatusFilter(v as RunStatus | "")}
          options={STATUSES}
        />
        <PillSelect
          label="range"
          value={hoursValue}
          displayValue={rangeLabel.replace("Last ", "")}
          onChange={(v) => setHoursFilter(v === "all" ? null : Number(v))}
          options={TIME_RANGES.map((r) => ({ value: r.value, label: r.label }))}
        />
        <div style={{ flex: 1 }} />
        <Mono size={11} color={ag.muted}>
          {loading ? "loading…" : `${filtered.length} runs · sort: started ↓`}
        </Mono>
      </div>

      <div style={{ padding: "16px 32px 32px", flex: 1, overflow: "auto" }}>
        {loading ? (
          <CardMessage>Loading runs…</CardMessage>
        ) : error ? (
          <CardMessage>Failed to load runs: {error}</CardMessage>
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <CardMessage>No runs match the current filter.</CardMessage>
        ) : (
          <>
            <RunsList rows={filtered} />
            {cursor && (
              <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{
                    background: ag.surface2,
                    color: ag.ink,
                    border: `1px solid ${ag.line}`,
                    borderRadius: 4,
                    padding: "6px 14px",
                    fontSize: 12.5,
                    fontWeight: 500,
                    cursor: loadingMore ? "not-allowed" : "pointer",
                    opacity: loadingMore ? 0.5 : 1,
                    fontFamily: "inherit",
                  }}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
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
        <I.Runs size={20} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: ag.ink, marginBottom: 4 }}>No runs yet</div>
      <div style={{ fontSize: 12.5, color: ag.muted, marginBottom: 16 }}>
        Runs appear here when you invoke an agent. Try the playground on any agent to kick one off.
      </div>
      <Link
        href="/agents"
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
        Go to agents
      </Link>
    </div>
  );
}

async function fetchRuns(args: {
  agentFilter: string;
  statusFilter: RunStatus | "";
  hoursFilter: number | null;
  cursor: string | undefined;
}): Promise<ListResponse> {
  const params = new URLSearchParams();
  if (args.agentFilter) params.set("agentId", args.agentFilter);
  if (args.statusFilter) params.set("status", args.statusFilter);
  if (args.hoursFilter !== null) {
    const since = new Date(Date.now() - args.hoursFilter * 3_600_000).toISOString();
    params.set("startedAfter", since);
  }
  if (args.cursor) params.set("cursor", args.cursor);
  params.set("limit", "50");

  const res = await fetch(`/api/runs?${params.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ListResponse;
}
