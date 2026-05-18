import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Code, H2, Lede, Row, Section, Stack } from "./primitives";

const GROUPS: { h: string; items: string[] }[] = [
  { h: "Models", items: ["Anthropic", "OpenAI", "Google", "Mistral", "Bring your own"] },
  { h: "Runtimes", items: ["Node 20+", "Vercel", "Cloudflare Workers", "Docker", "Kubernetes"] },
  { h: "Stores", items: ["Postgres", "SQLite", "Custom adapter"] },
  { h: "Tools", items: ["MCP", "HTTP", "Local TS", "Agent-as-tool"] },
];

export function Integrations({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section dense kicker="Integrations">
      <H2 size={36} style={{ marginBottom: 12 }}>
        Fits the stack you already have.
      </H2>
      <Lede style={{ marginBottom: 36 }}>
        Confirmed integrations as of <Code>@agntz/sdk@1.0.0</Code>. Custom adapters via a thin
        interface — three methods per store, one per model provider.
      </Lede>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.8fr 1.2fr 0.8fr 0.9fr",
          gap: 32,
          padding: "28px 32px",
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 12,
          background: TOKENS.surface2,
        }}
      >
        {GROUPS.map((g) => (
          <Stack key={g.h} gap={14}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: TOKENS.muted,
              }}
            >
              {g.h}
            </span>
            <Stack gap={6}>
              {g.items.map((it) => (
                <Row key={it} gap={8} style={{ alignItems: "center" }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      background: ACCENTS[accent].fg,
                      opacity: 0.7,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 13.5 }}>{it}</span>
                </Row>
              ))}
            </Stack>
          </Stack>
        ))}
      </div>
    </Section>
  );
}
