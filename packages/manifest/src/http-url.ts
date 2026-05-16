// ═══════════════════════════════════════════════════════════════════════
// HTTP tool URL placeholder parser + builder
//
// URLs in `HTTPToolEntry` may carry placeholders:
//   - `{name}`  — required
//   - `{name?}` — optional (legal in query string only; validator rejects in path)
//
// `parseUrlPlaceholders(url)` returns all placeholders with their position
// (path vs query). `buildHttpUrl(url, values)` builds a final URL: path
// placeholders use `encodeURIComponent`; query placeholders use
// `URLSearchParams`. Optional query placeholders with `undefined` values are
// dropped entirely (no `?key=`). A missing required placeholder throws.
// ═══════════════════════════════════════════════════════════════════════

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\}/g;

export type Placeholder = {
  name: string;
  optional: boolean;
  position: "path" | "query";
};

/**
 * Parse `{name}` / `{name?}` placeholders from a URL template.
 * Position is determined by whether the placeholder appears before or after
 * the first `?` (the URL's query separator). The parser does not validate
 * legality (e.g. `{X?}` in path) — that is the validator's job.
 */
export function parseUrlPlaceholders(url: string): Placeholder[] {
  const queryStart = url.indexOf("?");
  const splitAt = queryStart === -1 ? url.length : queryStart;

  const result: Placeholder[] = [];
  // Reset regex global state (defensive — `matchAll` would do it for us but
  // we're using `exec` to get accurate match indices on each iteration).
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(url)) !== null) {
    const position: "path" | "query" = match.index < splitAt ? "path" : "query";
    result.push({
      name: match[1],
      optional: match[2] === "?",
      position,
    });
  }
  return result;
}

/**
 * Build a final URL from a template + values.
 *
 * Rules:
 *   - Path placeholders: substituted via `encodeURIComponent(value)`. Same
 *     placeholder appearing twice in the path is substituted at every site.
 *   - Query placeholders: built via `URLSearchParams`. Optional query
 *     placeholders whose values are `undefined`/`null` are dropped — no
 *     `?key=` appears in the output.
 *   - Required placeholders missing from `values` throw with a clear message.
 *   - Extra keys in `values` not referenced by any placeholder are ignored
 *     (callers already pin them at runtime via `params:`).
 *   - Plain URLs with no placeholders pass through unchanged.
 */
export function buildHttpUrl(
  urlTemplate: string,
  values: Record<string, string | undefined>
): string {
  const queryStart = urlTemplate.indexOf("?");
  const pathTemplate = queryStart === -1 ? urlTemplate : urlTemplate.slice(0, queryStart);
  const queryTemplate = queryStart === -1 ? "" : urlTemplate.slice(queryStart + 1);

  // ── Path: substitute every {name} / {name?} match.
  const path = pathTemplate.replace(PLACEHOLDER_RE, (_full, rawName: string, opt: string | undefined) => {
    const name = rawName;
    const value = values[name];
    if (value == null) {
      // Path placeholders are validated to be required by the structural
      // validator. If we still hit one here without a value, throw.
      if (opt === "?") {
        // Optional path placeholders shouldn't happen post-validation, but
        // be defensive: substitute the empty string rather than `undefined`.
        return "";
      }
      throw new Error(`Missing required placeholder '${name}' for URL`);
    }
    return encodeURIComponent(value);
  });

  if (queryStart === -1) return path;

  // ── Query: walk the original query template, splitting on `&`. For each
  // pair, decide whether to keep / substitute / drop.
  const params = new URLSearchParams();
  if (queryTemplate.length > 0) {
    for (const pair of queryTemplate.split("&")) {
      if (pair.length === 0) continue;
      const eqIdx = pair.indexOf("=");
      const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
      const rawVal = eqIdx === -1 ? "" : pair.slice(eqIdx + 1);

      // Reset regex state for each pair.
      PLACEHOLDER_RE.lastIndex = 0;
      const valMatch = PLACEHOLDER_RE.exec(rawVal);
      // The simplest, well-defined shape: a query pair is either a literal
      // (`key=value`) or `key={placeholder}` / `key={placeholder?}`. Any
      // other shape (literal mixed with placeholder) we treat as a single
      // template-style substitution: walk the placeholders and substitute.
      const placeholdersInVal: Placeholder[] = [];
      PLACEHOLDER_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PLACEHOLDER_RE.exec(rawVal)) !== null) {
        placeholdersInVal.push({ name: m[1], optional: m[2] === "?", position: "query" });
      }

      if (placeholdersInVal.length === 0) {
        // Literal pair — pass through unchanged.
        params.append(rawKey, rawVal);
        continue;
      }

      // Optional-and-undefined → drop the pair entirely (including the key).
      // Only applies when the pair is exactly `key={name?}` — that is the
      // documented shape for "leave it out entirely".
      if (
        placeholdersInVal.length === 1 &&
        valMatch != null &&
        valMatch[0] === rawVal &&
        valMatch[2] === "?"
      ) {
        const name = valMatch[1];
        const v = values[name];
        if (v == null) continue; // drop key entirely
        params.append(rawKey, v);
        continue;
      }

      // Required, or mixed-literal-and-placeholder: substitute each match.
      const substituted = rawVal.replace(
        PLACEHOLDER_RE,
        (_full, rawName: string, opt: string | undefined) => {
          const v = values[rawName];
          if (v == null) {
            if (opt === "?") return "";
            throw new Error(`Missing required placeholder '${rawName}' for URL`);
          }
          return v;
        },
      );
      params.append(rawKey, substituted);
    }
  }

  const queryStr = params.toString();
  return queryStr.length === 0 ? path : `${path}?${queryStr}`;
}
