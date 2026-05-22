import Link from "next/link";
import { DOCS_GROUPS } from "./manifest";
import { TOKENS } from "@/components/landing/tokens";

export function DocsSidebar({ activeSlug }: { activeSlug: string }) {
  return (
    <nav
      aria-label="Documentation"
      style={{
        position: "sticky",
        top: 96,
        alignSelf: "start",
        maxHeight: "calc(100vh - 120px)",
        overflowY: "auto",
        paddingRight: 12,
      }}
    >
      <ul style={listReset}>
        {DOCS_GROUPS.map((group) => (
          <li key={group.label} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: TOKENS.muted,
                margin: "0 0 8px 0",
              }}
            >
              {group.label}
            </div>
            <ul style={listReset}>
              {group.pages.map((page) => {
                const active = page.slug === activeSlug;
                const href = page.slug === "" ? "/docs" : `/docs/${page.slug}`;
                return (
                  <li key={page.slug || "_index"}>
                    <Link
                      href={href}
                      style={{
                        display: "block",
                        padding: "4px 10px",
                        margin: "0 -10px",
                        borderRadius: 6,
                        fontSize: 13.5,
                        lineHeight: 1.4,
                        color: active ? TOKENS.ink : TOKENS.text2,
                        textDecoration: "none",
                        background: active ? TOKENS.line2 : "transparent",
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const listReset = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
};
