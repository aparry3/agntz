"use client";

import Link from "next/link";
import type { Run, RunStatus } from "@agntz/core";
import { I } from "@/components/v3/icons";
import { Mono, ag } from "@/components/v3/primitives";

const COLUMNS = "80px 160px minmax(220px,1.6fr) 120px 150px 90px 100px 100px";

export function RunsList({ rows }: { rows: Run[] }) {
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
        <div>Status</div>
        <div>Agent</div>
        <div>Input</div>
        <div>Run</div>
        <div>Model</div>
        <div style={{ textAlign: "right" }}>Tokens</div>
        <div style={{ textAlign: "right" }}>Duration</div>
        <div>Started</div>
      </div>
      {rows.map((row, i) => (
        <RunRow key={row.id} row={row} isLast={i === rows.length - 1} />
      ))}
    </div>
  );
}

function RunRow({ row, isLast }: { row: Run; isLast: boolean }) {
  const durMs = row.endedAt && row.startedAt ? row.endedAt - row.startedAt : null;
  const tokens = row.result?.usage?.totalTokens;
  const model = (row.result?.usage as { model?: string } | undefined)?.model ?? null;

  return (
    <Link
      href={`/runs/${row.id}`}
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
      }}
    >
      <div>
        <StatusChip status={row.status} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <AgentAvatar />
        <span
          style={{
            fontWeight: 500,
            color: ag.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.agentId}
        </span>
      </div>
      <div
        style={{
          color: ag.text2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.input}
      </div>
      <Mono size={11} color={ag.muted}>
        {row.id}
      </Mono>
      <Mono size={11} color={ag.text2}>
        {model ?? "—"}
      </Mono>
      <Mono size={11} color={ag.text2} style={{ textAlign: "right", display: "block" }}>
        {formatTokens(tokens)}
      </Mono>
      <Mono size={11} color={ag.text2} style={{ textAlign: "right", display: "block" }}>
        {formatDurationMs(durMs)}
      </Mono>
      <Mono size={11} color={ag.muted}>
        {formatRelative(row.startedAt)}
      </Mono>
    </Link>
  );
}

function StatusChip({ status }: { status: RunStatus }) {
  const M: Record<RunStatus, { bg: string; fg: string; label: string; pulse?: boolean }> = {
    running:   { bg: ag.blueBg, fg: ag.blue, label: "Running",   pulse: true },
    pending:   { bg: ag.blueBg, fg: ag.blue, label: "Pending",   pulse: true },
    draining:  { bg: ag.blueBg, fg: ag.blue, label: "Draining",  pulse: true },
    completed: { bg: ag.okBg,   fg: ag.ok,   label: "Done" },
    failed:    { bg: "#F2DCDE", fg: ag.danger, label: "Failed" },
    cancelled: { bg: ag.line2,  fg: ag.text2,  label: "Cancelled" },
  };
  const m = M[status] ?? { bg: ag.line2, fg: ag.text2, label: status };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: m.bg,
        color: m.fg,
        padding: "2px 7px",
        borderRadius: 3,
        fontSize: 10.5,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: m.fg,
          animation: m.pulse ? "agntz-pulse 1.4s ease-in-out infinite" : undefined,
        }}
      />
      {m.label}
    </span>
  );
}

function AgentAvatar() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        flex: "0 0 auto",
        background: ag.blueBg,
        color: ag.blue,
        display: "grid",
        placeItems: "center",
      }}
    >
      <I.Sparkle size={11} />
    </div>
  );
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatTokens(t: number | undefined): string {
  if (t == null) return "—";
  if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
  return String(t);
}

function formatRelative(startedAt: number): string {
  const diff = Math.max(0, Date.now() - startedAt);
  const s = Math.round(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(startedAt).toLocaleDateString();
}

export const RunsTable = RunsList;
