import { GithubIcon } from "./icons";
import { Row, Stack, Wordmark } from "./primitives";
import { ACCENTS, TOKENS } from "./tokens";

const COLS = [
	{
		h: "Runtime",
		items: ["@agntz/sdk", "Manifest spec", "Tool kinds", "Sessions", "Tracing"],
	},
	{
		h: "Hosted",
		items: ["Visual builder", "Versions", "Evals", "Team plans", "SLA"],
	},
	{
		h: "Self-host",
		items: ["Guide", "Docker", "Helm chart", "Architecture", "Upgrades"],
	},
	{
		h: "Resources",
		items: ["Docs", "Quickstart", "Examples", "Discord", "Blog"],
	},
];

export function FooterX() {
	return (
		<footer
			style={{
				background: TOKENS.ink,
				color: TOKENS.bg,
				borderTop: `1px solid ${TOKENS.ink}`,
			}}
		>
			<div
				style={{
					width: "min(1180px, calc(100% - 64px))",
					margin: "0 auto",
					padding: "64px 0 32px",
				}}
			>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr",
						gap: 40,
					}}
				>
					<Stack gap={18}>
						<span style={{ color: TOKENS.bg }}>
							<Wordmark size={26} />
						</span>
						<p
							style={{
								margin: 0,
								fontSize: 13.5,
								color: "rgba(244,241,233,0.6)",
								lineHeight: 1.55,
								maxWidth: 280,
							}}
						>
							A declarative runtime for production agents. Describe in YAML, run
							anywhere — local, hosted, or self-hosted.
						</p>
						<Row gap={10} style={{ marginTop: 6 }}>
							<a
								href="https://github.com/aparry3/agntz"
								style={{
									display: "inline-flex",
									padding: 8,
									border: "1px solid rgba(244,241,233,0.2)",
									borderRadius: 6,
									color: TOKENS.bg,
								}}
							>
								<GithubIcon />
							</a>
							<a
								href="#"
								style={{
									display: "inline-flex",
									padding: 8,
									border: "1px solid rgba(244,241,233,0.2)",
									borderRadius: 6,
									color: TOKENS.bg,
									fontFamily: "var(--mono)",
									fontSize: 12,
								}}
							>
								X
							</a>
							<a
								href="#"
								style={{
									display: "inline-flex",
									padding: "8px 12px",
									border: "1px solid rgba(244,241,233,0.2)",
									borderRadius: 6,
									color: TOKENS.bg,
									fontSize: 12,
									alignItems: "center",
									gap: 6,
								}}
							>
								<span
									style={{
										width: 6,
										height: 6,
										borderRadius: 99,
										background: ACCENTS.green.fg,
									}}
								/>
								Discord · 1.2k
							</a>
						</Row>
					</Stack>

					{COLS.map((c) => (
						<Stack key={c.h} gap={12}>
							<span
								style={{
									fontFamily: "var(--mono)",
									fontSize: 10.5,
									letterSpacing: "0.18em",
									textTransform: "uppercase",
									color: "rgba(244,241,233,0.45)",
								}}
							>
								{c.h}
							</span>
							<Stack gap={8}>
								{c.items.map((i) => (
									<a
										key={i}
										href="#"
										style={{
											fontSize: 13.5,
											color: "rgba(244,241,233,0.8)",
											textDecoration: "none",
										}}
									>
										{i}
									</a>
								))}
							</Stack>
						</Stack>
					))}
				</div>

				<Row
					style={{
						marginTop: 56,
						paddingTop: 24,
						borderTop: "1px solid rgba(244,241,233,0.12)",
						alignItems: "center",
						justifyContent: "space-between",
						flexWrap: "wrap",
						gap: 16,
					}}
				>
					<Row
						gap={20}
						style={{
							fontFamily: "var(--mono)",
							fontSize: 11,
							color: "rgba(244,241,233,0.55)",
							letterSpacing: "0.04em",
						}}
					>
						<span>© 2026 agntz, inc.</span>
						<span>MIT</span>
						<span>v1.0.0</span>
						<Row gap={6} style={{ alignItems: "center" }}>
							<span
								style={{
									width: 6,
									height: 6,
									borderRadius: 99,
									background: ACCENTS.green.fg,
								}}
							/>
							all systems normal
						</Row>
					</Row>
					<span
						style={{
							fontFamily: "var(--mono)",
							fontSize: 11,
							color: "rgba(244,241,233,0.45)",
						}}
					>
						described in YAML · run by agntz
					</span>
				</Row>
			</div>
		</footer>
	);
}
