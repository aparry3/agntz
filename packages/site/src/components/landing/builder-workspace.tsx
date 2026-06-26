"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LanguageToggle, usePreferredLanguage } from "../language";
import {
	AGENT_BUILDER_PROMPT_KEY,
	type StoredAgentBuilderPrompt,
} from "./agent-builder-storage";
import { CodeBlock } from "./code-block";
import {
	ArrowIcon,
	CheckIcon,
	CodeIcon,
	ExternalIcon,
	SparkIcon,
} from "./icons";
import { H1, Lede, Pill, Row, Section, Stack } from "./primitives";
import { ACCENTS, TOKENS } from "./tokens";

type Phase = "prompt" | "generating" | "result" | "error";

interface BuildMetadata {
	id?: string;
	name?: string;
	kind?: string;
	modelProvider?: string;
	modelName?: string;
}

interface BuildResponse {
	yaml: string | null;
	explanation: string | null;
	validation: unknown;
	metadata?: BuildMetadata;
}

interface BuildError {
	message: string;
	retryAfterSeconds?: number;
}

const STEPS = [
	"Parsing workflow",
	"Choosing agent shape",
	"Drafting YAML",
	"Wiring tools",
	"Validating manifest",
];

const FALLBACK_PROMPT =
	"Build an agent that summarizes customer support tickets, detects urgency, and drafts a concise reply.";

function storedPromptIsFresh(
	value: unknown,
): value is StoredAgentBuilderPrompt {
	if (!value || typeof value !== "object") return false;
	const item = value as StoredAgentBuilderPrompt;
	return (
		typeof item.prompt === "string" &&
		typeof item.createdAt === "number" &&
		Date.now() - item.createdAt < 30 * 60_000
	);
}

function providerEnv(provider: string | undefined): string {
	const key = (provider ?? "openai").toLowerCase();
	if (key === "anthropic") return "ANTHROPIC_API_KEY";
	if (key === "google") return "GOOGLE_GENERATIVE_AI_API_KEY";
	if (key === "mistral") return "MISTRAL_API_KEY";
	if (key === "openrouter") return "OPENROUTER_API_KEY";
	return "OPENAI_API_KEY";
}

function appBaseUrl(): string {
	const configured = process.env.NEXT_PUBLIC_AGNTZ_APP_URL;
	if (configured) return configured.replace(/\/$/, "");
	if (
		window.location.hostname === "localhost" ||
		window.location.hostname === "127.0.0.1"
	) {
		return "http://localhost:3000";
	}
	return "https://app.agntz.co";
}

