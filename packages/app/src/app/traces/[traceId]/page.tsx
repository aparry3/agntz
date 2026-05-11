"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { Span, TraceSummary } from "@agntz/core";
import { StatusBadge } from "@/components/status-badge";
import { RelativeTime } from "@/components/relative-time";
import { GanttStrip } from "@/components/traces/gantt-strip";
import { SpanTree } from "@/components/traces/span-tree";
import { SpanDetailPanel } from "@/components/traces/span-detail-panel";

interface DetailResponse {
  summary: TraceSummary;
  spans: Span[];
}

export default function TraceDetailPage({
  params,
}: {
  params: Promise<{ traceId: string }>;
}) {
  const { traceId } = use(params);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/traces/${encodeURIComponent(traceId)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `${r.status} ${r.statusText}`);
        }
        return (await r.json()) as DetailResponse;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        // Auto-select the root span so the detail panel isn't blank on load.
        const root = d.spans.find((s) => s.parentId === null) ?? d.spans[0] ?? null;
        if (root) setSelectedSpanId(root.spanId);
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
  }, [traceId]);

  useEffect(() => {
    if (!data || data.summary.status !== "running") return;
    const es = new EventSource(`/api/traces/${encodeURIComponent(traceId)}/stream`);

    es.addEventListener("span-start", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data) as { span: Span };
        setData((prev) =>
          prev ? { ...prev, spans: [...prev.spans, payload.span] } : prev,
        );
      } catch {
        // Best-effort parsing; skip malformed frames.
      }
    });

    es.addEventListener("span-end", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data) as {
          spanId: string;
          patch: Partial<Span>;
        };
        setData((prev) =>
          prev
            ? {
                ...prev,
                spans: prev.spans.map((s) =>
                  s.spanId === payload.spanId ? { ...s, ...payload.patch } : s,
                ),
              }
            : prev,
        );
      } catch {
        // skip malformed
      }
    });

    es.addEventListener("trace-done", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data) as { summary: TraceSummary };
        setData((prev) => (prev ? { ...prev, summary: payload.summary } : prev));
      } catch {
        // skip malformed
      }
      es.close();
    });

    es.addEventListener("snapshot", () => {
      // Already loaded via /api/traces/:id during initial fetch.
      es.close();
    });

    es.onerror = () => {
      // Network/disconnect — close so we don't hold the connection open.
      es.close();
    };

    return () => es.close();
  }, [data?.summary.status, data?.summary.traceId, traceId]);

  if (loading) {
    return <CardMessage>Loading trace...</CardMessage>;
  }
  if (error) {
    return <CardMessage>Failed to load trace: {error}</CardMessage>;
  }
  if (!data) {
    return <CardMessage>Trace not found.</CardMessage>;
  }

  const { summary, spans } = data;
  const selectedSpan = spans.find((s) => s.spanId === selectedSpanId) ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <Link href="/traces" className="text-xs text-zinc-500 hover:text-zinc-900">
          ← All traces
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="font-mono text-2xl font-semibold text-zinc-950">{summary.traceId}</h1>
          <StatusBadge status={summary.status} />
          {summary.status === "running" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              Live
            </span>
          )}
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-600">
          <Meta label="Agent" value={summary.agentId ?? "—"} />
          <Meta label="Started" value={<RelativeTime iso={summary.startedAt} />} />
          <Meta
            label="Duration"
            value={summary.durationMs === null ? "—" : `${(summary.durationMs / 1000).toFixed(2)}s`}
          />
          <Meta label="Spans" value={String(summary.spanCount)} />
          <Meta label="Tokens" value={summary.totalTokens.toLocaleString()} />
          <Meta
            label="Cost"
            value={summary.totalCostUsd === null ? "—" : `$${summary.totalCostUsd.toFixed(4)}`}
          />
        </dl>
      </div>

      <GanttStrip
        spans={spans}
        summary={summary}
        selectedSpanId={selectedSpanId}
        onSelect={setSelectedSpanId}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <SpanTree spans={spans} selectedSpanId={selectedSpanId} onSelect={setSelectedSpanId} />
        </div>
        <div className="lg:col-span-2">
          <SpanDetailPanel span={selectedSpan} />
        </div>
      </div>
    </div>
  );
}

function CardMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex items-center justify-center rounded-[2rem] border border-stone-200 bg-white py-20 shadow-sm">
        <p className="text-zinc-500">{children}</p>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-400">{label}:</span>
      <span className="font-mono text-zinc-900">{value}</span>
    </div>
  );
}
