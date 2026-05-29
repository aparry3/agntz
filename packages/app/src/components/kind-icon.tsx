import { ag } from "@/components/v3/primitives";
import type { SpanKind } from "@agntz/core";

const PALETTE: Record<
	SpanKind,
	{ glyph: string; bg: string; fg: string; label: string }
> = {
	run: { glyph: "◉", bg: ag.purpleBg, fg: ag.purple, label: "Run" },
	manifest: { glyph: "▣", bg: ag.line2, fg: ag.text2, label: "Manifest" },
	step: { glyph: "▶", bg: ag.blueBg, fg: ag.blue, label: "Step" },
	invoke: { glyph: "✦", bg: ag.blueBg, fg: ag.blue, label: "Invoke" },
	model: { glyph: "✺", bg: ag.warnBg, fg: ag.warn, label: "Model" },
	tool: { glyph: "⚙", bg: ag.okBg, fg: ag.ok, label: "Tool" },
};

export function KindIcon({
	kind,
	size = 12,
}: { kind: SpanKind; size?: number }) {
	const g = PALETTE[kind];
	return (
		<span
			style={{
				fontFamily: "var(--font-mono)",
				color: g.fg,
				fontSize: size,
				width: 14,
				display: "inline-block",
				textAlign: "center",
				lineHeight: 1,
			}}
			title={g.label}
			aria-label={g.label}
		>
			{g.glyph}
		</span>
	);
}

export function KindChip({ kind }: { kind: SpanKind }) {
	const g = PALETTE[kind];
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				background: g.bg,
				color: g.fg,
				padding: "2px 7px",
				borderRadius: 3,
				fontSize: 10.5,
				fontWeight: 500,
				fontFamily: "var(--font-mono)",
				letterSpacing: 0,
			}}
		>
			{g.glyph} {kind}
		</span>
	);
}

export function kindColor(kind: SpanKind): string {
	return PALETTE[kind].fg;
}

export function kindBgColor(kind: SpanKind): string {
	return PALETTE[kind].bg;
}
