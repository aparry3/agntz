import type { ReactNode } from "react";
import { TOKENS } from "@/components/landing/tokens";
import { CodeBlock } from "@/components/landing/code-block";
import { LanguageCodeBlock, type CodeLanguage, type CodeVariant } from "@/components/language";

export type DocsSection = {
  level: 1 | 2 | 3;
  text: string;
  slug: string;
};

export type ParsedDocs = {
  sections: DocsSection[];
  blocks: Block[];
};

type Block =
  | { kind: "h1"; text: string; slug: string }
  | { kind: "h2"; text: string; slug: string }
  | { kind: "h3"; text: string; slug: string }
  | { kind: "h4"; text: string; slug: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "blockquote"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][]; aligns: ("left" | "center" | "right")[] }
  | { kind: "code"; lang: CodeLanguage; filename?: string; code: string; group?: string }
  | { kind: "codeGroup"; group: string; variants: CodeVariant[] }
  | { kind: "hr" };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

export function parseDocs(markdown: string): ParsedDocs {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  const sections: DocsSection[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ```lang [filename] {group=name}
    const fence = /^```(\w+)?(?:\s+\[([^\]]+)\])?(?:\s+\{group=([A-Za-z0-9_-]+)\})?\s*$/.exec(
      line,
    );
    if (fence) {
      const rawLang = fence[1] ?? "text";
      const filename = fence[2];
      const group = fence[3];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const normalisedLang: CodeLanguage =
        rawLang === "yaml" || rawLang === "yml"
          ? "yaml"
          : rawLang === "python" || rawLang === "py"
            ? "python"
            : rawLang === "bash" || rawLang === "sh" || rawLang === "shell"
              ? "bash"
              : rawLang === "ts" ||
                  rawLang === "tsx" ||
                  rawLang === "js" ||
                  rawLang === "jsx" ||
                  rawLang === "diff"
                ? "ts"
                : "text";
      blocks.push({ kind: "code", lang: normalisedLang, filename, code: buf.join("\n"), group });
      continue;
    }

    // Heading
    const h = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (h) {
      const level = h[1].length as 1 | 2 | 3 | 4;
      const text = h[2];
      const slug = slugify(text);
      blocks.push(
        level === 1
          ? { kind: "h1", text, slug }
          : level === 2
          ? { kind: "h2", text, slug }
          : level === 3
          ? { kind: "h3", text, slug }
          : { kind: "h4", text, slug },
      );
      if (level === 1 || level === 2 || level === 3) sections.push({ level, text, slug });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Blockquote (consume contiguous > lines as one block)
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "blockquote", text: buf.join(" ").trim() });
      continue;
    }

    // Table: header row, separator row, data rows
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const headers = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((cell) => {
        const c = cell.trim();
        if (c.startsWith(":") && c.endsWith(":")) return "center" as const;
        if (c.endsWith(":")) return "right" as const;
        return "left" as const;
      });
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows, aligns });
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^[-*]\s+/, "");
        i++;
        // continuation lines (indented or non-empty without new marker)
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\d+\.\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Blank line — skip
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph (consume until blank or block boundary)
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^-{3,}\s*$/.test(lines[i]) &&
      !/^\s*\|.+\|\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }

  return { sections, blocks: groupCodeBlocks(blocks) };
}

