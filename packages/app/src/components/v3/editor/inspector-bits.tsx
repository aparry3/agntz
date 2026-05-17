// Inspector building blocks shared by the single-LLM editor and the pipeline
// editor: collapsible sections, field rows, available-state lines, binding
// rows, sub-blocks. Mirrors the V3 prototype's InsSection / SubBlock /
// StateLine / V3BindRow / MapRowSimple pieces but as typed components.

"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { I } from "@/components/v3/icons";
import { Mono, VarHl, ag } from "@/components/v3/primitives";

/* ── InsSection — collapsible row in the inspector ────────────────────── */
export function InsSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${ag.line2}` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          border: 0,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <I.ChevR
          size={10}
          style={{
            color: ag.muted,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 120ms",
          }}
        />
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 500,
            color: ag.ink,
            letterSpacing: "0.01em",
            flex: 1,
          }}
        >
          {title}
        </span>
        {badge && (
          <Mono size={10.5} color={ag.muted}>
            {badge}
          </Mono>
        )}
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ── SubBlock — labelled value row used inside a section ──────────────── */
export function SubBlock({
  label,
  value,
  multiline,
  mono,
  select,
}: {
  label: string;
  value: ReactNode;
  multiline?: boolean;
  mono?: boolean;
  select?: boolean;
}) {
  return (
    <div>
      <Mono size={10} color={ag.muted} style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </Mono>
      <div
        style={{
          marginTop: 5,
          border: `1px solid ${ag.line}`,
          borderRadius: 4,
          padding: multiline ? "8px 10px" : "5px 10px",
          background: ag.surface2,
          fontSize: 12.5,
          color: ag.ink,
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          minHeight: multiline ? 50 : undefined,
          lineHeight: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ flex: 1 }}>{value}</span>
        {select && <I.Chev size={11} style={{ color: ag.muted }} />}
      </div>
    </div>
  );
}

/* ── Field — labelled value with optional select chevron ──────────────── */
export function Field({
  label,
  value,
  mono,
  multiline,
  hint,
  inline,
  select,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  multiline?: boolean;
  hint?: string;
  inline?: boolean;
  select?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: ag.muted,
          fontWeight: 500,
          marginBottom: inline ? 4 : 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          border: `1px solid ${ag.line}`,
          borderRadius: 4,
          padding: multiline ? "8px 10px" : "6px 10px",
          background: ag.surface2,
          fontSize: 12.5,
          color: ag.ink,
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          minHeight: multiline ? 60 : undefined,
          lineHeight: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ flex: 1 }}>{value}</span>
        {select && <I.Chev size={11} style={{ color: ag.muted }} />}
      </div>
      {hint && (
        <Mono size={10.5} color={ag.muted} style={{ marginTop: 4, display: "inline-block" }}>
          {hint}
        </Mono>
      )}
    </div>
  );
}

/* ── BindRow — Inputs row: target field ← source chip ──────────────────── */
export interface BindRowSource {
  kind: "caller" | "session" | "literal" | "var" | "upstream";
  label: string;
  hint?: string;
}

export function BindRow({
  target,
  type,
  required,
  defaultV,
  binding,
  last,
}: {
  target: string;
  type: string;
  required?: boolean;
  defaultV?: string;
  binding: BindRowSource;
  last?: boolean;
}) {
  const palette = bindingPalette(binding.kind);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(80px, 1fr) auto 1fr",
        padding: "7px 10px",
        gap: 8,
        alignItems: "center",
        fontSize: 12,
        borderBottom: last ? "0" : `1px solid ${ag.line2}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Mono size={12}>{target}</Mono>
        {required && (
          <span title="required" style={{ color: ag.warn, fontSize: 10 }}>
            •
          </span>
        )}
        <Mono size={10.5} color={ag.muted}>
          {type}
          {defaultV ? ` = ${defaultV}` : ""}
        </Mono>
      </div>
      <I.ArrowR size={11} style={{ color: ag.muted, transform: "rotate(180deg)" }} />
      <button
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "2px 6px",
          background: palette.bg,
          border: "1px solid transparent",
          borderRadius: 3,
          cursor: "pointer",
          minWidth: 0,
          overflow: "hidden",
          fontFamily: "inherit",
        }}
      >
        {binding.kind === "var" || binding.kind === "upstream" ? (
          <VarHl>
            <Mono size={11}>{binding.label}</Mono>
          </VarHl>
        ) : (
          <Mono
            size={10.5}
            color={palette.fg}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500,
            }}
          >
            {binding.label}
          </Mono>
        )}
        {binding.hint && (
          <Mono size={9.5} color={ag.muted} style={{ flex: "0 0 auto" }}>
            {binding.hint}
          </Mono>
        )}
        <I.Chev size={9} style={{ color: palette.fg, marginLeft: "auto", flex: "0 0 auto", opacity: 0.7 }} />
      </button>
    </div>
  );
}

