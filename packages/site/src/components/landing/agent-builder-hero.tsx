"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useState } from "react";
import {
	AGENT_BUILDER_PROMPT_KEY,
	type StoredAgentBuilderPrompt,
} from "./agent-builder-storage";
import { ArrowIcon, CheckIcon, CodeIcon, SparkIcon } from "./icons";
import { H1, Lede, Pill, Row, Section, Stack } from "./primitives";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";

const EXAMPLES = [
	"Summarize support tickets, classify urgency, and draft a concise reply.",
	"Research a company using an MCP server at https://example.com/mcp, then write a sales brief.",
	"Use an HTTP order-status API with a secrets.GITHUB_TOKEN-style credential reference.",
	"Build a multi-step review pipeline that writes a draft, critiques it, then revises until it passes.",
];

const EXAMPLE_ROTATE_MS = 6000;

export function AgentBuilderHero({
	accent = "purple",
}: { accent?: AccentName }) {
	const router = useRouter();
	const [prompt, setPrompt] = useState("");
	const [exampleIndex, setExampleIndex] = useState(0);
	const [previousExampleIndex, setPreviousExampleIndex] = useState(0);
	const [exampleCycle, setExampleCycle] = useState(0);
	const a = ACCENTS[accent];

	useEffect(() => {
		const id = window.setInterval(() => {
			setExampleIndex((current) => {
				setPreviousExampleIndex(current);
				setExampleCycle((cycle) => cycle + 1);
				return (current + 1) % EXAMPLES.length;
			});
		}, EXAMPLE_ROTATE_MS);
		return () => window.clearInterval(id);
	}, []);

	const example = EXAMPLES[exampleIndex];
	const previousExample = EXAMPLES[previousExampleIndex];

	function submit() {
		const trimmed = prompt.trim();
		if (!trimmed) return;
		const payload: StoredAgentBuilderPrompt = {
			prompt: trimmed,
			createdAt: Date.now(),
		};
		try {
			window.sessionStorage.setItem(
				AGENT_BUILDER_PROMPT_KEY,
				JSON.stringify(payload),
			);
		} catch {
			// If storage is unavailable, /build will still provide a fresh prompt box.
		}
		router.push("/build");
	}

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== "Enter" || event.shiftKey) return;
		event.preventDefault();
		submit();
	}

	return (
		<Section
			dense
			style={{
				minHeight: "calc(100vh - 61px)",
				paddingTop: 42,
				paddingBottom: 42,
				display: "flex",
				alignItems: "center",
				overflow: "hidden",
				background: TOKENS.bg,
			}}
		>
			<div
				aria-hidden
				style={{
					position: "absolute",
					inset: 0,
					backgroundImage: `linear-gradient(${TOKENS.line} 1px, transparent 1px), linear-gradient(90deg, ${TOKENS.line} 1px, transparent 1px)`,
					backgroundSize: "52px 52px",
					opacity: 0.45,
					mask: "radial-gradient(ellipse 82% 58% at 50% 24%, black 28%, transparent 76%)",
					WebkitMask:
						"radial-gradient(ellipse 82% 58% at 50% 24%, black 28%, transparent 76%)",
					pointerEvents: "none",
				}}
			/>
			<div
				style={{
					position: "relative",
					width: "100%",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 30,
					textAlign: "center",
				}}
			>
				<Stack gap={22} style={{ alignItems: "center", maxWidth: 860 }}>
					<Row
						gap={8}
						style={{
							alignItems: "center",
							justifyContent: "center",
							flexWrap: "wrap",
						}}
					>
						<Pill accent="green" dot>
							free agent builder
						</Pill>
						<Pill mono>YAML in seconds</Pill>
						<Pill mono>runs locally</Pill>
					</Row>
					<H1 size={72} style={{ maxWidth: 760, letterSpacing: "-0.04em" }}>
						Create an agent.
						<br />
						<span style={{ color: TOKENS.muted }}>Run it with agntz.</span>
					</H1>
					<Lede style={{ maxWidth: 650, fontSize: 19 }}>
						Describe the workflow you want. We draft a portable agent manifest
						you can copy into your repo or open in the hosted builder.
					</Lede>
					<Row
						gap={18}
						style={{
							marginTop: 4,
							alignItems: "center",
							justifyContent: "center",
							color: TOKENS.text2,
							fontSize: 13,
							flexWrap: "wrap",
						}}
					>
						{[
							"Tools, APIs & Secrets",
							"MCP Servers & Integrations",
							"Multi-Step Agent Workflows",
						].map((label) => (
							<Row key={label} gap={6} style={{ alignItems: "center" }}>
								<span style={{ color: a.fg, display: "inline-flex" }}>
									<CheckIcon />
								</span>
								{label}
							</Row>
						))}
					</Row>
				</Stack>

				<div
					style={{
						width: "min(820px, 100%)",
						background: TOKENS.surface,
						border: `1px solid ${TOKENS.line}`,
						borderRadius: 12,
						boxShadow:
							"0 24px 70px rgba(26,25,22,0.10), 0 5px 18px rgba(26,25,22,0.05)",
						overflow: "hidden",
					}}
				>
					<div
						style={{
							padding: "13px 16px",
							borderBottom: `1px solid ${TOKENS.line}`,
							background: TOKENS.warm,
							display: "flex",
							alignItems: "center",
							gap: 10,
						}}
					>
						<span style={{ color: a.fg, display: "inline-flex" }}>
							<SparkIcon />
						</span>
						<span
							style={{
								fontFamily: "var(--mono)",
								fontSize: 11.5,
								color: TOKENS.text2,
								letterSpacing: "0.04em",
								textTransform: "uppercase",
							}}
						>
							Describe your agent
						</span>
					</div>
					<div
						style={{
							position: "relative",
							background: TOKENS.surface2,
						}}
					>
						<style>
							{`
								@keyframes agntz-example-push {
									from { transform: translateY(0); }
									to { transform: translateY(-78px); }
								}
							`}
						</style>
						{!prompt && (
							<div
								aria-hidden
								style={{
									position: "absolute",
									left: 22,
									right: 22,
									top: 20,
									height: 78,
									overflow: "hidden",
									pointerEvents: "none",
									textAlign: "left",
									color: TOKENS.muted,
									fontSize: 16,
									lineHeight: 1.55,
									zIndex: 1,
								}}
							>
								{exampleCycle === 0 ? (
									<div>{example}</div>
								) : (
									<div
										key={exampleCycle}
										style={{
											animation:
												"agntz-example-push 640ms cubic-bezier(0.2, 0.72, 0.2, 1) forwards",
										}}
									>
										<div style={{ height: 78 }}>{previousExample}</div>
										<div style={{ height: 78 }}>{example}</div>
									</div>
								)}
							</div>
						)}
						<textarea
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
							onKeyDown={onKeyDown}
							aria-label="Describe your agent"
							spellCheck={false}
							style={{
								position: "relative",
								zIndex: 2,
								display: "block",
								width: "100%",
								minHeight: 176,
								resize: "vertical",
								border: 0,
								outline: 0,
								padding: "20px 22px",
								background: "transparent",
								color: TOKENS.ink,
								fontFamily: "var(--sans)",
								fontSize: 16,
								lineHeight: 1.55,
							}}
						/>
					</div>
					<div
						style={{
							padding: "12px 14px 12px 18px",
							borderTop: `1px solid ${TOKENS.line}`,
							background: TOKENS.warm,
							display: "flex",
							alignItems: "center",
							gap: 12,
							flexWrap: "wrap",
						}}
					>
						<Row gap={8} style={{ alignItems: "center", flex: "1 1 260px" }}>
							<span style={{ color: a.fg, display: "inline-flex" }}>
								<CodeIcon />
							</span>
							<span
								style={{
									fontFamily: "var(--mono)",
									fontSize: 11,
									color: TOKENS.muted,
								}}
							>
								Enter to build · Shift+Enter for newline
							</span>
						</Row>
						<button
							type="button"
							onClick={submit}
							disabled={!prompt.trim()}
							style={{
								appearance: "none",
								border: `1px solid ${TOKENS.ink}`,
								borderRadius: 6,
								background: prompt.trim() ? TOKENS.ink : TOKENS.line,
								color: prompt.trim() ? TOKENS.bg : TOKENS.muted,
								padding: "10px 15px",
								fontFamily: "var(--sans)",
								fontSize: 13,
								fontWeight: 600,
								cursor: prompt.trim() ? "pointer" : "not-allowed",
								display: "inline-flex",
								alignItems: "center",
								gap: 8,
								whiteSpace: "nowrap",
							}}
						>
							Build agent <ArrowIcon />
						</button>
					</div>
				</div>
			</div>
		</Section>
	);
}
