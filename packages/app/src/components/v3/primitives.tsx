// Design-system primitives for the V3 redesign.
//
// These mirror the JSX prototype's reusable bits (Mono, Tag, Btn, Label, Kbd,
// Avatar, HR, VarHl, VarChip, Spinner, Shimmer) but as typed React components
// that read colors from the CSS variables defined in globals.css.

import type { CSSProperties, ReactNode, ButtonHTMLAttributes, Ref } from "react";
import { I } from "./icons";

/* ── Color tokens for inline-styled components ─────────────────────────── */
export const ag = {
  bg: "var(--ag-bg)",
  surface: "var(--ag-surface)",
  surface2: "var(--ag-surface-2)",
  surfaceWarm: "var(--ag-surface-warm)",
  ink: "var(--ag-ink)",
  text2: "var(--ag-text-2)",
  muted: "var(--ag-muted)",
  line: "var(--ag-line)",
  line2: "var(--ag-line-2)",
  ok: "var(--ag-ok)",
  okBg: "var(--ag-ok-bg)",
  warn: "var(--ag-warn)",
  warnBg: "var(--ag-warn-bg)",
  blue: "var(--ag-blue)",
  blueBg: "var(--ag-blue-bg)",
  purple: "var(--ag-purple)",
  purpleBg: "var(--ag-purple-bg)",
  danger: "var(--ag-danger)",
} as const;

export const FONT_MONO = "var(--font-mono)";
export const FONT_SANS = "var(--font-sans)";

