"use client";

import { type Placeholder, parseUrlPlaceholders } from "@agntz/manifest";
import { useMemo } from "react";

interface PlaceholderPreviewProps {
	url: string;
	pinnedKeys: string[];
}

interface Bucket {
	llm: Array<{ name: string; optional: boolean }>;
	pinned: string[];
}

/**
 * Small caption beneath the URL field that summarises which placeholders the
 * model will be asked to provide versus which are pinned via the `params:`
 * block. Recomputes on every URL/pinnedKeys change. Pure presentation — never
 * touches secret values.
 */
export function PlaceholderPreview({
	url,
	pinnedKeys,
}: PlaceholderPreviewProps) {
	const buckets = useMemo<Bucket>(() => {
		const placeholders: Placeholder[] = url ? parseUrlPlaceholders(url) : [];
		const pinnedSet = new Set(pinnedKeys);
		const llm: Array<{ name: string; optional: boolean }> = [];
		const pinned: string[] = [];
		const seenLlm = new Set<string>();
		const seenPinned = new Set<string>();
		for (const p of placeholders) {
			if (pinnedSet.has(p.name)) {
				if (!seenPinned.has(p.name)) {
					pinned.push(p.name);
					seenPinned.add(p.name);
				}
			} else {
				if (!seenLlm.has(p.name)) {
					llm.push({ name: p.name, optional: p.optional });
					seenLlm.add(p.name);
				}
			}
		}
		return { llm, pinned };
	}, [url, pinnedKeys]);

	if (buckets.llm.length === 0 && buckets.pinned.length === 0) {
		return (
			<span className="mt-1 block text-[11px] text-zinc-400">
				No params extracted yet.
			</span>
		);
	}

	return (
		<span className="mt-1 block text-[11px] text-zinc-500">
			{buckets.llm.length > 0 && (
				<>
					<span className="font-semibold text-zinc-700">LLM will provide:</span>{" "}
					<span className="font-mono">
						{buckets.llm.map((p, i) => (
							<span key={p.name}>
								{p.name}
								{p.optional ? "?" : ""}
								{i < buckets.llm.length - 1 ? ", " : ""}
							</span>
						))}
					</span>
				</>
			)}
			{buckets.llm.length > 0 && buckets.pinned.length > 0 && (
				<span className="mx-2 text-zinc-400">•</span>
			)}
			{buckets.pinned.length > 0 && (
				<>
					<span className="font-semibold text-zinc-700">Pinned:</span>{" "}
					<span className="font-mono">{buckets.pinned.join(", ")}</span>
				</>
			)}
		</span>
	);
}
