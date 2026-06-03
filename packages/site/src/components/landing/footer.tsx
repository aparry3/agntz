import { GithubIcon } from "./icons";
import { Row, Stack, Wordmark } from "./primitives";
import { ACCENTS, TOKENS } from "./tokens";

const COLS: { h: string; items: { label: string; href: string }[] }[] = [
	{
		h: "Runtime",
		items: [
			{ label: "@agntz/sdk", href: "/docs/sdk-cli/sdk" },
			{ label: "Manifest spec", href: "/docs/schema/common-fields" },
			{ label: "Tool kinds", href: "/docs/tools/local" },
			{ label: "Sessions", href: "/docs/concepts/sessions" },
			{ label: "Tracing", href: "/docs/concepts/runs-and-traces" },
		],
	},
	{
		h: "Hosted",
		items: [
			{ label: "Visual builder", href: "https://app.agntz.co" },
			{ label: "Hosted cloud", href: "/docs/deploy/hosted-cloud" },
			{ label: "HTTP API", href: "/docs/deploy/http-api" },
		],
	},
	{
		h: "Self-host",
		items: [
			{ label: "Guide", href: "/docs/deploy/self-host-production" },
			{ label: "Docker", href: "/docs/deploy/self-host-docker" },
			{ label: "Models & providers", href: "/docs/models" },
		],
	},
	{
		h: "Resources",
		items: [
			{ label: "Docs", href: "/docs" },
			{ label: "Quickstart", href: "/docs/quickstart" },
			{
				label: "Examples",
				href: "https://github.com/aparry3/agntz/tree/main/examples",
			},
			{ label: "Changelog", href: "https://github.com/aparry3/agntz/releases" },
		],
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
								target="_blank"
								rel="noreferrer"
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
								{c.items.map((i) => {
									const external = i.href.startsWith("http");
									return (
										<a
											key={i.label}
											href={i.href}
											{...(external
												? { target: "_blank", rel: "noreferrer" }
												: {})}
											style={{
												fontSize: 13.5,
												color: "rgba(244,241,233,0.8)",
												textDecoration: "none",
											}}
										>
											{i.label}
										</a>
									);
								})}
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
