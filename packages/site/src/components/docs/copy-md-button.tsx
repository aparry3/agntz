"use client";

import { TOKENS } from "@/components/landing/tokens";
import { useState } from "react";

export function CopyMarkdownButton({
	markdown,
	rawHref,
}: {
	markdown: string;
	rawHref: string;
}) {
	const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

	async function onCopy() {
		try {
			await navigator.clipboard.writeText(markdown);
			setStatus("copied");
			setTimeout(() => setStatus("idle"), 1800);
		} catch {
			setStatus("error");
			setTimeout(() => setStatus("idle"), 1800);
		}
	}

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginBottom: 18,
				fontFamily: "var(--mono)",
				fontSize: 11.5,
			}}
		>
			<button
				type="button"
				onClick={onCopy}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					padding: "5px 10px",
					background: status === "copied" ? TOKENS.okBg : TOKENS.surface2,
					color: status === "copied" ? TOKENS.ok : TOKENS.ink,
					border: `1px solid ${status === "copied" ? TOKENS.ok : TOKENS.line}`,
					borderRadius: 6,
					cursor: "pointer",
					fontFamily: "var(--mono)",
					fontSize: 11.5,
					letterSpacing: "0.02em",
				}}
			>
				<CopyIcon copied={status === "copied"} />
				{status === "copied"
					? "Copied"
					: status === "error"
						? "Failed"
						: "Copy as markdown"}
			</button>
			<a
				href={rawHref}
				style={{
					color: TOKENS.text2,
					textDecoration: "none",
					padding: "5px 10px",
					border: `1px solid ${TOKENS.line}`,
					borderRadius: 6,
					background: TOKENS.surface2,
				}}
			>
				View .md
			</a>
			<span style={{ color: TOKENS.muted, fontSize: 11 }}>
				Optimized for LLMs — paste directly into ChatGPT, Claude, or Cursor.
			</span>
		</div>
	);
}

function CopyIcon({ copied }: { copied: boolean }) {
	if (copied) {
		return (
			<svg
				width="12"
				height="12"
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M3.5 8.5L6.5 11.5L12.5 5.5"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
		>
			<rect
				x="4.5"
				y="4.5"
				width="8"
				height="8"
				rx="1.2"
				stroke="currentColor"
				strokeWidth="1.4"
			/>
			<path
				d="M3 11V4a1.5 1.5 0 0 1 1.5-1.5H10"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}
