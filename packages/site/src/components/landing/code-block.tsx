import type { CSSProperties, ReactNode } from "react";
import { TOKENS } from "./tokens";
import { CodeIcon } from "./icons";
import { CopyCodeButton } from "./copy-code-button";

type Token = { text: string; color: string | null };
type Rule = { re: RegExp; color: string };

function tokenize(code: string, rules: Rule[], fallbackColor: string): Token[] {
  const out: Token[] = [];
  const lines = code.split("\n");
  lines.forEach((line, lineIdx) => {
    let i = 0;
    while (i < line.length) {
      let matched: Token | null = null;
      for (const r of rules) {
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
          for (const r of rules) {
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
        out.push({ text: line.slice(i, j), color: fallbackColor });
        i = j;
      }
    }
    if (lineIdx < lines.length - 1) out.push({ text: "\n", color: null });
  });
  return out;
}

const TS_RULES: Rule[] = [
  { re: /\/\/[^\n]*/g, color: "#7c8a7e" },
  { re: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, color: "#7a5d2a" },
  {
    re: /\b(import|from|const|let|var|async|await|return|new|export|default|function|if|else|true|false|null|undefined)\b/g,
    color: "#7e3b8c",
  },
  { re: /\bprocess|\benv\b/g, color: "#7e3b8c" },
  { re: /\b\d+(?:\.\d+)?\b/g, color: "#1F7A4D" },
  { re: /\b([A-Z][A-Za-z0-9_]*)\b/g, color: "#2A4A75" },
];

const YAML_RULES: Rule[] = [
  { re: /#[^\n]*/g, color: "#7c8a7e" },
  { re: /^\s*[\w-]+(?=:)/gm, color: "#7e3b8c" },
  { re: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, color: "#7a5d2a" },
  { re: /\b\d+(?:\.\d+)?\b/g, color: "#1F7A4D" },
];

export function highlightTS(code: string): ReactNode[] {
  return renderTokens(String(code ?? ""), TS_RULES);
}

export function highlightYAML(code: string): ReactNode[] {
  return renderTokens(String(code ?? ""), YAML_RULES);
}

function renderTokens(code: string, rules: Rule[]): ReactNode[] {
  const tokens = tokenize(code, rules, "#1A1916");
  return tokens.map((tk, k) =>
    tk.color ? (
      <span key={k} style={{ color: tk.color }}>
        {tk.text}
      </span>
    ) : (
      <span key={k}>{tk.text}</span>
    ),
  );
}

export function CodeBlock({
  children,
  lang = "ts",
  filename,
  copy = true,
  wrap = false,
  style,
}: {
  children: string;
  lang?: "ts" | "yaml";
  filename?: string;
  copy?: boolean;
  wrap?: boolean;
  style?: CSSProperties;
}) {
  const code = String(children).replace(/^\n/, "").replace(/\n$/, "");
  const hl = lang === "yaml" ? renderTokens(code, YAML_RULES) : renderTokens(code, TS_RULES);
  return (
    <div
      style={{
        background: TOKENS.surface,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 1px 0 rgba(26,25,22,0.04)",
        ...style,
      }}
    >
      {filename && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderBottom: `1px solid ${TOKENS.line}`,
            background: TOKENS.warm,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: TOKENS.text2, display: "inline-flex" }}>
              <CodeIcon />
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: TOKENS.ink,
                letterSpacing: "0.01em",
              }}
            >
              {filename}
            </span>
          </div>
          {copy && <CopyCodeButton text={code} />}
        </div>
      )}
      <pre
        style={{
          margin: 0,
          padding: "16px 18px",
          fontFamily: "var(--mono)",
          fontSize: 12.5,
          lineHeight: 1.7,
          color: TOKENS.ink,
          overflowX: "auto",
          whiteSpace: wrap ? "pre-wrap" : "pre",
          overflowWrap: wrap ? "anywhere" : "normal",
        }}
      >
        <code>{hl}</code>
      </pre>
    </div>
  );
}
