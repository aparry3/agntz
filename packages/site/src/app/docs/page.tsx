import type { Metadata } from "next";
import { Nav } from "@/components/landing/nav";
import { FooterX } from "@/components/landing/footer";
import { TOKENS } from "@/components/landing/tokens";
import { DOCS_MARKDOWN } from "@/components/docs/content";
import { parseDocs, renderBlocks } from "@/components/docs/markdown";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Complete guide to defining, running, and shipping AI agents with agntz — local runner, hosted cloud, SDK reference, schema, and self-host deployment.",
};

export default function DocsPage() {
  const { sections, blocks } = parseDocs(DOCS_MARKDOWN);
  const tocSections = sections.filter((s) => s.level === 2);

  return (
    <>
      <Nav />
      <main style={{ background: TOKENS.bg, paddingBottom: 80 }}>
        <div
          style={{
            width: "min(1180px, calc(100% - 48px))",
            margin: "0 auto",
            paddingTop: 36,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 240px",
            gap: 56,
            alignItems: "start",
          }}
        >
          <article
            style={{
              minWidth: 0,
              maxWidth: 760,
              color: TOKENS.ink,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: TOKENS.text2,
                marginBottom: 18,
              }}
            >
              <span style={{ width: 18, height: 1, background: TOKENS.text2 }} />
              Documentation
            </div>
            {renderBlocks(blocks)}
          </article>

          <aside
            style={{
              position: "sticky",
              top: 96,
              alignSelf: "start",
              maxHeight: "calc(100vh - 120px)",
              overflowY: "auto",
              borderLeft: `1px solid ${TOKENS.line}`,
              paddingLeft: 20,
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: TOKENS.muted,
                marginBottom: 14,
              }}
            >
              On this page
            </div>
            <nav>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {tocSections.map((s) => (
                  <li key={s.slug}>
                    <a
                      href={`#${s.slug}`}
                      style={{
                        display: "block",
                        fontSize: 13,
                        lineHeight: 1.4,
                        color: TOKENS.text2,
                        textDecoration: "none",
                        padding: "2px 0",
                      }}
                    >
                      {s.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div
              style={{
                marginTop: 22,
                paddingTop: 16,
                borderTop: `1px solid ${TOKENS.line}`,
                fontSize: 12,
                lineHeight: 1.5,
                color: TOKENS.muted,
              }}
            >
              Available as raw markdown for AI tools at{" "}
              <a
                href="/llms.txt"
                style={{
                  color: TOKENS.blue,
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                  fontFamily: "var(--mono)",
                }}
              >
                /llms.txt
              </a>
              .
            </div>
          </aside>
        </div>
      </main>
      <FooterX />
    </>
  );
}
