// Local mirror of the manifest interpolate semantics, shared between the
// HTTP tool executor and the auth token resolver. See http-tool.ts top
// comment for the no-cross-package-dep rationale.

type State = Record<string, unknown>;

export function interpolate(template: string, state: State): string {
  return template.replace(/\{\{([^#/}][^}]*?)\}\}/g, (_match, path: string) => {
    const value = resolvePath(state, path.trim());
    if (value == null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

export function interpolateDeep(node: unknown, state: State): unknown {
  if (typeof node === "string") return interpolate(node, state);
  if (Array.isArray(node)) return node.map((n) => interpolateDeep(n, state));
  if (node != null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, state);
    }
    return out;
  }
  return node;
}

function resolvePath(state: State, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = state;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}