function bindingPalette(kind: BindRowSource["kind"]) {
  switch (kind) {
    case "caller":
      return { bg: ag.line2, fg: ag.text2 };
    case "session":
      return { bg: ag.purpleBg, fg: ag.purple };
    case "upstream":
      return { bg: ag.okBg, fg: ag.ok };
    case "var":
      return { bg: ag.warnBg, fg: ag.warn };
    default:
      return { bg: ag.bg, fg: ag.text2 };
  }
}

/* ── StateLine — single row in the Available State panel ──────────────── */
export type StateOrigin = "input" | "upstream" | "loop" | "session";

export function StateLine({
  name,
  type,
  origin,
  stepN,
  sample,
  last,
}: {
  name: string;
  type: string;
  origin: StateOrigin;
  stepN?: number;
  sample?: string;
  last?: boolean;
}) {
  const origins: Record<StateOrigin, [string, string]> = {
    input: [ag.warn, "input"],
    upstream: [ag.ok, `↑ step ${stepN ?? ""}`.trim()],
    loop: [ag.purple, "↻ loop"],
    session: [ag.blue, "session"],
  };
  const [color, label] = origins[origin];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.5fr) auto auto",
        alignItems: "center",
        padding: "5px 10px",
        gap: 8,
        fontSize: 12,
        borderBottom: last ? "0" : `1px solid ${ag.line2}`,
        cursor: "pointer",
        background: ag.bg,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span
          style={{
            background: ag.warnBg,
            color: ag.warn,
            borderRadius: 2,
            padding: "0 4px",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 500,
            flex: "0 0 auto",
          }}
        >{`{{${name}}}`}</span>
        {sample && (
          <Mono
            size={10}
            color={ag.muted}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {sample}
          </Mono>
        )}
      </div>
      <Mono
        size={10.5}
        color={ag.text2}
        style={{
          padding: "1px 5px",
          background: ag.surface2,
          border: `1px solid ${ag.line2}`,
          borderRadius: 2,
          whiteSpace: "nowrap",
        }}
      >
        {type}
      </Mono>
      <Mono
        size={9.5}
        color={color}
        style={{
          padding: "1px 5px",
          background: ag.bg,
          borderRadius: 2,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Mono>
    </div>
  );
}

/* ── DashedAdd — "+ Add field / Map input" pseudo-button ──────────────── */
export function DashedAdd({
  children,
  onClick,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 6,
        padding: "6px 10px",
        width: "100%",
        border: `1px dashed ${ag.line}`,
        borderRadius: 4,
        background: "transparent",
        color: ag.text2,
        fontSize: 11.5,
        fontFamily: "var(--font-mono)",
        cursor: "pointer",
        textAlign: "left",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/* ── FooterHint — sticky inspector footer scope note ──────────────────── */
export function FooterHint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: "0 0 auto",
        padding: "8px 16px",
        borderTop: `1px solid ${ag.line}`,
        background: ag.bg,
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10.5,
        color: ag.muted,
        fontFamily: "var(--font-mono)",
      }}
    >
      <I.Sparkle size={10} />
      {children}
    </div>
  );
}

/* ── ToolBlock + ToolRow — read-only display of attached tools ────────── */
export function ToolBlock({
  kind,
  label,
  server,
  children,
}: {
  kind: "mcp" | "local" | "agent" | "http";
  label: string;
  server?: string;
  children: ReactNode;
}) {
  const palette = {
    mcp: [ag.purple, ag.purpleBg] as const,
    local: [ag.blue, ag.blueBg] as const,
    agent: [ag.ok, ag.okBg] as const,
    http: [ag.warn, ag.warnBg] as const,
  }[kind];
  return (
    <div style={{ border: `1px solid ${ag.line}`, borderRadius: 4, background: ag.surface2 }}>
      <div
        style={{
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.surface,
        }}
      >
        <span
          style={{
            background: palette[1],
            color: palette[0],
            padding: "2px 6px",
            borderRadius: 3,
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
          }}
        >
          {label}
        </span>
        {server ? (
          <Mono
            size={10.5}
            color={ag.muted}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
          >
            {server}
          </Mono>
        ) : (
          <div style={{ flex: 1 }} />
        )}
        <I.Ellipsis size={12} style={{ color: ag.muted }} />
      </div>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

export function ToolRow({
  name,
  sub,
  wrapped,
}: {
  name: string;
  sub?: string;
  wrapped?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${ag.line2}`,
        borderRadius: 3,
        padding: "6px 8px",
        background: ag.surface,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Mono size={12}>{name}</Mono>
        {wrapped && (
          <span
            style={{
              background: ag.warnBg,
              color: ag.warn,
              padding: "2px 6px",
              borderRadius: 3,
              fontSize: 10.5,
              fontFamily: "var(--font-mono)",
              fontWeight: 500,
            }}
          >
            wrapped
          </span>
        )}
        <div style={{ flex: 1 }} />
        <I.Ellipsis size={11} style={{ color: ag.muted }} />
      </div>
      {sub && (
        <Mono size={10.5} color={ag.muted} style={{ marginTop: 1, display: "inline-block" }}>
          {sub}
        </Mono>
      )}
    </div>
  );
}
