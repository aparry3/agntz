import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Card, Code, H2, Lede, Pill, Row, Section, Stack } from "./primitives";
import { BranchIcon } from "./icons";
import { CodeBlock } from "./code-block";

const COMPOSITION_CODE = `id: article-pipeline
kind: sequential

steps:
  - agent:
      id: research
      kind: parallel
      branches:
        - agent: { id: web-researcher,      kind: llm }
        - agent: { id: academic-researcher, kind: llm }

  - agent:
      id: write-review
      kind: sequential
      until: '{{editor.approved}} == true'
      maxIterations: 3
      steps:
        - agent: { id: writer, kind: llm }
        - agent: { id: editor, kind: llm }`;

export function CompositionSpotlight({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section id="composition" kicker="Spotlight · 03 — Composition">
      <div
        style={{
          marginBottom: 48,
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H2 size={48}>
          From one agent <br />
          to many.
        </H2>
        <Lede>
          A <Code>sequential</Code> agent runs steps in order. A <Code>parallel</Code> agent runs
          branches concurrently. Loop with <Code>until</Code>. Same YAML, same runtime, same
          traces — whether your agent is one model call or twelve.
        </Lede>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 24 }}>
        <CodeBlock filename="article-pipeline.yaml" lang="yaml">
          {COMPOSITION_CODE}
        </CodeBlock>

        <CompositionTrace accent={accent} />
      </div>
    </Section>
  );
}

type CompRow = { d: number; n: string; k: string; w: number; o: number; c: string };

function CompositionTrace({ accent }: { accent: AccentName }) {
  const rows: CompRow[] = [
    { d: 0, n: "article-pipeline", k: "sequential", w: 100, o: 0, c: TOKENS.ink },
    { d: 1, n: "research", k: "parallel", w: 42, o: 0, c: ACCENTS[accent].fg },
    { d: 2, n: "web-researcher", k: "llm", w: 36, o: 2, c: ACCENTS.purple.fg },
    { d: 2, n: "academic-researcher", k: "llm", w: 40, o: 1, c: ACCENTS.purple.fg },
    { d: 1, n: "write-review · iter 1", k: "sequential", w: 28, o: 42, c: ACCENTS.amber.fg },
    { d: 2, n: "writer", k: "llm", w: 18, o: 43, c: ACCENTS.purple.fg },
    { d: 2, n: "editor", k: "llm", w: 9, o: 61, c: ACCENTS.purple.fg },
    { d: 1, n: "write-review · iter 2", k: "sequential", w: 28, o: 71, c: ACCENTS.amber.fg },
    { d: 2, n: "writer", k: "llm", w: 19, o: 72, c: ACCENTS.purple.fg },
    { d: 2, n: "editor ✓", k: "llm", w: 7, o: 91, c: ACCENTS.green.fg },
  ];
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
          <BranchIcon />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: TOKENS.text2 }}>
            Trace — article-pipeline · iter 2/3
          </span>
        </Row>
        <Pill accent="green" dot mono>
          completed · 12.4s
        </Pill>
      </Row>
      <Stack gap={4} style={{ padding: "14px 14px 16px" }}>
        <Row
          style={{
            marginBottom: 4,
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: TOKENS.muted,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          <span style={{ width: 230 }}>span</span>
          <span style={{ flex: 1 }}>12.4s</span>
        </Row>
        {rows.map((r, i) => (
          <Row key={i} style={{ alignItems: "center" }}>
            <Row gap={6} style={{ alignItems: "center", width: 230, paddingLeft: r.d * 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: 1, background: r.c, flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: TOKENS.muted }}>
                {r.k}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  color: TOKENS.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontWeight: r.d === 0 ? 600 : 400,
                }}
              >
                {r.n}
              </span>
            </Row>
            <div style={{ flex: 1, position: "relative", height: 12 }}>
              <div
                style={{
                  position: "absolute",
                  left: `${r.o}%`,
                  width: `${r.w}%`,
                  top: 2,
                  bottom: 2,
                  background: r.c,
                  opacity: r.d === 0 ? 1 : 0.85,
                  borderRadius: 2,
                  minWidth: 2,
                }}
              />
            </div>
          </Row>
        ))}
        <Row
          gap={14}
          style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${TOKENS.line}` }}
        >
          <Row gap={6} style={{ alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: TOKENS.ink }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.text2 }}>
              sequential
            </span>
          </Row>
          <Row gap={6} style={{ alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: ACCENTS[accent].fg }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.text2 }}>
              parallel
            </span>
          </Row>
          <Row gap={6} style={{ alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: ACCENTS.purple.fg }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.text2 }}>
              model.call
            </span>
          </Row>
          <Row gap={6} style={{ alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: ACCENTS.green.fg }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.text2 }}>
              editor.approved
            </span>
          </Row>
        </Row>
      </Stack>
    </Card>
  );
}
