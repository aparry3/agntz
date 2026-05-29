"use client";

import type { ReactNode } from "react";
import { LanguageToggle, usePreferredLanguage } from "../language";
import { ArrowIcon, CheckIcon, CodeIcon, ServerIcon, SparkIcon } from "./icons";
import { Card, H2, Lede, Row, Section, Stack } from "./primitives";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";

type Option = {
	tag: string;
	name: string;
	tagline: string;
	bullets: string[];
	best: string;
	cmd: string;
	cta: string;
	icon: ReactNode;
};

const OPTIONS: Option[] = [
	{
		tag: "local",
		name: "@agntz/sdk",
		tagline: "Embed it in your Node app.",
		bullets: [
			"Embed in any service or worker",
			"Version YAML in git, like config",
			"Bring your own infra and storage",
			"Trace JSON locally, no UI required",
		],
		best: "Solo devs, internal tools, existing services.",
		cmd: "npm i @agntz/sdk",
		cta: "Read the runner docs",
		icon: <CodeIcon />,
	},
	{
		tag: "hosted",
		name: "agntz.co",
		tagline: "Skip the operations.",
		bullets: [
			"Visual agent builder + version history",
			"Managed tracing, evals, and sessions",
			"Team collaboration & access control",
			"Auto-scaled, monitored, backed up",
		],
		best: "Teams iterating fast on shared agents.",
		cmd: "Sign up at agntz.co",
		cta: "Open the hosted app",
		icon: <SparkIcon />,
	},
	{
		tag: "self-hosted",
		name: "agntz on your infra",
		tagline: "Same UI, your perimeter.",
		bullets: [
			"Same hosted experience, your stack",
			"Postgres + S3-compatible storage",
			"SOC2-friendly deployment patterns",
			"Full data control, no egress",
		],
		best: "Regulated environments, on-prem, air-gapped.",
		cmd: "docker compose up",
		cta: "Read the self-host guide",
		icon: <ServerIcon />,
	},
];

export function RunItYourWay({ accent = "blue" }: { accent?: AccentName }) {
	const a = ACCENTS[accent];
	const { language } = usePreferredLanguage();
	const options = OPTIONS.map((option) =>
		option.tag === "local"
			? {
					...option,
					name: language === "python" ? "agntz" : "@agntz/sdk",
					tagline:
						language === "python"
							? "Embed it in your Python app."
							: "Embed it in your Node app.",
					cmd:
						language === "python"
							? 'pip install "agntz[litellm]"'
							: "npm i @agntz/sdk",
				}
			: option,
	);

	return (
		<Section id="run-it-your-way" kicker="Run it your way">
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
					Same engine.
					<br />
					<span style={{ color: TOKENS.muted }}>Three ways to run it.</span>
				</H2>
				<Lede>
					The runner is production-grade on day one. Pick where it lives based
					on how your team works — your YAML is the same in all three.
				</Lede>
			</div>

			<div
				style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}
			>
				{options.map((o) => (
					<Card
						key={o.tag}
						style={{
							padding: 28,
							display: "flex",
							flexDirection: "column",
							gap: 18,
							minHeight: 440,
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
										width: 32,
										height: 32,
										borderRadius: 7,
										border: `1px solid ${TOKENS.line}`,
										background: TOKENS.warm,
										color: TOKENS.ink,
									}}
								>
									{o.icon}
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
									{o.tag}
								</span>
							</Row>
							{o.tag === "local" && (
								<LanguageToggle compact label="Local runtime" />
							)}
						</Row>

						<Stack gap={6}>
							<H2 size={26} style={{ fontWeight: 500, lineHeight: 1.1 }}>
								{o.name}
							</H2>
							<p
								style={{
									margin: 0,
									fontSize: 14,
									color: TOKENS.text2,
									lineHeight: 1.5,
								}}
							>
								{o.tagline}
							</p>
						</Stack>

						<Stack gap={10} style={{ flex: 1 }}>
							{o.bullets.map((b) => (
								<Row
									key={b}
									gap={10}
									style={{
										alignItems: "flex-start",
										fontSize: 13.5,
										lineHeight: 1.5,
									}}
								>
									<span
										style={{
											color: a.fg,
											display: "inline-flex",
											marginTop: 3,
										}}
									>
										<CheckIcon />
									</span>
									<span>{b}</span>
								</Row>
							))}
						</Stack>

						<div
							style={{
								padding: "10px 12px",
								background: TOKENS.surface,
								border: `1px solid ${TOKENS.line}`,
								borderRadius: 6,
								fontFamily: "var(--mono)",
								fontSize: 12,
								color: TOKENS.ink,
								display: "flex",
								alignItems: "center",
								gap: 8,
							}}
						>
							<span style={{ color: TOKENS.muted }}>$</span>
							<span>{o.cmd}</span>
						</div>

						<Stack
							gap={8}
							style={{ paddingTop: 14, borderTop: `1px solid ${TOKENS.line}` }}
						>
							<Row gap={6} style={{ alignItems: "baseline" }}>
								<span
									style={{
										fontFamily: "var(--mono)",
										fontSize: 10,
										letterSpacing: "0.14em",
										textTransform: "uppercase",
										color: TOKENS.muted,
									}}
								>
									best for
								</span>
							</Row>
							<span
								style={{ fontSize: 13, color: TOKENS.text2, lineHeight: 1.45 }}
							>
								{o.best}
							</span>
							<a
								href="#"
								style={{
									marginTop: 4,
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									color: a.fg,
									fontSize: 13.5,
									textDecoration: "none",
									fontWeight: 500,
								}}
							>
								{o.cta} <ArrowIcon />
							</a>
						</Stack>
					</Card>
				))}
			</div>
		</Section>
	);
}
