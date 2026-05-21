import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Card, H2, Lede, Pill, Row, Section } from "./primitives";
import { ArrowIcon } from "./icons";
import { CodeBlock } from "./code-block";

const LIB_CODE = `// With a library — you wire the agent yourself.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const tools = [{
  name: 'get_forecast',
  description: 'Current weather for a coordinate.',
  input_schema: {
    type: 'object',
    properties: {
      latitude:  { type: 'number' },
      longitude: { type: 'number' },
      current_weather: { type: 'boolean' },
    },
    required: ['latitude', 'longitude'],
  },
}];

async function callTool(name, args) {
  if (name !== 'get_forecast') throw new Error('unknown');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  for (const [k, v] of Object.entries(args)) {
    url.searchParams.set(k, String(v));
  }
  const r = await fetch(url);
  return await r.json();
}

let messages = [{ role: 'user', content: input.message }];
let safety = 0;

while (safety++ < 10) {
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    system: 'You are a friendly weather assistant...',
    tools, messages, max_tokens: 1024,
  });

  // You own retries, token windowing, summarization,
  // session persistence, tracing, error handling...

  if (resp.stop_reason === 'end_turn') break;
  const uses = resp.content.filter(b => b.type === 'tool_use');
  const results = await Promise.all(
    uses.map(async u => ({
      type: 'tool_result',
      tool_use_id: u.id,
      content: JSON.stringify(await callTool(u.name, u.input)),
    })),
  );
  messages = [...messages,
    { role: 'assistant', content: resp.content },
    { role: 'user',      content: results }];
}`;

const AGNTZ_CODE = `# With agntz — the runtime owns the loop.
id: weather-bot
kind: llm

model:
  provider: anthropic
  name: claude-sonnet-4-6

instruction: |
  You are a friendly weather assistant.
  When asked about a city, look up the
  forecast and reply in plain language.

tools:
  - kind: http
    name: get_forecast
    description: Current weather for a coordinate.
    url: "https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather={current_weather?}"
    method: GET`;

const ROWS: [string, string][] = [
  ["200+ lines of TypeScript", "30 lines of YAML"],
  ["Import, compose, wire tools", "Define, run"],
  ["You own the agent loop", "The runtime owns the loop"],
  ["Hand-write tool adapters", "Point at your OpenAPI or manifest"],
  ["Build session + context handling", "Sessions handled, context windowed"],
];

export function TheShift({ accent = "blue" }: { accent?: AccentName }) {
  const a = ACCENTS[accent];

  return (
    <Section id="shift" kicker="The shift" style={{ background: TOKENS.surface }}>
      <div
        style={{
          marginBottom: 56,
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H2 size={56} style={{ letterSpacing: "-0.035em" }}>
          A runtime,
          <br />
          <span style={{ color: TOKENS.muted }}>not a library.</span>
        </H2>
        <Lede>
          Other frameworks hand you primitives and ask you to build the agent.{" "}
          <b style={{ color: TOKENS.ink, fontWeight: 600 }}>
            agntz <i>is</i> the agent
          </b>{" "}
          — you describe it, the runtime runs it.
        </Lede>
      </div>

      <Card style={{ overflow: "hidden", marginBottom: 28 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            borderBottom: `1px solid ${TOKENS.line}`,
            background: TOKENS.warm,
          }}
        >
          <div style={{ padding: "18px 22px" }}>
            <Row gap={8} style={{ alignItems: "center", marginBottom: 4 }}>
              <span
                style={{ width: 8, height: 8, borderRadius: 2, background: TOKENS.muted }}
              />
              <span style={{ fontWeight: 600, fontSize: 15 }}>With a library</span>
              <Pill mono style={{ marginLeft: 4 }}>
                @anthropic-ai/sdk
              </Pill>
            </Row>
            <span style={{ fontSize: 13, color: TOKENS.text2 }}>
              Primitives. You build the agent.
            </span>
          </div>
          <div
            style={{
              padding: "18px 22px",
              borderLeft: `1px solid ${TOKENS.line}`,
              background: a.bg,
            }}
          >
            <Row gap={8} style={{ alignItems: "center", marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: a.fg }} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>With agntz</span>
              <Pill accent={accent} mono style={{ marginLeft: 4 }}>
                declarative runtime
              </Pill>
            </Row>
            <span style={{ fontSize: 13, color: TOKENS.text2 }}>
              Description. The runtime runs it.
            </span>
          </div>
        </div>
        {ROWS.map((r, i) => (
          <div
            key={r[0]}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              borderBottom: i < ROWS.length - 1 ? `1px solid ${TOKENS.line2}` : "none",
              background: i % 2 === 1 ? TOKENS.warm : TOKENS.surface2,
            }}
          >
            <div
              style={{
                padding: "16px 22px",
                fontSize: 14,
                color: TOKENS.text2,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: TOKENS.muted,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  width: 16,
                }}
              >
                0{i + 1}
              </span>
              {r[0]}
            </div>
            <div
              style={{
                padding: "16px 22px",
                borderLeft: `1px solid ${TOKENS.line2}`,
                fontSize: 14,
                fontWeight: 500,
                color: TOKENS.ink,
                background: a.bg + "55",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ color: a.fg, display: "inline-flex" }}>
                <ArrowIcon />
              </span>
              {r[1]}
            </div>
          </div>
        ))}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div>
          <Row gap={8} style={{ alignItems: "center", marginBottom: 10 }}>
            <Pill mono>before</Pill>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: TOKENS.muted,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              imperative · same weather-bot, hand-wired
            </span>
          </Row>
          <CodeBlock filename="weather-bot.ts" lang="ts">
            {LIB_CODE}
          </CodeBlock>
        </div>
        <div>
          <Row gap={8} style={{ alignItems: "center", marginBottom: 10 }}>
            <Pill accent={accent} dot mono>
              after
            </Pill>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: a.fg,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              declarative · same weather-bot, described
            </span>
          </Row>
          <CodeBlock filename="weather-bot.yaml" lang="yaml" wrap>
            {AGNTZ_CODE}
          </CodeBlock>
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 8,
              background: TOKENS.surface2,
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              color: TOKENS.text2,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ color: TOKENS.muted }}>$</span>
            <span style={{ color: TOKENS.ink }}>runner.run(sessionId)</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: TOKENS.muted }}>// that&apos;s the whole loop</span>
          </div>
        </div>
      </div>
    </Section>
  );
}
