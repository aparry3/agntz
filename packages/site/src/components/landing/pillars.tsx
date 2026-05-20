import type { ReactNode } from "react";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Card, H2, Lede, Row, Section } from "./primitives";
import { CubeIcon, EyeIcon, PinIcon, ServerIcon } from "./icons";

type PillarItem = {
  title: string;
  kicker: string;
  body: string;
  ic: ReactNode;
  accent?: boolean;
};

const ITEMS: PillarItem[] = [
  {
    title: "Agents as config, not code.",
    kicker: "Principle",
    body: "Define behavior as YAML. Call it from any service with one line. No framework to learn. No glue code.",
    ic: <CubeIcon />,
  },
  {
    title: "Iterate live. Pin what ships.",
    kicker: "Safety · planned",
    body: "Every save will become a new version, stamped with the moment. Production runs the pinned one. Roll back in one click. Shipping in a future release.",
    ic: <PinIcon />,
    accent: true,
  },
  {
    title: "Debug in one place.",
    kicker: "Visibility",
    body: "Every run, every span, every token — traced and replayable in-process. Built in, not a separate $400/mo tool.",
    ic: <EyeIcon />,
  },
  {
    title: "Run it anywhere.",
    kicker: "Trust",
    body: "Node 20+, Docker, your laptop. In-memory by default, swap in SQLite or Postgres when you need persistence — same code, same YAML.",
    ic: <ServerIcon />,
  },
];

export function Pillars({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section id="pillars" kicker="Why agntz — four claims">
      <div
        style={{
          marginBottom: 56,
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H2 size={48} style={{ maxWidth: 720 }}>
          Config. Versioning. Observability.
          <br />
          Portability.
        </H2>
        <Lede style={{ maxWidth: 480 }}>
          The four properties that turn an LLM call into an agent your team can trust in
          production — and the four properties most agent frameworks make you assemble yourself.
        </Lede>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {ITEMS.map((it, i) => (
          <Card
            key={i}
            style={{
              padding: 28,
              background: it.accent ? ACCENTS[accent].bg : TOKENS.surface2,
              borderColor: it.accent ? ACCENTS[accent].line : TOKENS.line,
            }}
          >
            <Row gap={10} style={{ alignItems: "center", marginBottom: 18 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: `1px solid ${it.accent ? ACCENTS[accent].fg : TOKENS.line}`,
                  background: it.accent ? "rgba(255,255,255,0.5)" : TOKENS.warm,
                  color: it.accent ? ACCENTS[accent].fg : TOKENS.ink,
                }}
              >
                {it.ic}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: it.accent ? ACCENTS[accent].fg : TOKENS.muted,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                0{i + 1} · {it.kicker}
              </span>
            </Row>
            <H2 size={26} style={{ marginBottom: 12, fontWeight: 500 }}>
              {it.title}
            </H2>
            <p
              style={{
                margin: 0,
                fontSize: 15,
                lineHeight: 1.6,
                color: TOKENS.text2,
                textWrap: "pretty",
              }}
            >
              {it.body}
            </p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