export function BuilderWorkspace() {
	const { language } = usePreferredLanguage();
	const [phase, setPhase] = useState<Phase>("prompt");
	const [prompt, setPrompt] = useState("");
	const [activeStep, setActiveStep] = useState(0);
	const [elapsed, setElapsed] = useState(0);
	const [result, setResult] = useState<BuildResponse | null>(null);
	const [error, setError] = useState<BuildError | null>(null);
	const [opening, setOpening] = useState(false);
	const [openError, setOpenError] = useState<string | null>(null);
	const startedRef = useRef(false);
	const timerRef = useRef<number | null>(null);
	const startedAtRef = useRef(0);

	const manifestId = result?.metadata?.id || "agent";
	const manifestName = result?.metadata?.name || manifestId;
	const envKey = providerEnv(result?.metadata?.modelProvider);

	const clearTimer = useCallback(() => {
		if (timerRef.current) window.clearInterval(timerRef.current);
		timerRef.current = null;
	}, []);

	const startTimer = useCallback(() => {
		startedAtRef.current = Date.now();
		setElapsed(0);
		setActiveStep(0);
		clearTimer();
		timerRef.current = window.setInterval(() => {
			const nextElapsed = (Date.now() - startedAtRef.current) / 1000;
			setElapsed(nextElapsed);
			setActiveStep(Math.min(STEPS.length - 1, Math.floor(nextElapsed / 1.35)));
		}, 200);
	}, [clearTimer]);

	const runBuild = useCallback(
		async (description: string) => {
			const trimmed = description.trim();
			if (!trimmed) return;
			setPrompt(trimmed);
			setPhase("generating");
			setError(null);
			setOpenError(null);
			setResult(null);
			startTimer();
			try {
				const res = await fetch("/api/build-agent", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ description: trimmed }),
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					const retryAfter = res.headers.get("retry-after");
					const buildError: BuildError = {
						message:
							typeof data.error === "string"
								? data.error
								: `Builder failed with HTTP ${res.status}`,
						retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
					};
					throw buildError;
				}
				if (typeof data.yaml !== "string") {
					const buildError: BuildError = {
						message: "Agent builder did not return YAML",
					};
					throw buildError;
				}
				setActiveStep(STEPS.length - 1);
				setResult(data as BuildResponse);
				setPhase("result");
				try {
					window.sessionStorage.removeItem(AGENT_BUILDER_PROMPT_KEY);
				} catch {
					// best effort cleanup
				}
			} catch (err) {
				const next =
					err && typeof err === "object" && "message" in err
						? (err as BuildError)
						: { message: String(err) };
				setError(next);
				setPhase("error");
			} finally {
				clearTimer();
			}
		},
		[clearTimer, startTimer],
	);

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;
		try {
			const raw = window.sessionStorage.getItem(AGENT_BUILDER_PROMPT_KEY);
			const stored = raw ? JSON.parse(raw) : null;
			if (storedPromptIsFresh(stored)) {
				void runBuild(stored.prompt);
				return;
			}
		} catch {
			// fall through to prompt state
		}
		setPrompt("");
		setPhase("prompt");
	}, [runBuild]);

	useEffect(() => clearTimer, [clearTimer]);

	const sdkSnippet = useMemo(() => {
		if (language === "python") {
			return `from agntz import LiteLLMModelProvider, agntz

client = agntz(
    agents="./agents",
    model_provider=LiteLLMModelProvider(),
)

result = client.agents.run(
    agent_id="${manifestId}",
    input="Run the first task.",
)

print(result.output)`;
		}
		return `import { agntz } from "@agntz/sdk";

const client = await agntz({ agents: "./agents" });

const { output } = await client.agents.run({
  agentId: "${manifestId}",
  input: "Run the first task.",
});

console.log(output);`;
	}, [language, manifestId]);

	const cliSnippet = `mkdir -p agents
# Save the YAML on the left as agents/${manifestId}.yaml
export ${envKey}=...
agntz run ./agents/${manifestId}.yaml --input "Run the first task."`;

	async function openInBuilder() {
		if (!result?.yaml) return;
		setOpening(true);
		setOpenError(null);
		try {
			const baseUrl = appBaseUrl();
			const res = await fetch(`${baseUrl}/api/site-drafts`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					yaml: result.yaml,
					source: "landing-builder",
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || typeof data.openUrl !== "string") {
				throw new Error(
					typeof data.error === "string"
						? data.error
						: "Could not open the hosted builder",
				);
			}
			window.location.href = data.openUrl;
		} catch (err) {
			setOpenError(err instanceof Error ? err.message : String(err));
			setOpening(false);
		}
	}

	return (
		<Section style={{ paddingTop: 72, paddingBottom: 96 }}>
			<Stack gap={28}>
				<Row gap={8} style={{ alignItems: "center", flexWrap: "wrap" }}>
					<Pill accent="green" dot>
						agent builder
					</Pill>
					<Pill mono>free to use</Pill>
					<Pill mono>same builder as CLI</Pill>
				</Row>

				{phase === "prompt" && (
					<PromptPanel
						prompt={prompt}
						setPrompt={setPrompt}
						onSubmit={() => runBuild(prompt)}
					/>
				)}

				{phase === "generating" && (
					<GeneratingPanel
						prompt={prompt}
						activeStep={activeStep}
						elapsed={elapsed}
					/>
				)}

				{phase === "error" && (
					<ErrorPanel
						prompt={prompt}
						error={error}
						onRetry={() => runBuild(prompt)}
						onEdit={() => setPhase("prompt")}
					/>
				)}

				{phase === "result" && result?.yaml && (
					<div
						style={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(min(100%, 430px), 1fr))",
							gap: 22,
							alignItems: "start",
						}}
					>
						<Stack gap={12}>
							<Row
								style={{
									alignItems: "center",
									justifyContent: "space-between",
									gap: 12,
									flexWrap: "wrap",
								}}
							>
								<div>
									<div
										style={{
											fontSize: 12,
											color: TOKENS.muted,
											fontFamily: "var(--mono)",
											textTransform: "uppercase",
											letterSpacing: "0.12em",
										}}
									>
										Generated manifest
									</div>
									<h2
										style={{
											margin: "4px 0 0",
											fontSize: 28,
											fontWeight: 600,
											letterSpacing: "-0.02em",
										}}
									>
										{manifestName}
									</h2>
								</div>
								<Row gap={8} style={{ alignItems: "center" }}>
									<span
										style={{ color: ACCENTS.green.fg, display: "inline-flex" }}
									>
										<CheckIcon />
									</span>
									<span
										style={{
											fontFamily: "var(--mono)",
											fontSize: 11,
											color: TOKENS.text2,
										}}
									>
										valid YAML
									</span>
								</Row>
							</Row>
							<CodeBlock
								lang="yaml"
								filename={`agents/${manifestId}.yaml`}
								wrap
							>
								{result.yaml}
							</CodeBlock>
						</Stack>

						<Stack gap={16}>
							<div
								style={{
									background: TOKENS.surface,
									border: `1px solid ${TOKENS.line}`,
									borderRadius: 10,
									padding: 22,
								}}
							>
								<Row
									style={{
										alignItems: "center",
										justifyContent: "space-between",
										gap: 12,
										flexWrap: "wrap",
										marginBottom: 16,
									}}
								>
									<div>
										<div
											style={{
												fontSize: 12,
												color: TOKENS.muted,
												fontFamily: "var(--mono)",
												textTransform: "uppercase",
												letterSpacing: "0.12em",
											}}
										>
											Run it
										</div>
										<h2
											style={{
												margin: "4px 0 0",
												fontSize: 24,
												fontWeight: 600,
												letterSpacing: "-0.02em",
											}}
										>
											Copy into your repo
										</h2>
									</div>
									<LanguageToggle compact label="SDK snippets" />
								</Row>
								<Stack gap={14}>
									<CodeBlock lang="bash" filename="terminal" wrap>
										{cliSnippet}
									</CodeBlock>
									<CodeBlock
										lang={language === "python" ? "python" : "ts"}
										filename={language === "python" ? "runner.py" : "runner.ts"}
										wrap
									>
										{sdkSnippet}
									</CodeBlock>
								</Stack>
							</div>

							<div
								style={{
									background: TOKENS.surface2,
									border: `1px solid ${TOKENS.line}`,
									borderRadius: 10,
									padding: 22,
								}}
							>
								<Row gap={10} style={{ alignItems: "center", marginBottom: 8 }}>
									<span
										style={{ color: ACCENTS.purple.fg, display: "inline-flex" }}
									>
										<SparkIcon />
									</span>
									<h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
										Open in the hosted builder
									</h3>
								</Row>
								<p
									style={{
										margin: "0 0 16px",
										color: TOKENS.text2,
										fontSize: 14,
										lineHeight: 1.55,
									}}
								>
									Send this generated YAML into agntz as an unsaved draft. You
									can inspect it visually before creating the agent.
								</p>
								<button
									type="button"
									onClick={openInBuilder}
									disabled={opening}
									style={{
										appearance: "none",
										border: `1px solid ${TOKENS.ink}`,
										borderRadius: 6,
										background: TOKENS.ink,
										color: TOKENS.bg,
										padding: "10px 14px",
										fontFamily: "var(--sans)",
										fontSize: 13,
										fontWeight: 600,
										cursor: opening ? "wait" : "pointer",
										display: "inline-flex",
										alignItems: "center",
										gap: 8,
									}}
								>
									{opening ? "Opening..." : "Open in agntz builder"}
									<ExternalIcon />
								</button>
								{openError && (
									<div
										style={{
											marginTop: 10,
											color: TOKENS.danger,
											fontSize: 12.5,
										}}
									>
										{openError}
									</div>
								)}
							</div>
						</Stack>
					</div>
				)}
			</Stack>
		</Section>
	);
}

