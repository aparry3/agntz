import { ImageResponse } from "next/og";
import { TOKENS, ACCENTS } from "@/components/landing/tokens";

export const runtime = "edge";
export const alt = "Agntz — Describe your agent. Run it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HERO_YAML = `# agent.yaml — the whole agent, declared.
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
    name: get_forecast`;

type YamlToken = { text: string; color: string };

const YAML_RULES: { re: RegExp; color: string }[] = [
  { re: /#[^\n]*/g, color: "#7c8a7e" },
  { re: /^\s*[\w-]+(?=:)/gm, color: "#7e3b8c" },
  { re: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, color: "#7a5d2a" },
  { re: /\b\d+(?:\.\d+)?\b/g, color: "#1F7A4D" },
];

function tokenizeLine(line: string): YamlToken[] {
  const out: YamlToken[] = [];
  let i = 0;
  while (i < line.length) {
    let matched: YamlToken | null = null;
    for (const r of YAML_RULES) {
      r.re.lastIndex = i;
      const m = r.re.exec(line);
      if (m && m.index === i) {
        matched = { text: m[0], color: r.color };
        break;
      }
    }
    if (matched) {
      out.push(matched);
      i += matched.text.length;
    } else {
      let j = i + 1;
      while (j < line.length) {
        let any = false;
        for (const r of YAML_RULES) {
          r.re.lastIndex = j;
          const m = r.re.exec(line);
          if (m && m.index === j) {
            any = true;
            break;
          }
        }
        if (any) break;
        j++;
      }
      out.push({ text: line.slice(i, j), color: TOKENS.ink });
      i = j;
    }
  }
  return out;
}

function tokenizeYamlLines(code: string): YamlToken[][] {
  return code.split("\n").map(tokenizeLine);
}

async function loadGoogleFont(family: string, weight: number, text: string) {
  const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!match) throw new Error(`failed to resolve ${family} ${weight}: ${css.slice(0, 200)}`);
  const res = await fetch(match[1]);
  if (!res.ok) throw new Error(`failed to fetch ${family} ${weight}`);
  return res.arrayBuffer();
}

function uniqueChars(...inputs: string[]): string {
  return Array.from(new Set(inputs.join(""))).join("");
}

export default async function Image() {
  const purple = ACCENTS.purple;
  const green = ACCENTS.green;

  const headlineText = "Describe your agent. Run it.";
  const ledeText =
    "A declarative runtime for production agents. Define agents in YAML, call your existing APIs, and run anywhere.";
  const monoText =
    "agntz agntz.co v1.0.0 — released declarative runtime open source local hosted self-host valid · ready to run weather-bot.yaml runner.ts agent.yaml";

  const sansGlyphs = uniqueChars(headlineText, ledeText);
  const monoGlyphs = uniqueChars(monoText, HERO_YAML);

  const [sansRegular, sansMedium, monoRegular, monoMedium] = await Promise.all([
    loadGoogleFont("Geist", 400, sansGlyphs),
    loadGoogleFont("Geist", 500, sansGlyphs),
    loadGoogleFont("Geist+Mono", 400, monoGlyphs),
    loadGoogleFont("Geist+Mono", 600, monoGlyphs),
  ]);

  const lines = tokenizeYamlLines(HERO_YAML);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: TOKENS.bg,
          fontFamily: "Geist",
          color: TOKENS.ink,
          padding: "56px 64px",
          position: "relative",
        }}
      >
        {/* faint grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage: `linear-gradient(${TOKENS.line} 1px, transparent 1px), linear-gradient(90deg, ${TOKENS.line} 1px, transparent 1px)`,
            backgroundSize: "56px 56px",
            opacity: 0.45,
          }}
        />

        {/* wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            height: 40,
          }}
        >
          <div style={{ display: "flex", width: 34, height: 34 }}>
            <svg width={34} height={34} viewBox="0 0 24 24" fill="none">
              <rect
                x="2"
                y="2"
                width="20"
                height="20"
                rx="2.5"
                stroke={TOKENS.ink}
                strokeWidth="1.6"
              />
              <path
                d="M7 16 L11 8 L13 8 L17 16 M9 13 H15"
                stroke={TOKENS.ink}
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Geist Mono",
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: TOKENS.ink,
              lineHeight: 1,
            }}
          >
            agntz
          </div>
        </div>

        {/* main row */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            gap: 56,
            marginTop: 56,
            position: "relative",
          }}
        >
          {/* left column */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 560,
              gap: 22,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: `1px solid ${green.line}`,
                  background: green.bg,
                  color: green.fg,
                  fontFamily: "Geist Mono",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 99,
                    background: green.fg,
                  }}
                />
                v1.0.0 — released
              </div>
              <div
                style={{
                  display: "flex",
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: `1px solid ${TOKENS.line}`,
                  background: TOKENS.surface,
                  color: TOKENS.text2,
                  fontFamily: "Geist Mono",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                declarative runtime
              </div>
              <div
                style={{
                  display: "flex",
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: `1px solid ${TOKENS.line}`,
                  background: TOKENS.surface,
                  color: TOKENS.text2,
                  fontFamily: "Geist Mono",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                open source
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: 68,
                fontWeight: 500,
                lineHeight: 1.02,
                letterSpacing: "-0.04em",
              }}
            >
              <span>Describe your agent.</span>
              <span style={{ color: TOKENS.muted }}>Run it.</span>
            </div>

            <div
              style={{
                display: "flex",
                fontSize: 20,
                lineHeight: 1.45,
                color: TOKENS.text2,
                maxWidth: 540,
              }}
            >
              {ledeText}
            </div>
          </div>

          {/* right column — code card */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 14,
              overflow: "hidden",
              boxShadow:
                "0 24px 60px rgba(26,25,22,0.10), 0 4px 14px rgba(26,25,22,0.05)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: TOKENS.warm,
                borderBottom: `1px solid ${TOKENS.line}`,
                padding: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "13px 20px",
                  background: TOKENS.surface,
                  borderRight: `1px solid ${TOKENS.line}`,
                  borderBottom: `2px solid ${TOKENS.ink}`,
                  marginBottom: -1,
                  fontFamily: "Geist Mono",
                  fontSize: 13,
                  fontWeight: 600,
                  color: TOKENS.ink,
                }}
              >
                agent.yaml
              </div>
              <div
                style={{
                  display: "flex",
                  padding: "13px 20px",
                  fontFamily: "Geist Mono",
                  fontSize: 13,
                  color: TOKENS.muted,
                }}
              >
                runner.ts
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "20px 22px",
                fontFamily: "Geist Mono",
                fontSize: 14,
                lineHeight: 1.5,
                color: TOKENS.ink,
              }}
            >
              {lines.map((lineTokens, li) => (
                <div
                  key={li}
                  style={{
                    display: "flex",
                    minHeight: 21,
                    whiteSpace: "pre",
                  }}
                >
                  {lineTokens.length === 0 ? (
                    <span> </span>
                  ) : (
                    lineTokens.map((tk, k) => (
                      <span key={k} style={{ color: tk.color, whiteSpace: "pre" }}>
                        {tk.text}
                      </span>
                    ))
                  )}
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 16px",
                borderTop: `1px solid ${TOKENS.line}`,
                background: TOKENS.warm,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: green.fg,
                  }}
                />
                <span
                  style={{
                    fontFamily: "Geist Mono",
                    fontSize: 12,
                    color: TOKENS.text2,
                  }}
                >
                  valid · ready to run
                </span>
              </div>
              <span
                style={{
                  fontFamily: "Geist Mono",
                  fontSize: 11.5,
                  color: TOKENS.muted,
                }}
              >
                weather-bot.yaml
              </span>
            </div>
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 24,
            position: "relative",
          }}
        >
          <span
            style={{
              fontFamily: "Geist Mono",
              fontSize: 15,
              color: TOKENS.text2,
              letterSpacing: "0.02em",
            }}
          >
            agntz.co
          </span>
          <span
            style={{
              display: "flex",
              padding: "5px 12px",
              borderRadius: 999,
              border: `1px solid ${purple.line}`,
              background: purple.bg,
              color: purple.fg,
              fontFamily: "Geist Mono",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            local · hosted · self-host
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: sansRegular, weight: 400, style: "normal" },
        { name: "Geist", data: sansMedium, weight: 500, style: "normal" },
        { name: "Geist Mono", data: monoRegular, weight: 400, style: "normal" },
        { name: "Geist Mono", data: monoMedium, weight: 600, style: "normal" },
      ],
    },
  );
}