function groupCodeBlocks(blocks: Block[]): Block[] {
  const grouped: Block[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.kind !== "code" || !block.group) {
      grouped.push(block);
      i++;
      continue;
    }

    const variants: CodeVariant[] = [];
    const group = block.group;
    while (i < blocks.length) {
      const candidate = blocks[i];
      if (candidate.kind !== "code" || candidate.group !== group) break;
      variants.push({
        lang: candidate.lang,
        code: candidate.code,
        filename: candidate.filename,
      });
      i++;
    }
    grouped.push({ kind: "codeGroup", group, variants });
  }
  return grouped;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export function renderBlocks(blocks: Block[]): ReactNode {
  return blocks.map((block, i) => {
    switch (block.kind) {
      case "h1":
        return (
          <h1
            key={i}
            id={block.slug}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.1,
              letterSpacing: "-0.025em",
              margin: "0 0 12px",
              color: TOKENS.ink,
            }}
          >
            {renderInline(block.text)}
          </h1>
        );
      case "h2":
        return (
          <h2
            key={i}
            id={block.slug}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 26,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
              margin: "48px 0 16px",
              paddingTop: 12,
              borderTop: `1px solid ${TOKENS.line}`,
              color: TOKENS.ink,
              scrollMarginTop: 80,
            }}
          >
            {renderInline(block.text)}
          </h2>
        );
      case "h3":
        return (
          <h3
            key={i}
            id={block.slug}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1.3,
              letterSpacing: "-0.01em",
              margin: "28px 0 10px",
              color: TOKENS.ink,
              scrollMarginTop: 80,
            }}
          >
            {renderInline(block.text)}
          </h3>
        );
      case "h4":
        return (
          <h4
            key={i}
            id={block.slug}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 15,
              fontWeight: 600,
              margin: "20px 0 6px",
              color: TOKENS.ink,
              scrollMarginTop: 80,
            }}
          >
            {renderInline(block.text)}
          </h4>
        );
      case "p":
        return (
          <p
            key={i}
            style={{
              fontSize: 15,
              lineHeight: 1.7,
              color: TOKENS.ink,
              margin: "0 0 14px",
            }}
          >
            {renderInline(block.text)}
          </p>
        );
      case "ul":
        return (
          <ul
            key={i}
            style={{
              fontSize: 15,
              lineHeight: 1.7,
              color: TOKENS.ink,
              margin: "0 0 16px",
              paddingLeft: 22,
            }}
          >
            {block.items.map((it, k) => (
              <li key={k} style={{ marginBottom: 4 }}>
                {renderInline(it)}
              </li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol
            key={i}
            style={{
              fontSize: 15,
              lineHeight: 1.7,
              color: TOKENS.ink,
              margin: "0 0 16px",
              paddingLeft: 22,
            }}
          >
            {block.items.map((it, k) => (
              <li key={k} style={{ marginBottom: 4 }}>
                {renderInline(it)}
              </li>
            ))}
          </ol>
        );
      case "blockquote":
        return (
          <blockquote
            key={i}
            style={{
              margin: "0 0 16px",
              padding: "12px 16px",
              background: TOKENS.warm,
              border: `1px solid ${TOKENS.line}`,
              borderLeft: `3px solid ${TOKENS.text2}`,
              borderRadius: 6,
              fontSize: 14.5,
              lineHeight: 1.65,
              color: TOKENS.text2,
            }}
          >
            {renderInline(block.text)}
          </blockquote>
        );
      case "table":
        return (
          <div
            key={i}
            style={{
              margin: "0 0 18px",
              overflowX: "auto",
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 8,
              background: TOKENS.surface2,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13.5,
                lineHeight: 1.5,
              }}
            >
              <thead>
                <tr style={{ background: TOKENS.warm }}>
                  {block.headers.map((h, k) => (
                    <th
                      key={k}
                      style={{
                        textAlign: block.aligns[k] ?? "left",
                        padding: "10px 14px",
                        fontWeight: 600,
                        color: TOKENS.ink,
                        borderBottom: `1px solid ${TOKENS.line}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rk) => (
                  <tr key={rk}>
                    {row.map((cell, ck) => (
                      <td
                        key={ck}
                        style={{
                          textAlign: block.aligns[ck] ?? "left",
                          padding: "10px 14px",
                          color: TOKENS.ink,
                          borderTop: rk > 0 ? `1px solid ${TOKENS.line2}` : "none",
                          verticalAlign: "top",
                        }}
                      >
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "code":
        return (
          <div key={i} style={{ margin: "0 0 18px" }}>
            <CodeBlock lang={block.lang} filename={block.filename}>
              {block.code}
            </CodeBlock>
          </div>
        );
      case "codeGroup":
        return (
          <div key={i} style={{ margin: "0 0 18px" }}>
            <LanguageCodeBlock variants={block.variants} />
          </div>
        );
      case "hr":
        return (
          <hr
            key={i}
            style={{
              border: "none",
              borderTop: `1px solid ${TOKENS.line}`,
              margin: "32px 0",
            }}
          />
        );
    }
  });
}

// Inline parsing: code (`), links [t](u), bold (**), italic (*). Bold, link,
// and italic contents are recursively re-parsed so combinations like
// **[Link](/url)** or [**bold link**](/url) render correctly.
export function renderInline(text: string): ReactNode {
  let keySeq = 0;
  const nextKey = () => keySeq++;

  const patterns: Array<{ re: RegExp; fn: (m: RegExpExecArray) => ReactNode }> = [
    {
      re: /`([^`]+)`/,
      fn: (m) => (
        <code
          key={nextKey()}
          style={{
            fontFamily: "var(--mono)",
            fontSize: "0.86em",
            background: TOKENS.line2,
            color: TOKENS.ink,
            padding: "1px 6px",
            borderRadius: 4,
            border: `1px solid ${TOKENS.line}`,
          }}
        >
          {m[1]}
        </code>
      ),
    },
    {
      re: /\[([^\]]+)\]\(([^)]+)\)/,
      fn: (m) => (
        <a
          key={nextKey()}
          href={m[2]}
          style={{
            color: TOKENS.blue,
            textDecoration: "underline",
            textUnderlineOffset: 2,
            textDecorationColor: "rgba(42,74,117,0.4)",
          }}
        >
          {parseInline(m[1])}
        </a>
      ),
    },
    {
      re: /\*\*([^*]+(?:\*[^*]+)*)\*\*/,
      fn: (m) => (
        <strong key={nextKey()} style={{ fontWeight: 600 }}>
          {parseInline(m[1])}
        </strong>
      ),
    },
    {
      // Italic: a single * not preceded or followed by another *, wrapping
      // non-asterisk, non-newline content. Bold pattern (above) wins on overlap
      // because it always starts at the same or lower index.
      re: /(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/,
      fn: (m) => (
        <em key={nextKey()} style={{ fontStyle: "italic" }}>
          {parseInline(m[1])}
        </em>
      ),
    },
  ];

  function parseInline(input: string): ReactNode[] {
    const out: ReactNode[] = [];
    let rest = input;
    while (rest.length > 0) {
      let bestIdx = -1;
      let best: { match: RegExpExecArray; node: ReactNode } | null = null;
      for (const p of patterns) {
        const m = p.re.exec(rest);
        if (m && (bestIdx === -1 || m.index < bestIdx)) {
          bestIdx = m.index;
          best = { match: m, node: p.fn(m) };
        }
      }
      if (best && bestIdx !== -1) {
        if (bestIdx > 0) out.push(rest.slice(0, bestIdx));
        out.push(best.node);
        rest = rest.slice(bestIdx + best.match[0].length);
      } else {
        out.push(rest);
        break;
      }
    }
    return out;
  }

  return parseInline(text);
}
