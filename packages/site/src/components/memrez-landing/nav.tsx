import { ArrowIcon, ExternalIcon, GithubIcon } from "../landing/icons";
import { Btn, Pill, Row } from "../landing/primitives";
import { TOKENS } from "../landing/tokens";
import { MemrezWordmark } from "./wordmark";

const NAV_LINKS: [string, string][] = [
	["Memory model", "/memrez#shift"],
	["Hosted", "/memrez#hosted"],
	["Self-host", "/memrez#self-hosted"],
	["Docs", "/docs"],
	["Changelog", "https://github.com/aparry3/agntz/releases"],
];

export function MemrezNav() {
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
				<Row gap={20} style={{ alignItems: "center" }}>
					<MemrezWordmark />
					<a
						href="/"
						style={{ textDecoration: "none" }}
						title="part of the agntz family"
					>
						<Pill accent="terracotta" mono>
							built for agntz <ExternalIcon />
						</Pill>
					</a>
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
