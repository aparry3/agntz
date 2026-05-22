import Link from "next/link";
import type { DocsPage } from "./manifest";
import { TOKENS } from "@/components/landing/tokens";

export function PageNav({
  prev,
  next,
}: {
  prev: DocsPage | null;
  next: DocsPage | null;
}) {
  if (!prev && !next) return null;
  return (
    <div
      style={{
        marginTop: 56,
        paddingTop: 24,
        borderTop: `1px solid ${TOKENS.line}`,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
      }}
    >
      <div>
        {prev && (
          <Link
            href={prev.slug === "" ? "/docs" : `/docs/${prev.slug}`}
            style={navLinkStyle("left")}
          >
            <div style={navLabel}>← Previous</div>
            <div style={navTitle}>{prev.title}</div>
          </Link>
        )}
      </div>
      <div>
        {next && (
          <Link
            href={next.slug === "" ? "/docs" : `/docs/${next.slug}`}
            style={navLinkStyle("right")}
          >
            <div style={{ ...navLabel, textAlign: "right" }}>Next →</div>
            <div style={{ ...navTitle, textAlign: "right" }}>{next.title}</div>
          </Link>
        )}
      </div>
    </div>
  );
}

function navLinkStyle(_align: "left" | "right"): React.CSSProperties {
  return {
    display: "block",
    padding: "14px 18px",
    border: `1px solid ${TOKENS.line}`,
    borderRadius: 8,
    background: TOKENS.surface2,
    color: TOKENS.ink,
    textDecoration: "none",
  };
}

const navLabel: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: TOKENS.muted,
  marginBottom: 4,
};

const navTitle: React.CSSProperties = {
  fontSize: 14.5,
  lineHeight: 1.3,
  fontWeight: 500,
  color: TOKENS.ink,
};
