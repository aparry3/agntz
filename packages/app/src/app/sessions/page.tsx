"use client";

import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/v3/icons";
import { Crumbs, Mono, ag } from "@/components/v3/primitives";

interface Session {
  sessionId: string;
  agentId?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = "minmax(240px,1.4fr) 200px 100px 90px 130px";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then(setSessions)
      .finally(() => setLoading(false));
  }, []);

  const agentIds = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.agentId).filter((a): a is string => Boolean(a)))).sort(),
    [sessions],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (agentFilter && s.agentId !== agentFilter) return false;
      if (q) {
        return (
          s.sessionId.toLowerCase().includes(q) ||
          (s.agentId ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sessions, search, agentFilter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <div style={{ padding: "20px 32px 18px", borderBottom: `1px solid ${ag.line2}`, background: ag.bg }}>
        <div style={{ marginBottom: 8 }}>
          <Crumbs trail={["agntz", "Sessions"]} />
        </div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em", color: ag.ink }}>
          Sessions
        </h1>
        <div style={{ marginTop: 5, fontSize: 13, color: ag.text2, maxWidth: 600 }}>
          Browse stored conversation sessions and recent activity.
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
            placeholder="Search session id or agent…"
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
        <div style={{ flex: 1 }} />
        <Mono size={11} color={ag.muted}>
          {loading ? "loading…" : `${filtered.length} sessions · sort: updated ↓`}
        </Mono>
      </div>

      <div style={{ padding: "16px 32px 32px", flex: 1, overflow: "auto" }}>
        {loading ? (
          <CardMessage>Loading sessions…</CardMessage>
        ) : sessions.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <CardMessage>No sessions match the current filter.</CardMessage>
        ) : (
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
              <div>Session</div>
              <div>Agent</div>
              <div>State</div>
              <div style={{ textAlign: "right" }}>Msgs</div>
              <div>Updated</div>
            </div>
            {filtered.map((s, i) => (
              <SessionRow key={s.sessionId} session={s} isLast={i === filtered.length - 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionRow({ session, isLast }: { session: Session; isLast: boolean }) {
  const state = deriveState(session.updatedAt);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: COLUMNS,
        padding: "12px 16px",
        gap: 12,
        alignItems: "center",
        borderBottom: isLast ? "none" : `1px solid ${ag.line2}`,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <SessionAvatar />
        <div style={{ minWidth: 0 }}>
          <Mono
            size={12}
            color={ag.ink}
            style={{
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
            }}
          >
            {session.sessionId}
          </Mono>
          <Mono size={10.5} color={ag.muted}>
            started {formatRelativeIso(session.createdAt)}
          </Mono>
        </div>
      </div>
      <span
        style={{
          color: ag.text2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {session.agentId ?? "—"}
      </span>
      <div>
        <StateChip state={state} />
      </div>
      <Mono size={11} color={ag.text2} style={{ textAlign: "right", display: "block" }}>
        {session.messageCount}
      </Mono>
      <Mono size={11} color={ag.muted}>
        {formatRelativeIso(session.updatedAt)}
      </Mono>
    </div>
  );
}

function SessionAvatar() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        flex: "0 0 auto",
        background: ag.purpleBg,
        color: ag.purple,
        display: "grid",
        placeItems: "center",
      }}
    >
      <I.Sessions size={12} />
    </div>
  );
}

function StateChip({ state }: { state: "active" | "idle" | "ended" }) {
  const M = {
    active: { bg: ag.okBg, fg: ag.ok, label: "Active", pulse: true },
    idle:   { bg: ag.warnBg, fg: ag.warn, label: "Idle", pulse: false },
    ended:  { bg: ag.line2, fg: ag.text2, label: "Ended", pulse: false },
  }[state];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: M.bg,
        color: M.fg,
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
          background: M.fg,
          animation: M.pulse ? "agntz-pulse 1.4s ease-in-out infinite" : undefined,
        }}
      />
      {M.label}
    </span>
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
        <I.Sessions size={20} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: ag.ink, marginBottom: 4 }}>No sessions yet</div>
      <div style={{ fontSize: 12.5, color: ag.muted }}>
        Conversation sessions appear here once an agent starts handling stateful chats.
      </div>
    </div>
  );
}

function deriveState(updatedAtIso: string): "active" | "idle" | "ended" {
  const t = Date.parse(updatedAtIso);
  if (!Number.isFinite(t)) return "ended";
  const diff = Date.now() - t;
  if (diff < 5 * 60_000) return "active";
  if (diff < 60 * 60_000) return "idle";
  return "ended";
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
