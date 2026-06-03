import { LanguageToggle } from "../language";
import { ArrowIcon, GithubIcon } from "./icons";
import { Btn, Row, Wordmark } from "./primitives";
import { TOKENS } from "./tokens";

const NAV_LINKS: [string, string][] = [
	["Runtime", "/#shift"],
	["Hosted", "/#hosted"],
	["Self-host", "/#self-hosted"],
	["Docs", "/docs"],
	["Changelog", "https://github.com/aparry3/agntz/releases"],
];

const GITHUB_STARS = 0;

export function Nav({
	showLanguageToggle = false,
}: {
	showLanguageToggle?: boolean;
}) {
	return (
		<div
			style={{
				position: "sticky",
				top: 0,
				zIndex: 50,
				background: "rgba(244,241,233,0.82)",
				backdropFilter: "saturate(140%) blur(12px)",
				WebkitBackdropFilter: "saturate(140%) blur(12px)",
				borderBottom: `1px solid ${TOKENS.line}`,
			}}
		>
			<div
				style={{
					width: "min(1180px, calc(100% - 64px))",
					margin: "0 auto",
					padding: "14px 0",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<Row gap={28} style={{ alignItems: "center" }}>
					<Wordmark />
					<Row gap={2} style={{ alignItems: "center" }}>
						{NAV_LINKS.map(([l, h]) => {
							const external = h.startsWith("http");
							return (
								<a
									key={l}
									href={h}
									{...(external ? { target: "_blank", rel: "noreferrer" } : {})}
									style={{
										padding: "6px 12px",
										fontSize: 13.5,
										color: TOKENS.text2,
										textDecoration: "none",
										borderRadius: 5,
										letterSpacing: "-0.005em",
									}}
								>
									{l}
								</a>
							);
						})}
					</Row>
				</Row>
				<Row gap={10} style={{ alignItems: "center" }}>
					{showLanguageToggle && <LanguageToggle compact />}
					<a
						href="https://github.com/aparry3/agntz"
						target="_blank"
						rel="noreferrer"
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							color: TOKENS.text2,
							fontSize: 13,
							textDecoration: "none",
						}}
					>
						<GithubIcon />
						{GITHUB_STARS > 0 && (
							<span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
								{GITHUB_STARS.toLocaleString()}
							</span>
						)}
					</a>
					<a
						href="https://app.agntz.co/sign-in"
						style={{
							color: TOKENS.text2,
							fontSize: 13.5,
							textDecoration: "none",
						}}
					>
						Sign in
					</a>
					<Btn primary size="sm" href="/docs">
						Quickstart <ArrowIcon />
					</Btn>
				</Row>
			</div>
		</div>
	);
}