function PromptPanel({
	prompt,
	setPrompt,
	onSubmit,
}: {
	prompt: string;
	setPrompt: (value: string) => void;
	onSubmit: () => void;
}) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
				gap: 32,
				alignItems: "center",
			}}
		>
			<Stack gap={18}>
				<H1 size={64}>Build your agent manifest.</H1>
				<Lede style={{ maxWidth: 620 }}>
					Describe the workflow, tools, APIs, or MCP servers you want. The
					builder will draft a portable YAML manifest.
				</Lede>
			</Stack>
			<div
				style={{
					background: TOKENS.surface,
					border: `1px solid ${TOKENS.line}`,
					borderRadius: 12,
					overflow: "hidden",
					boxShadow: "0 18px 44px rgba(26,25,22,0.08)",
				}}
			>
				<div
					style={{
						padding: "12px 16px",
						borderBottom: `1px solid ${TOKENS.line}`,
						background: TOKENS.warm,
						display: "flex",
						alignItems: "center",
						gap: 9,
					}}
				>
					<CodeIcon />
					<span
						style={{
							fontFamily: "var(--mono)",
							fontSize: 11.5,
							color: TOKENS.text2,
							textTransform: "uppercase",
							letterSpacing: "0.08em",
						}}
					>
						Agent description
					</span>
				</div>
				<textarea
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder={FALLBACK_PROMPT}
					spellCheck={false}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							onSubmit();
						}
					}}
					style={{
						display: "block",
						width: "100%",
						minHeight: 180,
						resize: "vertical",
						border: 0,
						outline: 0,
						padding: "18px 20px",
						background: TOKENS.surface2,
						color: TOKENS.ink,
						fontFamily: "var(--sans)",
						fontSize: 15,
						lineHeight: 1.55,
					}}
				/>
				<div
					style={{
						padding: "12px 14px",
						borderTop: `1px solid ${TOKENS.line}`,
						background: TOKENS.warm,
						display: "flex",
						justifyContent: "flex-end",
					}}
				>
					<button
						type="button"
						onClick={onSubmit}
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
						}}
					>
						Build agent <ArrowIcon />
					</button>
				</div>
			</div>
		</div>
	);
}

