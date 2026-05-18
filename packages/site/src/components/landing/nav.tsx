import { Btn, Row, Wordmark } from "./primitives";
import { ArrowIcon, GithubIcon } from "./icons";
import { TOKENS } from "./tokens";

const NAV_LINKS: [string, string][] = [
  ["Product", "#how"],
  ["Docs", "#"],
  ["Pricing", "#pricing"],
  ["Changelog", "#"],
  ["Blog", "#"],
];

export function Nav() {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(244,241,233,0.82)",
        backdropFilter: "saturate(140%) blur(12px)",
        WebkitBackdropFilter: "saturate(140%) blur(12px)",
        borderBottom: `1px solid ${TOKENS.line}`,
      }}
    >
      <div
        style={{
          width: "min(1180px, calc(100% - 64px))",
          margin: "0 auto",
          padding: "14px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Row gap={28} style={{ alignItems: "center" }}>
          <Wordmark />
          <Row gap={2} style={{ alignItems: "center" }}>
            {NAV_LINKS.map(([l, h]) => (
              <a
                key={l}
                href={h}
                style={{
                  padding: "6px 12px",
                  fontSize: 13.5,
                  color: TOKENS.text2,
                  textDecoration: "none",
                  borderRadius: 5,
                  letterSpacing: "-0.005em",
                }}
              >
                {l}
              </a>
            ))}
          </Row>
        </Row>
        <Row gap={10} style={{ alignItems: "center" }}>
          <a
            href="https://github.com/aparry3/agntz"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: TOKENS.text2,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            <GithubIcon />
            <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>2,847</span>
          </a>
          <a href="#" style={{ color: TOKENS.text2, fontSize: 13.5, textDecoration: "none" }}>
            Sign in
          </a>
          <Btn primary size="sm">
            Get started <ArrowIcon />
          </Btn>
        </Row>
      </div>
    </div>
  );
}
