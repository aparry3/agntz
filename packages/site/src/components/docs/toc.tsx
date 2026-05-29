import { TOKENS } from "@/components/landing/tokens";
import { type DocsSection, renderInline } from "./markdown";

export function DocsToc({ sections }: { sections: DocsSection[] }) {
	const tocSections = sections.filter((s) => s.level === 2 || s.level === 3);
	if (tocSections.length === 0) {
		return (
			<aside
				style={{
					position: "sticky",
					top: 96,
					alignSelf: "start",
				}}
			>
				<div
					style={{
						marginTop: 0,
						paddingTop: 0,
						fontSize: 12,
						lineHeight: 1.5,
						color: TOKENS.muted,
					}}
				>
					Need the raw markdown? Use the <strong>Copy</strong> button at the
					top, or fetch{" "}
					<a
						href="/llms.txt"
						style={{
							color: TOKENS.blue,
							textDecoration: "underline",
							textUnderlineOffset: 2,
							fontFamily: "var(--mono)",
						}}
					>
						/llms.txt
					</a>{" "}
					for the full corpus.
				</div>
			</aside>
		);
	}

	return (
		<aside
			style={{
				position: "sticky",
				top: 96,
				alignSelf: "start",
				maxHeight: "calc(100vh - 120px)",
				overflowY: "auto",
				borderLeft: `1px solid ${TOKENS.line}`,
				paddingLeft: 20,
			}}
		>
			<div
				style={{
					fontFamily: "var(--mono)",
					fontSize: 10.5,
					letterSpacing: "0.18em",
					textTransform: "uppercase",
					color: TOKENS.muted,
					marginBottom: 14,
				}}
			>
				On this page
			</div>
			<nav>
				<ul
					style={{
						listStyle: "none",
						padding: 0,
						margin: 0,
						display: "flex",
						flexDirection: "column",
						gap: 6,
					}}
				>
					{tocSections.map((s) => (
						<li key={s.slug} style={{ paddingLeft: s.level === 3 ? 12 : 0 }}>
							<a
								href={`#${s.slug}`}
								style={{
									display: "block",
									fontSize: s.level === 3 ? 12.5 : 13,
									lineHeight: 1.4,
									color: s.level === 3 ? TOKENS.muted : TOKENS.text2,
									textDecoration: "none",
									padding: "2px 0",
								}}
							>
								{renderInline(s.text)}
							</a>
						</li>
					))}
				</ul>
			</nav>
			<div
				style={{
					marginTop: 22,
					paddingTop: 16,
					borderTop: `1px solid ${TOKENS.line}`,
					fontSize: 12,
					lineHeight: 1.5,
					color: TOKENS.muted,
				}}
			>
				Need the raw markdown? Use the <strong>Copy</strong> button at the top,
				or fetch{" "}
				<a
					href="/llms.txt"
					style={{
						color: TOKENS.blue,
						textDecoration: "underline",
						textUnderlineOffset: 2,
						fontFamily: "var(--mono)",
					}}
				>
					/llms.txt
				</a>
				.
			</div>
		</aside>
	);
}
