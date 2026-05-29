"use client";

import type { Suggestion } from "@/lib/yaml-context";
import { useEffect, useRef } from "react";

interface CompletionPopoverProps {
	suggestions: Suggestion[];
	activeIndex: number;
	top: number;
	left: number;
	onSelect: (suggestion: Suggestion) => void;
}

export function CompletionPopover({
	suggestions,
	activeIndex,
	top,
	left,
	onSelect,
}: CompletionPopoverProps) {
	const activeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	if (suggestions.length === 0) return null;

	return (
		<div
			className="pointer-events-auto absolute z-20 max-h-64 min-w-[16rem] max-w-sm overflow-auto rounded-xl border border-stone-200 bg-white shadow-md"
			style={{ top, left }}
			role="listbox"
		>
			{suggestions.map((suggestion, index) => (
				<button
					key={`${suggestion.value}-${index}`}
					type="button"
					ref={index === activeIndex ? activeRef : null}
					onMouseDown={(event) => {
						event.preventDefault();
						onSelect(suggestion);
					}}
					className={`block w-full px-3 py-2 text-left font-mono text-xs transition ${
						index === activeIndex
							? "bg-zinc-100 text-zinc-950"
							: "text-zinc-700 hover:bg-stone-50"
					}`}
					role="option"
					aria-selected={index === activeIndex}
				>
					<div className="font-medium">{suggestion.value}</div>
					{suggestion.hint && (
						<div className="mt-0.5 text-[11px] text-zinc-500">
							{suggestion.hint}
						</div>
					)}
				</button>
			))}
		</div>
	);
}