/* ── Mono — monospaced span ────────────────────────────────────────────── */
export function Mono({
  children,
  color,
  size = 12,
  style,
  className,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        fontFamily: FONT_MONO,
        fontSize: size,
        color: color ?? ag.text2,
        letterSpacing: "-0.01em",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* ── Label — small uppercase eyebrow ───────────────────────────────────── */
export function Label({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: ag.muted,
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── HR — hairline ─────────────────────────────────────────────────────── */
export function HR({ c = ag.line2, style }: { c?: string; style?: CSSProperties }) {
  return <div style={{ height: 1, background: c, ...style }} />;
}

/* ── Tag — small chip ──────────────────────────────────────────────────── */
export function Tag({
  children,
  bg,
  color,
  mono = false,
  style,
}: {
  children: ReactNode;
  bg: string;
  color: string;
  mono?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: bg,
        color,
        padding: "2px 6px",
        borderRadius: 3,
        fontSize: 10.5,
        fontWeight: 500,
        fontFamily: mono ? FONT_MONO : "inherit",
        letterSpacing: mono ? 0 : "0.01em",
        border: bg === "transparent" ? `1px solid ${ag.line}` : "1px solid transparent",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* ── Btn — primary / secondary / ghost / danger ─────────────────────────── */
type BtnSize = "sm" | "md" | "lg";
type BtnVariant = "primary" | "secondary" | "ghost" | "danger";

export function Btn({
  children,
  icon,
  variant = "primary",
  size = "md",
  style,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  ref?: Ref<HTMLButtonElement>;
}) {
  const sizes: Record<BtnSize, CSSProperties> = {
    sm: { padding: "4px 9px", fontSize: 12, gap: 5 },
    md: { padding: "6px 11px", fontSize: 12.5, gap: 6 },
    lg: { padding: "8px 14px", fontSize: 13, gap: 7 },
  };
  const variants: Record<BtnVariant, CSSProperties> = {
    primary: { background: ag.ink, color: ag.surface, border: `1px solid ${ag.ink}` },
    secondary: { background: ag.surface2, color: ag.ink, border: `1px solid ${ag.line}` },
    ghost: { background: "transparent", color: ag.ink, border: "1px solid transparent" },
    danger: { background: "transparent", color: ag.danger, border: `1px solid ${ag.line}` },
  };
  return (
    <button
      ref={ref}
      {...rest}
      style={{
        ...sizes[size],
        ...variants[variant],
        borderRadius: 4,
        fontWeight: 500,
        cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
        fontFamily: "inherit",
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── Kbd — keyboard shortcut chip ──────────────────────────────────────── */
export function Kbd({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        padding: "2px 5px",
        borderRadius: 3,
        border: dark ? "1px solid rgba(255,255,255,0.18)" : `1px solid ${ag.line}`,
        background: dark ? "rgba(255,255,255,0.06)" : ag.surface,
        color: dark ? "#D4D2CB" : "#6B6B68",
        lineHeight: 1,
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}

/* ── Avatar — small monogram chip ──────────────────────────────────────── */
export function Avatar({
  name,
  size = 22,
  square = false,
}: {
  name?: string;
  size?: number;
  square?: boolean;
}) {
  const colors: Array<[string, string]> = [
    ["#2E2A23", "#E8E3D5"],
    ["#243B53", "#D7E3F2"],
    ["#5B3E1F", "#EFE0C8"],
    ["#1F4D3C", "#D8EBDE"],
    ["#5C2B47", "#EDDAE3"],
  ];
  const idx = (name?.charCodeAt(0) ?? 0) % colors.length;
  const [fg, bg] = colors[idx];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: square ? 3 : 999,
        background: bg,
        color: fg,
        fontWeight: 600,
        fontSize: size * 0.45,
        display: "grid",
        placeItems: "center",
        flex: "0 0 auto",
      }}
    >
      {(name ?? "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

/* ── VarHl + VarChip — inline {{var}} highlight ─────────────────────────── */
export function VarHl({ children }: { children: ReactNode }) {
  return (
    <span style={{ background: ag.warnBg, color: ag.warn, borderRadius: 2, padding: "0 3px" }}>
      {children}
    </span>
  );
}
export function VarChip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 5px",
        background: ag.warnBg,
        color: ag.warn,
        borderRadius: 2,
        fontSize: 10.5,
        fontFamily: FONT_MONO,
        fontWeight: 500,
      }}
    >
      {`{{`}
      {children}
      {`}}`}
    </span>
  );
}

/* ── Spinner — 12px rotating ring ──────────────────────────────────────── */
export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      style={{ animation: "agntz-spin 1s linear infinite" }}
    >
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={ag.line} strokeWidth="1.5" />
      <path
        d="M7 1.5 a 5.5 5.5 0 0 1 5.5 5.5"
        fill="none"
        stroke={ag.ink}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Shimmer — placeholder bar that shimmers while loading ─────────────── */
export function Shimmer({
  w = "100%",
  h = 12,
  r = 3,
  style,
}: {
  w?: string | number;
  h?: number;
  r?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: r,
        background: `linear-gradient(90deg, ${ag.line2} 0%, #F0EBDC 50%, ${ag.line2} 100%)`,
        backgroundSize: "200% 100%",
        animation: "agntz-shim 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/* ── Edge — vertical line + arrow used between graph nodes ─────────────── */
export function Edge({ h = 28 }: { h?: number }) {
  return (
    <div style={{ width: 1, height: h, background: ag.line, position: "relative" }}>
      <div
        style={{
          position: "absolute",
          left: -3,
          bottom: -1,
          width: 7,
          height: 7,
          borderRight: `1px solid ${ag.line}`,
          borderBottom: `1px solid ${ag.line}`,
          transform: "rotate(45deg)",
        }}
      />
    </div>
  );
}

/* ── NodeIO — INPUT / OUTPUT pill at top and bottom of graph ───────────── */
export function NodeIO({
  label,
  sub,
  minWidth = 280,
}: {
  label: string;
  sub?: string;
  minWidth?: number;
}) {
  return (
    <div
      style={{
        minWidth,
        border: `1px dashed ${ag.muted}`,
        borderRadius: 4,
        padding: "10px 14px",
        background: ag.surface,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <Label>{label}</Label>
      {sub && <Mono size={11} color={ag.muted}>{sub}</Mono>}
    </div>
  );
}

/* ── Breadcrumb — single-line crumb row used at page top ──────────────── */
export function Crumbs({ trail }: { trail: Array<string | ReactNode> }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: ag.muted,
        fontSize: 12,
      }}
    >
      {trail.map((c, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: i === trail.length - 1 ? ag.ink : ag.muted }}>{c}</span>
          {i < trail.length - 1 && <I.ChevR size={10} />}
        </span>
      ))}
    </div>
  );
}
