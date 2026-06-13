"use client";

import type { ReactNode } from "react";
import {
	ArrowIcon,
	CheckIcon,
	CodeIcon,
	ServerIcon,
	SparkIcon,
} from "../landing/icons";
import { Card, H2, Lede, Row, Section, Stack } from "../landing/primitives";
import { ACCENTS, TOKENS } from "../landing/tokens";
import { LanguageToggle, usePreferredLanguage } from "../language";

type Option = {
	tag: string;
	name: string;
	tagline: string;
	bullets: string[];
	best: string;
	cmd: string;
	cta: string;
	href: string;
	icon: ReactNode;
};

const OPTIONS: Option[] = [
	{
		tag: "embedded",
		name: "memrez",
		tagline: "In-process, in your runner.",
		bullets: [
			"Lives in the same Node or Python process as your agntz runner",
			"In-memory by default; SQLite or Postgres when you're ready",
			"Zero infra to add; one constructor swap to graduate",
			"Bring your own model provider for the tagger",
		],
		best: "Solo devs, small services, single-tenant tools.",
		cmd: "npm i @agntz/memrez",
		cta: "Read the embedded guide",
		href: "/docs/tools/memory-memrez",
		icon: <CodeIcon />,
	},
	{
		tag: "hosted",
		name: "memrez.co",
		tagline: "Memory as a service.",
		bullets: [
			"Managed Postgres + automated curation cron",
			"Visual memory explorer + topic TOC dashboard",
			"Per-org isolation enforced at the database, not the app",
			"Auto-scaled, monitored, backed up",
		],
		best: "Teams that don't want to operate a memory store.",
		cmd: "Sign up at memrez.co",
		cta: "Open the hosted app",
		href: "https://app.agntz.co",
		icon: <SparkIcon />,
	},
	{
		tag: "self-hosted",
		name: "memrez on your infra",
		tagline: "Same image, your perimeter.",
		bullets: [
			"Same Docker image as hosted",
			"Postgres + your existing object store",
			"SOC2-friendly deployment patterns",
			"No data leaves your network",
		],
		best: "Regulated environments, on-prem, air-gapped.",
		cmd: "docker compose up",
		cta: "Read the self-host guide",
		href: "/docs/deploy/self-host-production",
		icon: <ServerIcon />,
	},
];

export function MemrezRunItYourWay() {
	const a = ACCENTS.terracotta;
	const { language } = usePreferredLanguage();
	const options = OPTIONS.map((option) =>
		option.tag === "embedded"
			? {
					...option,
					name: "memrez",
					tagline:
						language === "python"
							? "In-process, in your Python runner."
							: "In-process, in your Node runner.",
					cmd:
						language === "python"
							? 'pip install "agntz[litellm]"'
							: "npm i @agntz/memrez",
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
					Same memory.
					<br />
					<span style={{ color: TOKENS.muted }}>Three places to run it.</span>
				</H2>
				<Lede>
					Embedded in your agntz runner, hosted by us, or self-hosted in your
					perimeter. Your <code>resources: memory:</code> declaration stays the
					same in all three — only the constructor changes.
				</Lede>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr 1fr",
					gap: 18,
				}}
			>
				{options.map((o) => (
					<Card
						key={o.tag}
						style={{
							padding: 28,
							display: "flex",
							flexDirection: "column",
							gap: 18,
							minHeight: 460,
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
							{o.tag === "embedded" && (
								<LanguageToggle compact label="Embedded runtime" />
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
								style={{
									fontSize: 13,
									color: TOKENS.text2,
									lineHeight: 1.45,
								}}
							>
								{o.best}
							</span>
							<a
								href={o.href}
								{...(o.href.startsWith("http")
									? { target: "_blank", rel: "noreferrer" }
									: {})}
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
