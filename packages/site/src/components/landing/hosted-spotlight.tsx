import { ArrowIcon } from "./icons";
import { Btn, H2, Lede, Row, Section } from "./primitives";
import { type AccentName, TOKENS } from "./tokens";

export function HostedSpotlight({ accent = "blue" }: { accent?: AccentName }) {
	// accent is part of the section's public API; not visually consumed in this layout
	void accent;

	return (
		<Section id="hosted" kicker="Hosted spotlight">
			<div
				style={{
					marginBottom: 56,
					display: "grid",
					gridTemplateColumns: "1.05fr 0.95fr",
					gap: 64,
					alignItems: "end",
				}}
			>
				<H2 size={56} style={{ letterSpacing: "-0.035em" }}>
					Iterate
					<br />
					<span style={{ color: TOKENS.muted }}>without rewrites.</span>
				</H2>
				<Lede>
					When you&apos;re ready for collaboration, versioning, and visual
					debugging — your YAML moves with you, unchanged. Same agent file, same
					runtime, more surface.
				</Lede>
			</div>

			<div
				style={{
					borderRadius: 16,
					overflow: "hidden",
					border: `1px solid ${TOKENS.line}`,
					boxShadow:
						"0 32px 80px rgba(26,25,22,0.14), 0 6px 18px rgba(26,25,22,0.06)",
					background: TOKENS.surface,
				}}
			>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					src="/landing/hosted-builder.png"
					alt="agntz.co agent builder showing the Nutritionist Agent in the Build view"
					width={2694}
					height={1658}
					style={{
						display: "block",
						width: "100%",
						height: "auto",
					}}
				/>
			</div>

			<Row
				gap={12}
				style={{ marginTop: 40, alignItems: "center", flexWrap: "wrap" }}
			>
				<Btn primary href="https://app.agntz.co" newTab>
					See hosted <ArrowIcon />
				</Btn>
				<span style={{ fontSize: 13, color: TOKENS.muted, marginLeft: 8 }}>
					Free tier · no credit card · same YAML works locally.
				</span>
			</Row>
		</Section>
	);
}
