"use client";

import type { ReactNode } from "react";
import { CubeIcon, EyeIcon, PinIcon, SparkIcon } from "../landing/icons";
import { Card, H2, Lede, Row, Section, Stack } from "../landing/primitives";
import { ACCENTS, TOKENS } from "../landing/tokens";
import { usePreferredLanguage } from "../language";

type Step = {
	n: number;
	kicker: string;
	title: string;
	body: string;
	icon: ReactNode;
	snippet: string[];
	snippetPy?: string[];
};

const STEPS: Step[] = [
	{
		n: 1,
		kicker: "Scan",
		title: "Where's the knowledge?",
		body: "A cheap deterministic call returns a topic TOC for everything visible inside the grant — names, live counts, curator-maintained blurbs. Bootstraps context cheaply, no LLM round-trip required.",
		icon: <EyeIcon />,
		snippet: [
			"const { topics } =",
			"  await memrez.scan(grants);",
			"// → [{ topic: 'billing', count: 4 },",
			"//    { topic: 'prefs',   count: 7 }]",
		],
		snippetPy: [
			"result = memrez.scan(grants)",
			"# → [{'topic': 'billing', 'count': 4},",
			"#    {'topic': 'prefs',   'count': 7}]",
		],
	},
	{
		n: 2,
		kicker: "Read",
		title: "Pull the topic you need.",
		body: "The model picks a topic; the runtime pulls matching entries, scoped to the grant. Ancestor scopes flow down (shared knowledge); siblings stay isolated (no cross-tenant leaks).",
		icon: <PinIcon />,
		snippet: [
			"const entries =",
			"  await memrez.read(grants, 'prefs', {",
			"    limit: 20,",
			"  });",
			"// → 'Prefers morning slots.'",
			"// → 'Pays via invoice, not card.'",
		],
		snippetPy: [
			"entries = memrez.read(",
			"    grants, 'prefs', limit=20,",
			")",
			"# → 'Prefers morning slots.'",
			"# → 'Pays via invoice, not card.'",
		],
	},
	{
		n: 3,
		kicker: "Write",
		title: "Hand it a fact. Move on.",
		body: "A cheap tagger assigns topics and dedupes inline. Heavy reconciliation — merging dupes, resolving contradictions, refreshing blurbs — runs later in curate, off the hot path.",
		icon: <SparkIcon />,
		snippet: [
			"await memrez.write(grants,",
			"  'Prefers email over phone.');",
			"// → tagged ['prefs', 'contact']",
			"// → appended.",
		],
		snippetPy: [
			"memrez.write(grants,",
			"    'Prefers email over phone.')",
			"# → tagged ['prefs', 'contact']",
			"# → appended.",
		],
	},
];

export function MemrezTheLoop() {
	const a = ACCENTS.terracotta;
	const { language } = usePreferredLanguage();
	const steps = STEPS.map((step) =>
		language === "python" && step.snippetPy
			? { ...step, snippet: step.snippetPy }
			: step,
	);

	return (
		<Section id="loop" kicker="The loop">
			<div
				style={{
					marginBottom: 56,
					display: "grid",
					gridTemplateColumns: "1.1fr 0.9fr",
					gap: 64,
					alignItems: "end",
				}}
			>
				<H2 size={56} style={{ letterSpacing: "-0.035em" }}>
					Scan. Read. Write.
				</H2>
				<Lede>
					Three deterministic verbs cover the full hot path. Tags are the index.
					The model never sees the namespace — it sees a topic TOC, picks one,
					reads what it needs.
				</Lede>
			</div>

			<div style={{ position: "relative" }}>
				<div
					aria-hidden
					style={{
						position: "absolute",
						top: 32,
						left: "12%",
						right: "12%",
						height: 1,
						background: `repeating-linear-gradient(90deg, ${TOKENS.line} 0 6px, transparent 6px 12px)`,
						zIndex: 0,
					}}
				/>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr 1fr",
						gap: 20,
						position: "relative",
					}}
				>
					{steps.map((s) => (
						<Card
							key={s.n}
							style={{
								padding: 26,
								background: TOKENS.surface2,
								borderColor: TOKENS.line,
								color: TOKENS.ink,
								display: "flex",
								flexDirection: "column",
								gap: 18,
								minHeight: 340,
							}}
						>
							<Row gap={12} style={{ alignItems: "center" }}>
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										width: 36,
										height: 36,
										borderRadius: 99,
										background: TOKENS.warm,
										border: `1px solid ${TOKENS.line}`,
										color: TOKENS.ink,
										fontFamily: "var(--mono)",
										fontSize: 13,
										fontWeight: 600,
									}}
								>
									{s.n}
								</span>
								<Stack gap={2}>
									<span
										style={{
											fontFamily: "var(--mono)",
											fontSize: 10.5,
											letterSpacing: "0.18em",
											textTransform: "uppercase",
											color: TOKENS.muted,
										}}
									>
										step 0{s.n}
									</span>
									<span
										style={{
											fontFamily: "var(--mono)",
											fontSize: 12,
											letterSpacing: "0.04em",
											color: TOKENS.ink,
										}}
									>
										{s.kicker}
									</span>
								</Stack>
							</Row>

							<H2 size={24} style={{ fontWeight: 500, lineHeight: 1.15 }}>
								{s.title}
							</H2>

							<p
								style={{
									margin: 0,
									fontSize: 14,
									lineHeight: 1.6,
									color: TOKENS.text2,
									textWrap: "pretty",
									flex: 1,
								}}
							>
								{s.body}
							</p>

							<pre
								style={{
									margin: 0,
									padding: "12px 14px",
									fontFamily: "var(--mono)",
									fontSize: 11.5,
									lineHeight: 1.65,
									color: TOKENS.text2,
									background: TOKENS.surface,
									border: `1px solid ${TOKENS.line}`,
									borderRadius: 6,
									whiteSpace: "pre",
									overflow: "hidden",
								}}
							>
								{s.snippet.join("\n")}
							</pre>
						</Card>
					))}
				</div>
			</div>

			<Row
				gap={14}
				style={{
					marginTop: 32,
					padding: "16px 20px",
					background: TOKENS.surface2,
					border: `1px solid ${TOKENS.line}`,
					borderRadius: 10,
					alignItems: "center",
				}}
			>
				<span style={{ color: a.fg, display: "inline-flex" }}>
					<CubeIcon />
				</span>
				<span
					style={{
						fontSize: 14,
						color: TOKENS.text2,
						flex: 1,
						lineHeight: 1.5,
					}}
				>
					<b style={{ color: TOKENS.ink, fontWeight: 600 }}>
						The model never names a namespace.
					</b>{" "}
					The grant decides where writes land — <code>a/b/c</code> and its
					descendants by default. Ancestor promotion is opt-in, never automatic.
				</span>
				<a
					href="#capabilities"
					style={{
						color: a.fg,
						fontSize: 13.5,
						textDecoration: "none",
						fontWeight: 500,
						borderBottom: `1px solid ${a.line}`,
						paddingBottom: 2,
						whiteSpace: "nowrap",
					}}
				>
					See capability cards →
				</a>
			</Row>
		</Section>
	);
}
