import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, Card, H2, Lede, Pill, Row, Section } from "./primitives";
import { ArrowIcon, CheckIcon, GithubIcon, SparkIcon } from "./icons";

type Cell = string | true;
const ROWS: [string, Cell, Cell][] = [
  ["License", "MIT, free forever", "Free tier + paid plans"],
  ["Runtime", "Your infrastructure", "Managed by us"],
  ["Database", "Your Postgres or SQLite", "Managed Postgres"],
  ["Traces & observability", true, true],
  ["Versioning & pinning", true, true],
  ["MCP, tools, composition", true, true],
  ["Multi-tenancy", "Per-workspace", "+ orgs, SSO, RBAC"],
  ["Setup time", "docker compose · ~5 min", "Sign up · ~30s"],
  ["Scaling & uptime", "You handle it", "Auto-scaled, monitored"],
  ["SLA", "—", "Available on paid tiers"],
];

export function HostingTable({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section id="hosting" kicker="Self-host vs hosted · hosted planned" style={{ background: TOKENS.surface }}>
      <div
        style={{
          marginBottom: 48,
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H2 size={48}>Run it your way.</H2>
        <Lede>
          The OSS runner ships today. The hosted runtime is on the roadmap — same agents, same
          YAML, swap one import line. Self-host the whole stack, or graduate to the managed runtime
          when it lands.
        </Lede>
      </div>

      <Card style={{ overflow: "hidden" }} hover={false}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr",
            borderBottom: `1px solid ${TOKENS.line}`,
            background: TOKENS.warm,
          }}
        >
          <div
            style={{
              padding: "18px 22px",
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: TOKENS.muted,
            }}
          >
            Feature
          </div>
          <div style={{ padding: "18px 22px", borderLeft: `1px solid ${TOKENS.line}` }}>
            <Row gap={8} style={{ alignItems: "center", marginBottom: 4 }}>
              <GithubIcon />
              <span style={{ fontWeight: 600, fontSize: 15 }}>Self-hosted</span>
              <Pill mono style={{ marginLeft: 4 }}>
                OSS
              </Pill>
            </Row>
            <span style={{ fontSize: 13, color: TOKENS.text2 }}>Your infra, your rules.</span>
          </div>
          <div
            style={{
              padding: "18px 22px",
              borderLeft: `1px solid ${TOKENS.line}`,
              background: ACCENTS[accent].bg,
            }}
          >
            <Row gap={8} style={{ alignItems: "center", marginBottom: 4 }}>
              <SparkIcon />
              <span style={{ fontWeight: 600, fontSize: 15 }}>Hosted</span>
              <Pill accent={accent} mono style={{ marginLeft: 4 }}>
                agntz.co
              </Pill>
            </Row>
            <span style={{ fontSize: 13, color: TOKENS.text2 }}>Skip the docker-compose.</span>
          </div>
        </div>
        {ROWS.map((r, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 1fr",
              borderBottom: i < ROWS.length - 1 ? `1px solid ${TOKENS.line2}` : "none",
              background: i % 2 === 1 ? TOKENS.warm : TOKENS.surface2,
            }}
          >
            {r.map((c, j) => (
              <div
                key={j}
                style={{
                  padding: "14px 22px",
                  borderLeft: j > 0 ? `1px solid ${TOKENS.line2}` : "none",
                  fontSize: j === 0 ? 14 : 13.5,
                  color: j === 0 ? TOKENS.ink : TOKENS.text2,
                  fontWeight: j === 0 ? 500 : 400,
                  background: j === 2 ? ACCENTS[accent].bg + "55" : "transparent",
                }}
              >
                {c === true ? (
                  <Row gap={6} style={{ alignItems: "center", color: ACCENTS.green.fg }}>
                    <CheckIcon /> <span style={{ color: TOKENS.text2 }}>Full</span>
                  </Row>
                ) : c === "—" ? (
                  <span style={{ color: TOKENS.muted }}>—</span>
                ) : (
                  c
                )}
              </div>
            ))}
          </div>
        ))}
      </Card>

      <Row gap={12} style={{ marginTop: 24, alignItems: "center", flexWrap: "wrap" }}>
        <Btn icon={<GithubIcon />} href="https://github.com/aparry3/agntz">
          Clone the repo
        </Btn>
        <Btn primary href="/docs">
          Read the quickstart <ArrowIcon />
        </Btn>
        <span style={{ fontSize: 13, color: TOKENS.muted, marginLeft: 8 }}>
          Hosted runtime coming soon. Self-hosted is shipping today.
        </span>
      </Row>
    </Section>
  );
}
