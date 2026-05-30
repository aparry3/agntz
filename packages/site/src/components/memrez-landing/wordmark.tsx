import { ACCENTS } from "../landing/tokens";

export function MemrezWordmark({ size = 22 }: { size?: number }) {
	const accent = ACCENTS.terracotta;
	return (
		<a
			href="/memrez"
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 9,
				textDecoration: "none",
				color: "inherit",
			}}
		>
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden
			>
				<rect
					x="2"
					y="2"
					width="20"
					height="20"
					rx="2.5"
					stroke="currentColor"
					strokeWidth="1.6"
				/>
				<path
					d="M5 17 V7 L9 13 L13 7 V17"
					stroke={accent.fg}
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<circle
					cx="17"
					cy="11"
					r="2.2"
					stroke="currentColor"
					strokeWidth="1.6"
				/>
				<path
					d="M17 13.2 V17"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
				/>
			</svg>
			<span
				style={{
					fontFamily: "var(--mono)",
					fontSize: 15,
					fontWeight: 600,
					letterSpacing: "-0.01em",
				}}
			>
				memrez
			</span>
		</a>
	);
}
