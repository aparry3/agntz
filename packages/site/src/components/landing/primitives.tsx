import type { CSSProperties, ReactNode } from "react";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";

type DivProps = {
  children?: ReactNode;
  style?: CSSProperties;
};

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <a
      href="#"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M7 16 L11 8 L13 8 L17 16 M9 13 H15"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{ fontFamily: "var(--mono)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
        agntz
      </span>
    </a>
  );
}

export function Pill({
  children,
  accent,
  dot,
  mono = true,
  style,
}: {
  children: ReactNode;
  accent?: AccentName;
  dot?: boolean;
  mono?: boolean;
  style?: CSSProperties;
}) {
  const a = accent && ACCENTS[accent];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${a ? a.line : TOKENS.line}`,
        background: a ? a.bg : TOKENS.surface,
        color: a ? a.fg : TOKENS.text2,
        fontFamily: mono ? "var(--mono)" : "var(--sans)",
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: mono ? "0.02em" : 0,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: a ? a.fg : TOKENS.text2,
          }}
        />
      )}
      {children}
    </span>
  );
}

type BtnSize = "sm" | "md" | "lg";

export function Btn({
  children,
  primary = false,
  ghost = false,
  mono = false,
  href,
  icon,
  style,
  size = "md",
}: {
  children: ReactNode;
  primary?: boolean;
  ghost?: boolean;
  mono?: boolean;
  href?: string;
  icon?: ReactNode;
  style?: CSSProperties;
  size?: BtnSize;
}) {
  const pad = size === "lg" ? "12px 20px" : size === "sm" ? "6px 12px" : "10px 16px";
  const fs = size === "lg" ? 14 : size === "sm" ? 12 : 13;
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: pad,
    border: "1px solid " + TOKENS.ink,
    borderRadius: 6,
    fontFamily: mono ? "var(--mono)" : "var(--sans)",
    fontSize: fs,
    fontWeight: 500,
    letterSpacing: mono ? "0.01em" : "-0.005em",
    color: primary ? TOKENS.bg : TOKENS.ink,
    background: primary ? TOKENS.ink : ghost ? "transparent" : TOKENS.surface2,
    textDecoration: "none",
    cursor: "pointer",
    transition: "transform 0.12s, box-shadow 0.12s",
    whiteSpace: "nowrap",
    boxShadow: primary ? "0 1px 0 rgba(26,25,22,0.06), 0 2px 4px rgba(26,25,22,0.08)" : "none",
    ...style,
  };
  if (ghost) base.borderColor = "transparent";
  return (
    <a href={href || "#"} style={base}>
      {icon && <span style={{ display: "inline-flex" }}>{icon}</span>}
      {children}
    </a>
  );
}

export function Section({
  id,
  kicker,
  children,
  style,
  dark = false,
  dense = false,
}: {
  id?: string;
  kicker?: string;
  children: ReactNode;
  style?: CSSProperties;
  dark?: boolean;
  dense?: boolean;
}) {
  return (
    <section
      id={id}
      style={{
        position: "relative",
        padding: dense ? "56px 0 64px" : "96px 0 104px",
        background: dark ? TOKENS.ink : "transparent",
        color: dark ? TOKENS.bg : TOKENS.ink,
        ...style,
      }}
    >
      <div style={{ width: "min(1180px, calc(100% - 64px))", margin: "0 auto" }}>
        {kicker && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: dark ? "rgba(244,241,233,0.65)" : TOKENS.text2,
              marginBottom: 24,
            }}
          >
            <span
              style={{
                width: 18,
                height: 1,
                background: dark ? "rgba(244,241,233,0.4)" : TOKENS.text2,
                display: "inline-block",
              }}
            />
            {kicker}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function H1({
  children,
  size = 64,
  style,
}: {
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <h1
      style={{
        fontFamily: "var(--sans)",
        fontSize: size,
        fontWeight: 500,
        lineHeight: 1.02,
        letterSpacing: "-0.035em",
        margin: 0,
        textWrap: "balance",
        ...style,
      }}
    >
      {children}
    </h1>
  );
}

export function H2({
  children,
  size = 44,
  style,
}: {
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <h2
      style={{
        fontFamily: "var(--sans)",
        fontSize: size,
        fontWeight: 500,
        lineHeight: 1.05,
        letterSpacing: "-0.03em",
        margin: 0,
        textWrap: "balance",
        ...style,
      }}
    >
      {children}
    </h2>
  );
}

export function Lede({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p
      style={{
        fontFamily: "var(--sans)",
        fontSize: 18,
        lineHeight: 1.55,
        color: TOKENS.text2,
        margin: 0,
        textWrap: "pretty",
        maxWidth: 580,
        ...style,
      }}
    >
      {children}
    </p>
  );
}

export function Code({ children, accent }: { children: ReactNode; accent?: AccentName }) {
  const a = accent && ACCENTS[accent];
  return (
    <code
      style={{
        fontFamily: "var(--mono)",
        fontSize: "0.88em",
        background: a ? a.bg : TOKENS.line2,
        color: a ? a.fg : TOKENS.ink,
        padding: "1px 6px",
        borderRadius: 4,
        border: `1px solid ${a ? a.line : TOKENS.line}`,
      }}
    >
      {children}
    </code>
  );
}

export function Card({
  children,
  style,
  hover = true,
  dark = false,
}: {
  children: ReactNode;
  style?: CSSProperties;
  hover?: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={hover ? "ag-card-hover" : undefined}
      style={{
        position: "relative",
        background: dark ? TOKENS.ink : TOKENS.surface2,
        border: `1px solid ${dark ? "rgba(244,241,233,0.16)" : TOKENS.line}`,
        borderRadius: 10,
        boxShadow: dark ? "none" : "0 1px 0 rgba(26,25,22,0.03)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Stack({
  gap = 16,
  children,
  style,
  dir = "column",
}: DivProps & { gap?: number; dir?: "column" | "row" }) {
  return (
    <div style={{ display: "flex", flexDirection: dir, gap, ...style }}>{children}</div>
  );
}

export function Row({
  gap = 16,
  children,
  style,
  onClick,
}: DivProps & { gap?: number; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ display: "flex", flexDirection: "row", gap, ...style }}>
      {children}
    </div>
  );
}
