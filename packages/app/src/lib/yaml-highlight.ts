/**
 * YAML syntax-highlighting helpers. Shared by the editor and the read-only
 * viewer so edit and view modes look identical.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function splitComment(line: string) {
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "#" && !inSingle && !inDouble) {
      return { content: line.slice(0, index), comment: line.slice(index) };
    }
  }

  return { content: line, comment: "" };
}

function highlightComment(comment: string): string {
  if (!comment) return "";
  return `<span class="text-emerald-700/80">${escapeHtml(comment)}</span>`;
}

function highlightValue(value: string): string {
  if (!value) return "";

  const tokens = value.split(
    /(\s+|"[^"]*"|'[^']*'|\btrue\b|\bfalse\b|\bnull\b|\b-?\d+(?:\.\d+)?\b)/g,
  );

  return tokens
    .filter((t) => t.length > 0)
    .map((token) => {
      if (/^\s+$/.test(token)) return escapeHtml(token);
      if (/^".*"$|^'.*'$/.test(token))
        return `<span class="text-amber-700">${escapeHtml(token)}</span>`;
      if (/^(true|false|null)$/.test(token))
        return `<span class="text-violet-700">${escapeHtml(token)}</span>`;
      if (/^-?\d+(?:\.\d+)?$/.test(token))
        return `<span class="text-rose-700">${escapeHtml(token)}</span>`;
      return `<span class="text-zinc-700">${escapeHtml(token)}</span>`;
    })
    .join("");
}

export function highlightYaml(line: string): string {
  if (!line) return "&nbsp;";

  const { content, comment } = splitComment(line);
  const match = content.match(/^(\s*)(-\s+)?([\w.-]+)(\s*:\s*)(.*)$/);

  if (!match) return highlightValue(content) + highlightComment(comment);

  const [, indentation = "", listPrefix = "", key, separator, rawValue] = match;
  return [
    `<span class="text-zinc-400">${escapeHtml(indentation)}</span>`,
    `<span class="text-zinc-400">${escapeHtml(listPrefix)}</span>`,
    `<span class="text-sky-700">${escapeHtml(key)}</span>`,
    `<span class="text-zinc-400">${escapeHtml(separator)}</span>`,
    highlightValue(rawValue),
    highlightComment(comment),
  ].join("");
}
