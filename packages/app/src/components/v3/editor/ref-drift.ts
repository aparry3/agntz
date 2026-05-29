// Utilities for spotting `{{var}}` references in instruction / prompt /
// template strings that point at names no longer in scope. Used by the
// single-LLM inspector to surface inline warnings before the user saves.

const TEMPLATE_RX = /\{\{\s*([a-zA-Z_$][\w$]*)/g;

/**
 * Extract the unique top-level identifiers referenced by `{{var}}` /
 * `{{var.path}}` templates in `source`. Whitespace before the identifier is
 * tolerated. Only the leading identifier is collected — dotted accesses like
 * `{{step1.output.foo}}` collapse to `step1`.
 */
export function extractTemplateRefs(source: string): string[] {
	if (!source) return [];
	const refs = new Set<string>();
	for (const match of source.matchAll(TEMPLATE_RX)) {
		refs.add(match[1]);
	}
	return Array.from(refs);
}

/**
 * Return the subset of refs in `source` that are not in `inScope`. Built-in
 * names (`userQuery`) are always considered in scope.
 */
export function findBrokenRefs(
	source: string,
	inScope: Iterable<string>,
): string[] {
	const scope = new Set<string>(inScope);
	scope.add("userQuery"); // always available — the raw caller message
	return extractTemplateRefs(source).filter((ref) => !scope.has(ref));
}
