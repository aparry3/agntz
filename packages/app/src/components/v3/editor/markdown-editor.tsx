// MarkdownEditor — SSR-safe wrapper around @uiw/react-md-editor used by the
// Instruction tab. The underlying editor is a client-only component, so it's
// loaded via `next/dynamic` with `ssr: false` to avoid hydration mismatches
// from the editor mounting its own DOM.
//
// v4 of the library inlines styles into the JS bundle, so there's no CSS
// import to make. `data-color-mode="light"` keeps it in sync with the
// editor's overall light theme.

"use client";

import { Mono, ag } from "@/components/v3/primitives";
import dynamic from "next/dynamic";
import type { CSSProperties } from "react";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
	ssr: false,
	loading: () => (
		<div
			style={{
				border: `1px solid ${ag.line}`,
				borderRadius: 4,
				padding: "10px 12px",
				background: ag.surface2,
				color: ag.muted,
				fontSize: 11.5,
				fontFamily: "var(--font-mono)",
			}}
		>
			Loading editor…
		</div>
	),
});

export function MarkdownEditor({
	label,
	value,
	onChange,
	placeholder,
	height = 320,
	hint,
	style,
}: {
	label?: string;
	value: string;
	onChange?: (next: string) => void;
	placeholder?: string;
	height?: number;
	hint?: string;
	style?: CSSProperties;
}) {
	return (
		<div style={style}>
			{label && (
				<Mono
					size={10}
					color={ag.muted}
					style={{
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						marginBottom: 5,
						display: "block",
					}}
				>
					{label}
				</Mono>
			)}
			<div
				data-color-mode="light"
				style={{
					border: `1px solid ${ag.line}`,
					borderRadius: 4,
					overflow: "hidden",
					background: ag.surface2,
				}}
			>
				<MDEditor
					value={value}
					onChange={onChange ? (v) => onChange(v ?? "") : undefined}
					height={height}
					textareaProps={{ placeholder, spellCheck: false }}
					preview="edit"
					visibleDragbar={false}
					previewOptions={{ skipHtml: true }}
				/>
			</div>
			{hint && (
				<Mono
					size={10.5}
					color={ag.muted}
					style={{ marginTop: 6, display: "inline-block" }}
				>
					{hint}
				</Mono>
			)}
		</div>
	);
}
