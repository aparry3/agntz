"use client";

import { useEffect, useState } from "react";
import type { SpanStatus, TraceSummary } from "@agntz/core";
import { TraceTable } from "@/components/traces/trace-table";

interface ListResponse {
  rows: TraceSummary[];
  cursor?: string;
}

const TIME_RANGES = [
  { label: "Last 1h", hours: 1 },
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", hours: 24 * 7 },
  { label: "Last 30d", hours: 24 * 30 },
  { label: "All time", hours: null as number | null },
];

const STATUSES: Array<{ value: SpanStatus | ""; label: string }> = [
  { value: "", label: "Any status" },
  { value: "ok", label: "OK" },
  { value: "error", label: "Error" },
  { value: "cancelled", label: "Cancelled" },
  { value: "running", label: "Running" },
];

export default function TracesPage() {
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<SpanStatus | "">("");
  const [hoursFilter, setHoursFilter] = useState<number | null>(24);
  const [rows, setRows] = useState<TraceSummary[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTraces({ agentFilter, statusFilter, hoursFilter, cursor: undefined })
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
      const data = await fetchTraces({ agentFilter, statusFilter, hoursFilter, cursor });
      setRows((prev) => [...prev, ...data.rows]);
      setCursor(data.cursor);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  // Collect unique agent IDs from current rows for the dropdown.
  const agentIds = Array.from(
    new Set(rows.map((r) => r.agentId).filter((a): a is string => Boolean(a))),
  ).sort();

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Traces</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Observability for agent runs. Each row is one root trace; click to drill into its spans.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect
          value={agentFilter}
          onChange={setAgentFilter}
          options={[
            { value: "", label: "Any agent" },
            ...agentIds.map((id) => ({ value: id, label: id })),
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as SpanStatus | "")}
          options={STATUSES}
        />
        <FilterSelect
          value={hoursFilter === null ? "all" : String(hoursFilter)}
          onChange={(v) => setHoursFilter(v === "all" ? null : Number(v))}
          options={TIME_RANGES.map((r) => ({
            value: r.hours === null ? "all" : String(r.hours),
            label: r.label,
          }))}
        />
      </div>

      {loading ? (
        <CardMessage>Loading traces...</CardMessage>
      ) : error ? (
        <CardMessage>Failed to load traces: {error}</CardMessage>
      ) : rows.length === 0 ? (
        <CardMessage>No traces yet. Traces appear here when agents emit spans.</CardMessage>
      ) : (
        <>
          <TraceTable rows={rows} />
          {cursor && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-stone-300 disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm transition hover:border-stone-300"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function CardMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center rounded-[2rem] border border-stone-200 bg-white py-20 shadow-sm">
      <p className="text-zinc-500">{children}</p>
    </div>
  );
}

async function fetchTraces(args: {
  agentFilter: string;
  statusFilter: SpanStatus | "";
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

  const res = await fetch(`/api/traces?${params.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ListResponse;
}