function GeneratingPanel({
	prompt,
	activeStep,
	elapsed,
}: {
	prompt: string;
	activeStep: number;
	elapsed: number;
}) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
				gap: 22,
				alignItems: "stretch",
			}}
		>
			<div
				style={{
					minHeight: 430,
					position: "relative",
					overflow: "hidden",
					border: `1px solid ${TOKENS.line}`,
					borderRadius: 12,
					background: TOKENS.surface2,
					backgroundImage: `radial-gradient(${TOKENS.line} 1px, transparent 1px)`,
					backgroundSize: "18px 18px",
				}}
			>
				<div
					style={{
						position: "absolute",
						inset: 0,
						display: "grid",
						placeItems: "center",
						padding: 24,
					}}
				>
					<Stack gap={16} style={{ width: "min(420px, 100%)" }}>
						{["Input", "Planner", "Generator", "Validator", "YAML"].map(
							(label, index) => (
								<div
									key={label}
									style={{
										border: `1.5px solid ${index <= activeStep ? TOKENS.ink : TOKENS.line}`,
										borderRadius: 8,
										background:
											index <= activeStep ? TOKENS.surface : TOKENS.warm,
										padding: "12px 14px",
										boxShadow:
											index === activeStep
												? "0 0 0 4px rgba(26,25,22,0.05)"
												: "none",
									}}
								>
									<Row gap={10} style={{ alignItems: "center" }}>
										<span
											style={{
												width: 10,
												height: 10,
												borderRadius: 99,
												background:
													index < activeStep
														? ACCENTS.green.fg
														: index === activeStep
															? ACCENTS.purple.fg
															: TOKENS.line,
												flex: "0 0 auto",
											}}
										/>
										<span
											style={{
												fontFamily: "var(--mono)",
												fontSize: 12,
												color: index <= activeStep ? TOKENS.ink : TOKENS.muted,
											}}
										>
											{label}
										</span>
									</Row>
								</div>
							),
						)}
					</Stack>
				</div>
			</div>
			<div
				style={{
					border: `1px solid ${TOKENS.line}`,
					borderRadius: 12,
					background: TOKENS.surface,
					padding: 24,
				}}
			>
				<Row gap={10} style={{ alignItems: "center", marginBottom: 20 }}>
					<span style={{ color: ACCENTS.purple.fg, display: "inline-flex" }}>
						<SparkIcon />
					</span>
					<h1 style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>
						Building your agent
					</h1>
				</Row>
				<Stack gap={14}>
					{STEPS.map((step, index) => (
						<Row key={step} gap={10} style={{ alignItems: "flex-start" }}>
							<span
								style={{
									width: 16,
									height: 16,
									marginTop: 2,
									borderRadius: 99,
									border: `1.5px solid ${index <= activeStep ? TOKENS.ink : TOKENS.line}`,
									background: index < activeStep ? TOKENS.ink : TOKENS.surface2,
									display: "grid",
									placeItems: "center",
									color: TOKENS.bg,
									flex: "0 0 auto",
								}}
							>
								{index < activeStep ? <CheckIcon /> : null}
							</span>
							<div>
								<div
									style={{
										color: index <= activeStep ? TOKENS.ink : TOKENS.muted,
										fontWeight: index === activeStep ? 600 : 400,
										fontSize: 14,
									}}
								>
									{step}
								</div>
							</div>
						</Row>
					))}
				</Stack>
				<div
					style={{
						marginTop: 24,
						padding: 14,
						border: `1px solid ${TOKENS.line2}`,
						borderRadius: 8,
						background: TOKENS.bg,
						color: TOKENS.text2,
						fontSize: 13,
						lineHeight: 1.55,
					}}
				>
					{prompt}
				</div>
				<div
					style={{
						marginTop: 12,
						fontFamily: "var(--mono)",
						fontSize: 11,
						color: TOKENS.muted,
					}}
				>
					{elapsed.toFixed(1)}s elapsed
				</div>
			</div>
		</div>
	);
}

