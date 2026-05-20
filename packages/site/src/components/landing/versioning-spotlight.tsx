import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, Card, Code, H2, Lede, Pill, Row, Section, Stack } from "./primitives";

const ADDRESSES: [string, string][] = [
  ["support-agent", "→ pinned"],
  ["support-agent@latest", "→ newest save"],
  ["support-agent@2026-05-17T15:42", "→ exact moment"],
  ["support-agent@known-good", "→ your alias"],
  ["support-agent@canary", "→ your alias"],
];

export function VersioningSpotlight({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section
      id="versioning"
      kicker="Spotlight · 02 — Versioning · planned"
      style={{ background: TOKENS.surface }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.15fr 0.85fr",
          gap: 72,
          alignItems: "center",
        }}
      >
        <VersionPanel accent={accent} />

        <Stack gap={24}>
          <H2 size={48}>
            Iterate
            <br />
            without fear.
          </H2>
          <Lede style={{ fontSize: 18 }}>
            <b style={{ color: TOKENS.ink, fontWeight: 600 }}>
              Save creates a version. Pin chooses what ships.
            </b>
          </Lede>
          <p
            style={{
              margin: 0,
              color: TOKENS.text2,
              fontSize: 15,
              lineHeight: 1.6,
              maxWidth: 460,
            }}
          >
            On the roadmap for the hosted runtime: every save timestamped, immutable, and
            addressable. Production calls <Code>support-agent</Code> and gets the pinned version —
            in-flight edits never reach users until you pin them.
          </p>
          <Stack gap={6} style={{ marginTop: 4 }}>
            {ADDRESSES.map(([k, v]) => (
              <Row
                key={k}
                gap={10}
                style={{ alignItems: "center", fontFamily: "var(--mono)", fontSize: 12.5 }}
              >
                <span style={{ color: ACCENTS[accent].fg, fontWeight: 500 }}>{k}</span>
                <span style={{ color: TOKENS.muted, flex: 1 }}>{v}</span>
              </Row>
            ))}
          </Stack>
          <div
            style={{
              marginTop: 12,
              paddingTop: 18,
              borderTop: `1px solid ${TOKENS.line}`,
              fontFamily: "var(--sans)",
              fontSize: 16,
              color: TOKENS.ink,
              fontStyle: "italic",
              letterSpacing: "-0.01em",
              maxWidth: 460,
              lineHeight: 1.4,
            }}
          >
            The difference between prompt engineering and prompt operations.
          </div>
        </Stack>
      </div>
    </Section>
  );
}

type Version = {
  ts: string;
  note: string;
  latest: boolean;
  pinned: boolean;
  alias?: string;
  by: string;
};

const VERSIONS: Version[] = [
  { ts: "2026-05-17  15:42", note: "soften greeting copy", latest: true, pinned: false, by: "@aaron" },
  {
    ts: "2026-05-17  11:08",
    note: "add fallback for missing customerId",
    latest: false,
    pinned: false,
    by: "@aaron",
  },
  {
    ts: "2026-05-15  09:12",
    note: "add lookup_customer tool",
    latest: false,
    pinned: true,
    alias: "@known-good",
    by: "@maya",
  },
  {
    ts: "2026-05-13  14:04",
    note: "first draft of instruction",
    latest: false,
    pinned: false,
    by: "@aaron",
  },
  { ts: "2026-05-12  11:03", note: "initial commit", latest: false, pinned: false, by: "@aaron" },
];

