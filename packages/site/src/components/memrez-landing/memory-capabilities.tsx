import type { ReactNode } from "react";
import {
	ArrowIcon,
	BranchIcon,
	CheckIcon,
	CubeIcon,
	EyeIcon,
	ServerIcon,
	SparkIcon,
} from "../landing/icons";
import {
	Card,
	Code,
	H2,
	Lede,
	Pill,
	Row,
	Section,
} from "../landing/primitives";
import { ACCENTS, TOKENS } from "../landing/tokens";

type Cap = {
	title: string;
	body: string;
	icon: ReactNode;
	link: string;
	href?: string;
	tag: "shipped" | "planned";
};

const CAPS: Cap[] = [
	{
		title: "Hierarchical scope",
		body: "Memories live at one owning scope (org/acme/user/u_123). Reads inherit ancestors; siblings can't see each other. The runtime enforces it — the model can't override it.",
		icon: <BranchIcon />,
		link: "scope",
		href: "/docs/concepts/context-and-resources",
		tag: "shipped",
	},
	{
		title: "Capability grants",
		body: "The model never names a namespace. Grants are minted at the trust boundary, passed per-run as context: [...], and threaded narrow-only into sub-agents.",
		icon: <CheckIcon />,
		link: "grants",
		href: "/docs/concepts/context-and-resources",
		tag: "shipped",
	},
	{
		title: "Tags-first retrieval",
		body: "Deterministic scan → read over topics. No embedding cost on the hot path, no surprise recall. Embeddings come later as an additive strategy, not a replacement.",
		icon: <EyeIcon />,
		link: "retrieval",
		href: "/docs/tools/memory-memrez",
		tag: "shipped",
	},
	{
		title: "Background curation",
		body: "Append-only + supersede — nothing ever hard-deletes. A stronger model merges duplicates, reconciles contradictions, refreshes the topic TOC. Run on cron or manually.",
		icon: <SparkIcon />,
		link: "curation",
		href: "/docs/tools/memory-memrez",
		tag: "shipped",
	},
	{
		title: "Pluggable stores",
		body: "In-memory for tests, SQLite for single-process deploys, Postgres for production. Same MemoryStore interface, graduate by swapping the constructor.",
		icon: <CubeIcon />,
		link: "stores",
		href: "/docs/tools/memory-memrez",
		tag: "shipped",
	},
	{
		title: "Embeddings + semantic search",
		body: "pgvector + sqlite-vec as an additive retrieval strategy alongside tags. The TOC still leads; embeddings refine.",
		icon: <ServerIcon />,
		link: "embeddings",
		tag: "planned",
	},
];

export function MemrezMemoryCapabilities() {
	const a = ACCENTS.terracotta;

	return (
		<Section
			id="capabilities"
			kicker="What memrez handles"
			style={{ background: TOKENS.surface }}
		>
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
					The hard parts,
					<br />
					<span style={{ color: TOKENS.muted }}>done.</span>
				</H2>
				<Lede>
					Everything most teams hand-build behind a vector store — namespace
					isolation, dedup, curation, parity across runtimes. Available in
					the current memrez packages.
					Items marked <Code accent="amber">planned</Code> are next.
				</Lede>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr 1fr",
					gap: 18,
				}}
			>
				{CAPS.map((c, i) => (
					<Card
						key={c.title}
						hover
						style={{
							padding: 26,
							display: "flex",
							flexDirection: "column",
							gap: 14,
							minHeight: 280,
							background: TOKENS.surface2,
							borderColor: TOKENS.line,
						}}
					>
						<Row
							gap={10}
							style={{ alignItems: "center", justifyContent: "space-between" }}
						>
							<Row gap={10} style={{ alignItems: "center" }}>
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										width: 30,
										height: 30,
										borderRadius: 6,
										border: `1px solid ${TOKENS.line}`,
										background: TOKENS.warm,
										color: TOKENS.ink,
									}}
								>
									{c.icon}
								</span>
								<span
									style={{
										fontFamily: "var(--mono)",
										fontSize: 10.5,
										letterSpacing: "0.18em",
										textTransform: "uppercase",
										color: TOKENS.muted,
									}}
								>
									0{i + 1}
								</span>
							</Row>
							<Pill accent={c.tag === "planned" ? "amber" : "green"} dot mono>
								{c.tag}
							</Pill>
						</Row>

						<H2 size={20} style={{ fontWeight: 500, lineHeight: 1.2 }}>
							{c.title}
						</H2>
						<p
							style={{
								margin: 0,
								fontSize: 13.5,
								lineHeight: 1.6,
								color: TOKENS.text2,
								textWrap: "pretty",
								flex: 1,
							}}
						>
							{c.body}
						</p>

						{c.href && (
							<a
								href={c.href}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									paddingTop: 14,
									marginTop: 4,
									borderTop: `1px solid ${TOKENS.line2}`,
									color: a.fg,
									fontSize: 13,
									textDecoration: "none",
									fontWeight: 500,
								}}
							>
								Learn about {c.link} <ArrowIcon />
							</a>
						)}
					</Card>
				))}
			</div>

			<Row
				gap={12}
				style={{
					marginTop: 24,
					alignItems: "center",
					color: TOKENS.muted,
					fontSize: 13,
				}}
			>
				<Pill accent="green" dot mono>
					shipped
				</Pill>
				<span>= available today.</span>
				<Pill accent="amber" dot mono>
					planned
				</Pill>
				<span>
					= on the near-term roadmap, tracked in the public changelog.
				</span>
			</Row>
		</Section>
	);
}
