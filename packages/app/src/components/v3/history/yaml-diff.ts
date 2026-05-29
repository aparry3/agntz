// Minimal line-by-line unified diff for two YAML (or any text) blobs.
// Uses an LCS table, then walks it back to produce add/remove/context lines.
// Output is suitable for the unified diff renderer in `history-view.tsx`.
//
// For the file sizes the editor produces (manifests of a few KB), the O(n*m)
// table is fine. If a manifest ever grows past tens of thousands of lines we
// can swap in a Myers implementation, but that's not the regime here.

export type DiffLineKind = "+" | "-" | " " | "h";
export type DiffLine = [DiffLineKind, string];

export interface DiffStat {
	add: number;
	rem: number;
}

/**
 * Compute a unified diff between `before` and `after`, returned as an array
 * of [kind, text] tuples. Hunks of unchanged lines longer than `context * 2`
 * are collapsed and represented as a single `["h", "..."]` separator so the
 * renderer can show a hunk gap.
 */
export function diffLines(
	before: string,
	after: string,
	context = 3,
): DiffLine[] {
	const a = before.split("\n");
	const b = after.split("\n");

	// LCS length table.
	const n = a.length;
	const m = b.length;
	const lcs: number[][] = Array.from({ length: n + 1 }, () =>
		new Array(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			if (a[i] === b[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1;
			else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}

	// Walk back to emit add/remove/context.
	const raw: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			raw.push([" ", a[i]]);
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			raw.push(["-", a[i]]);
			i++;
		} else {
			raw.push(["+", b[j]]);
			j++;
		}
	}
	while (i < n) raw.push(["-", a[i++]]);
	while (j < m) raw.push(["+", b[j++]]);

	// Collapse long runs of context lines. Keep `context` lines around any
	// change; replace the middle with a single hunk separator.
	const isChange = (k: DiffLineKind) => k === "+" || k === "-";
	const changeIdxs: number[] = [];
	raw.forEach(([k], idx) => {
		if (isChange(k)) changeIdxs.push(idx);
	});
	if (changeIdxs.length === 0) {
		return raw.length === 0 ? [] : [["h", "no changes"]];
	}

	const keep = new Set<number>();
	for (const idx of changeIdxs) {
		for (
			let k = Math.max(0, idx - context);
			k <= Math.min(raw.length - 1, idx + context);
			k++
		) {
			keep.add(k);
		}
	}

	const out: DiffLine[] = [];
	let lastKept = -2;
	for (let idx = 0; idx < raw.length; idx++) {
		if (keep.has(idx)) {
			if (idx !== lastKept + 1 && out.length > 0) {
				out.push(["h", `··· ${idx - lastKept - 1} unchanged lines ···`]);
			}
			out.push(raw[idx]);
			lastKept = idx;
		}
	}
	return out;
}

export function diffStat(lines: DiffLine[]): DiffStat {
	let add = 0;
	let rem = 0;
	for (const [k] of lines) {
		if (k === "+") add++;
		else if (k === "-") rem++;
	}
	return { add, rem };
}