function VersionPanel({ accent }: { accent: AccentName }) {
  return (
    <Card
      style={{
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(26,25,22,0.10), 0 4px 12px rgba(26,25,22,0.05)",
      }}
    >
      <Row
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: `1px solid ${TOKENS.line}`,
          background: TOKENS.warm,
        }}
      >
        <Row gap={6} style={{ alignItems: "center" }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: TOKENS.line }} />
          <span style={{ width: 9, height: 9, borderRadius: 99, background: TOKENS.line }} />
          <span style={{ width: 9, height: 9, borderRadius: 99, background: TOKENS.line }} />
          <span
            style={{
              marginLeft: 14,
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: TOKENS.text2,
            }}
          >
            Agents / support-agent
          </span>
        </Row>
        <Row gap={6}>
          <Pill mono>● unsaved · 1 change</Pill>
        </Row>
      </Row>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr" }}>
        <Stack
          gap={0}
          style={{ borderRight: `1px solid ${TOKENS.line}`, background: TOKENS.surface2 }}
        >
          <Row
            style={{
              borderBottom: `1px solid ${TOKENS.line}`,
              paddingLeft: 14,
              background: TOKENS.surface,
            }}
          >
            {["YAML", "Form", "Diff"].map((t, i) => (
              <span
                key={t}
                style={{
                  padding: "9px 14px",
                  fontSize: 12,
                  fontFamily: "var(--mono)",
                  color: i === 0 ? TOKENS.ink : TOKENS.muted,
                  borderBottom: i === 0 ? `2px solid ${TOKENS.ink}` : "2px solid transparent",
                  fontWeight: i === 0 ? 600 : 400,
                }}
              >
                {t}
              </span>
            ))}
          </Row>
          <pre
            style={{
              margin: 0,
              padding: "14px 16px",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              lineHeight: 1.65,
              color: TOKENS.ink,
            }}
          >
            <span style={{ color: TOKENS.muted }}>{"  1  "}</span>
            <span style={{ color: "#7e3b8c" }}>id:</span> support-agent{"\n"}
            <span style={{ color: TOKENS.muted }}>{"  2  "}</span>
            <span style={{ color: "#7e3b8c" }}>kind:</span> llm{"\n"}
            <span style={{ color: TOKENS.muted }}>{"  3  "}</span>
            {"\n"}
            <span style={{ color: TOKENS.muted }}>{"  4  "}</span>
            <span style={{ color: "#7e3b8c" }}>model:</span>
            {"\n"}
            <span style={{ color: TOKENS.muted }}>{"  5  "}</span>
            {"  "}
            <span style={{ color: "#7e3b8c" }}>provider:</span> anthropic{"\n"}
            <span style={{ color: TOKENS.muted }}>{"  6  "}</span>
            {"  "}
            <span style={{ color: "#7e3b8c" }}>name:</span> claude-sonnet-4-6{"\n"}
            <span style={{ color: TOKENS.muted }}>{"  7  "}</span>
            {"\n"}
            <span style={{ color: TOKENS.muted }}>{"  8  "}</span>
            <span style={{ color: "#7e3b8c" }}>instruction:</span> |{"\n"}
            <span
              style={{
                background: `rgba(31,122,77,0.12)`,
                color: TOKENS.ok,
                display: "block",
                paddingLeft: 14,
                marginLeft: -16,
              }}
            >
              <span style={{ color: TOKENS.ok, paddingRight: 8 }}>+9</span>
              {"  Hi there! You are a senior support agent."}
              {"\n"}
            </span>
            <span
              style={{
                background: `rgba(154,42,42,0.10)`,
                color: TOKENS.danger,
                display: "block",
                paddingLeft: 14,
                marginLeft: -16,
              }}
            >
              <span style={{ color: TOKENS.danger, paddingRight: 8 }}>-9</span>
              {"  You are a senior support agent."}
              {"\n"}
            </span>
            <span style={{ color: TOKENS.muted }}>{" 10  "}</span>
            {"  "}Read the customer&apos;s message,{"\n"}
            <span style={{ color: TOKENS.muted }}>{" 11  "}</span>
            {"  "}look up history, draft a reply.{"\n"}
          </pre>
          <Row
            gap={8}
            style={{
              padding: "10px 14px",
              borderTop: `1px solid ${TOKENS.line}`,
              background: TOKENS.warm,
            }}
          >
            <Btn primary size="sm">
              Save version
            </Btn>
            <Btn size="sm">Test @latest</Btn>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: TOKENS.muted,
                alignSelf: "center",
              }}
            >
              ⏎ saves a new version
            </span>
          </Row>
        </Stack>

        <Stack gap={0}>
          <Row
            style={{
              padding: "9px 14px",
              borderBottom: `1px solid ${TOKENS.line}`,
              background: TOKENS.surface,
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontFamily: "var(--mono)",
                color: TOKENS.ink,
                fontWeight: 600,
              }}
            >
              Versions
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.muted }}>
              {VERSIONS.length}
            </span>
          </Row>
          {VERSIONS.map((v, i) => (
            <Stack
              key={i}
              gap={6}
              style={{
                padding: "12px 14px",
                borderBottom:
                  i < VERSIONS.length - 1 ? `1px dashed ${TOKENS.line}` : "none",
                background: v.pinned
                  ? ACCENTS.green.bg
                  : v.latest
                    ? ACCENTS[accent].bg
                    : "transparent",
              }}
            >
              <Row gap={8} style={{ alignItems: "center" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: TOKENS.ink }}>
                  {v.ts}
                </span>
                {v.pinned && (
                  <Pill accent="green" dot mono>
                    pinned
                  </Pill>
                )}
                {v.latest && (
                  <Pill accent={accent} dot mono>
                    @latest
                  </Pill>
                )}
              </Row>
              <span style={{ fontSize: 12.5, color: TOKENS.ink, lineHeight: 1.4 }}>{v.note}</span>
              <Row gap={10} style={{ alignItems: "center" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.muted }}>
                  {v.by}
                </span>
                {v.alias && (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: ACCENTS[accent].fg,
                    }}
                  >
                    {v.alias}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {!v.pinned && (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: TOKENS.text2,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      cursor: "pointer",
                    }}
                  >
                    pin ↗
                  </span>
                )}
              </Row>
            </Stack>
          ))}
        </Stack>
      </div>
    </Card>
  );
}