function ErrorPanel({
	prompt,
	error,
	onRetry,
	onEdit,
}: {
	prompt: string;
	error: BuildError | null;
	onRetry: () => void;
	onEdit: () => void;
}) {
	return (
		<div
			style={{
				border: `1px solid ${TOKENS.line}`,
				borderRadius: 12,
				background: TOKENS.surface,
				padding: 28,
				maxWidth: 720,
			}}
		>
			<h1 style={{ margin: 0, fontSize: 32, fontWeight: 600 }}>
				The builder could not finish.
			</h1>
			<p style={{ color: TOKENS.text2, fontSize: 15, lineHeight: 1.6 }}>
				{error?.message ?? "Unknown builder error"}
				{error?.retryAfterSeconds
					? ` Retry in about ${error.retryAfterSeconds}s.`
					: ""}
			</p>
			<div
				style={{
					padding: 14,
					border: `1px solid ${TOKENS.line2}`,
					borderRadius: 8,
					background: TOKENS.bg,
					color: TOKENS.text2,
					fontSize: 13,
					lineHeight: 1.55,
					marginBottom: 18,
				}}
			>
				{prompt}
			</div>
			<Row gap={10} style={{ flexWrap: "wrap" }}>
				<button
					type="button"
					onClick={onRetry}
					style={{
						appearance: "none",
						border: `1px solid ${TOKENS.ink}`,
						borderRadius: 6,
						background: TOKENS.ink,
						color: TOKENS.bg,
						padding: "10px 14px",
						fontFamily: "var(--sans)",
						fontSize: 13,
						fontWeight: 600,
						cursor: "pointer",
					}}
				>
					Retry
				</button>
				<button
					type="button"
					onClick={onEdit}
					style={{
						appearance: "none",
						border: `1px solid ${TOKENS.line}`,
						borderRadius: 6,
						background: TOKENS.surface2,
						color: TOKENS.ink,
						padding: "10px 14px",
						fontFamily: "var(--sans)",
						fontSize: 13,
						fontWeight: 600,
						cursor: "pointer",
					}}
				>
					Edit prompt
				</button>
			</Row>
		</div>
	);
}
