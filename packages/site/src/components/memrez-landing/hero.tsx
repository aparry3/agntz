"use client";

import { useState } from "react";
import {
	highlightPython,
	highlightTS,
	highlightYAML,
} from "../landing/code-block";
import {
	ArrowIcon,
	CheckIcon,
	CodeIcon,
	ExternalIcon,
	GithubIcon,
	SparkIcon,
} from "../landing/icons";
import {
	Btn,
	H1,
	Lede,
	Pill,
	Row,
	Section,
	Stack,
} from "../landing/primitives";
import { ACCENTS, TOKENS } from "../landing/tokens";
import { LanguageToggle, usePreferredLanguage } from "../language";

const HERO_YAML = `# agent.yaml — declare memory as a resource
id: support-agent
kind: llm

model:
  provider: anthropic
  name: claude-sonnet-4-6

instruction: |
  You are a support agent. Use memory to
  remember preferences across conversations.

resources:
  memory:
    mode: read-write     # registers memory_read + memory_write
    autoScan: true       # injects a topic TOC before the model call
    writePolicy:
      descendants: true
      ancestorPromotion: none`;

const HERO_RUNNER_TS = `// runner.ts — wire memrez into your agntz runner.
import { agntz } from '@agntz/sdk';
import { createMemrez, SqliteMemoryStore } from '@agntz/memrez';

const memory = createMemrez({
  store: new SqliteMemoryStore('./memory.db'),
});

const client = await agntz({
  agents: './agents',
  resources: { memory: memory.provider() },
});

const { output } = await client.agents.run({
  agentId: 'support-agent',
  input: 'Schedule me for Tuesday again.',
  context: ['org/acme/user/u_123'],   // the capability grant
});
// → "Tuesday at 7am, same as last week. Confirmed."`;

const HERO_RUNNER_PY = `# runner.py — wire memrez into your agntz runner.
from agntz import LiteLLMModelProvider, agntz
from agntz.memrez import create_memrez
from agntz.memrez_sqlite import SqliteMemoryStore

memory = create_memrez(store=SqliteMemoryStore("./memory.db"))

client = agntz(
    agents="./agents",
    resources={"memory": memory.provider()},
    model_provider=LiteLLMModelProvider(),
)

result = client.agents.run(
    agent_id="support-agent",
    input="Schedule me for Tuesday again.",
    context=["org/acme/user/u_123"],   # the capability grant
)
# → "Tuesday at 7am, same as last week. Confirmed."`;

type Tab = "yaml" | "runner";

export function MemrezHero() {
	const [tab, setTab] = useState<Tab>("yaml");
	const [copied, setCopied] = useState(false);
	const { language } = usePreferredLanguage();
	const a = ACCENTS.terracotta;
	const runnerCode = language === "python" ? HERO_RUNNER_PY : HERO_RUNNER_TS;
	const runnerLabel = language === "python" ? "runner.py" : "runner.ts";
	const installPrefix = language === "python" ? "pip install" : "npm install";
	const installPackage =
		language === "python" ? '"agntz[litellm]"' : "@agntz/memrez";

	async function copyActive() {
		const text = tab === "yaml" ? HERO_YAML : runnerCode;
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard unavailable
		}
	}

	return (
		<Section
			dense
			style={{ paddingTop: 76, paddingBottom: 88, overflow: "hidden" }}
		>
			<BgGrid />

			<div
				style={{
					position: "relative",
					display: "grid",
					gridTemplateColumns: "1.04fr 0.96fr",
					gap: 64,
					alignItems: "center",
				}}
			>
				<Stack gap={28}>
					<Row gap={8} style={{ alignItems: "center", flexWrap: "wrap" }}>
						<Pill accent="terracotta" dot>
							memrez 2.x
						</Pill>
						<Pill mono>tagged memory</Pill>
						<Pill mono>open source</Pill>
						<LanguageToggle compact label="Hero examples" />
					</Row>

					<H1 size={76} style={{ maxWidth: 680, letterSpacing: "-0.04em" }}>
						Give your agent
						<br />
						<span style={{ color: TOKENS.muted }}>memory that lasts.</span>
					</H1>

					<Lede style={{ fontSize: 19, maxWidth: 580 }}>
						A durable memory layer for agntz agents. Declare it in YAML, ground
						every read in a capability grant, and let the runtime tag, dedupe,
						and curate in the background — so what your agent learns on Monday
						is still useful on Friday.
					</Lede>

					<div
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 12,
							padding: "12px 16px",
							background: TOKENS.surface,
							border: `1px solid ${TOKENS.line}`,
							borderRadius: 8,
							fontFamily: "var(--mono)",
							fontSize: 13.5,
							alignSelf: "flex-start",
							boxShadow: "0 1px 0 rgba(26,25,22,0.03)",
						}}
					>
						<span style={{ color: TOKENS.muted }}>$</span>
						<span>
							<span style={{ color: TOKENS.text2 }}>{installPrefix}</span>{" "}
							{installPackage}
						</span>
						<span
							style={{
								width: 1,
								height: 16,
								background: TOKENS.line,
								margin: "0 4px",
							}}
						/>
						<span
							style={{
								color: TOKENS.muted,
								fontSize: 10.5,
								letterSpacing: "0.14em",
								textTransform: "uppercase",
								cursor: "pointer",
							}}
						>
							copy
						</span>
					</div>

					<Row gap={10} style={{ marginTop: 4, flexWrap: "wrap" }}>
						<Btn primary size="lg" href="/docs">
							Quickstart <ArrowIcon />
						</Btn>
						<Btn
							size="lg"
							icon={<GithubIcon />}
							href="https://github.com/aparry3/agntz"
						>
							View on GitHub <ExternalIcon />
						</Btn>
					</Row>

					<Row
						gap={20}
						style={{
							marginTop: 8,
							alignItems: "center",
							color: TOKENS.text2,
							fontSize: 13,
							flexWrap: "wrap",
						}}
					>
						{[
							"Tags-first · embeddings optional",
							"Capability-scoped, never cross-tenant",
							"Embedded · Hosted · Self-host",
						].map((t) => (
							<Row key={t} gap={6} style={{ alignItems: "center" }}>
								<span style={{ color: a.fg, display: "inline-flex" }}>
									<CheckIcon />
								</span>
								{t}
							</Row>
						))}
					</Row>
				</Stack>

				<Stack gap={0} style={{ position: "relative" }}>
					<div
						style={{
							background: TOKENS.surface,
							border: `1px solid ${TOKENS.line}`,
							borderRadius: 12,
							overflow: "hidden",
							boxShadow:
								"0 24px 60px rgba(26,25,22,0.10), 0 4px 14px rgba(26,25,22,0.05)",
						}}
					>
						<Row
							style={{
								alignItems: "center",
								justifyContent: "space-between",
								background: TOKENS.warm,
								borderBottom: `1px solid ${TOKENS.line}`,
							}}
						>
							<Row gap={0}>
								{[
									{ id: "yaml" as const, label: "agent.yaml" },
									{ id: "runner" as const, label: runnerLabel },
								].map((tb) => (
									<button
										key={tb.id}
										type="button"
										onClick={() => setTab(tb.id)}
										style={{
											padding: "11px 18px",
											border: 0,
											background:
												tab === tb.id ? TOKENS.surface : "transparent",
											borderRight: `1px solid ${TOKENS.line}`,
											borderBottom:
												tab === tb.id
													? `2px solid ${TOKENS.ink}`
													: "2px solid transparent",
											marginBottom: -1,
											fontFamily: "var(--mono)",
											fontSize: 12,
											color: tab === tb.id ? TOKENS.ink : TOKENS.muted,
											fontWeight: tab === tb.id ? 600 : 400,
											cursor: "pointer",
											display: "inline-flex",
											alignItems: "center",
											gap: 8,
										}}
									>
										<CodeIcon />
										{tb.label}
									</button>
								))}
							</Row>
							<button
								type="button"
								onClick={copyActive}
								aria-label={`Copy ${tab === "yaml" ? "agent.yaml" : runnerLabel} to clipboard`}
								style={{
									marginRight: 8,
									padding: "6px 10px",
									border: 0,
									background: "transparent",
									fontFamily: "var(--mono)",
									fontSize: 10,
									letterSpacing: "0.14em",
									textTransform: "uppercase",
									color: copied ? ACCENTS.green.fg : TOKENS.muted,
									cursor: "pointer",
									borderRadius: 4,
									transition: "color 120ms ease",
								}}
							>
								{copied ? "copied" : "copy"}
							</button>
						</Row>

						<pre
							style={{
								margin: 0,
								padding: "16px 18px",
								fontFamily: "var(--mono)",
								fontSize: 12.5,
								lineHeight: 1.65,
								color: TOKENS.ink,
								overflowX: "auto",
								whiteSpace: "pre-wrap",
								overflowWrap: "anywhere",
								minHeight: 380,
							}}
						>
							<code>
								{tab === "yaml"
									? highlightYAML(HERO_YAML)
									: language === "python"
										? highlightPython(runnerCode)
										: highlightTS(runnerCode)}
							</code>
						</pre>

						<Row
							style={{
								alignItems: "center",
								justifyContent: "space-between",
								padding: "10px 14px",
								borderTop: `1px solid ${TOKENS.line}`,
								background: TOKENS.warm,
							}}
						>
							<Row gap={8} style={{ alignItems: "center" }}>
								<span
									style={{
										width: 8,
										height: 8,
										borderRadius: 99,
										background: ACCENTS.green.fg,
									}}
								/>
								<span
									style={{
										fontFamily: "var(--mono)",
										fontSize: 11,
										color: TOKENS.text2,
									}}
								>
									{tab === "yaml"
										? "valid · resource slot filled"
										: language === "python"
											? "python · runs locally"
											: "grant-scoped · runs anywhere"}
								</span>
							</Row>
							<span
								style={{
									fontFamily: "var(--mono)",
									fontSize: 10.5,
									color: TOKENS.muted,
								}}
							>
								{tab === "yaml"
									? "support-agent.yaml"
									: language === "python"
										? "memrez · python"
										: "memrez · @agntz/sdk"}
							</span>
						</Row>
					</div>

					<div
						style={{
							marginTop: 14,
							padding: "12px 16px",
							border: `1px dashed ${a.line}`,
							borderRadius: 8,
							background: `${a.bg}70`,
							display: "flex",
							alignItems: "center",
							gap: 12,
						}}
					>
						<span style={{ color: a.fg, display: "inline-flex" }}>
							<SparkIcon />
						</span>
						<span style={{ fontSize: 13, color: TOKENS.ink, lineHeight: 1.45 }}>
							The YAML <i>declares</i> the slot. memrez <i>fills</i> it. The
							model picks the topic, never the namespace —{" "}
							<b style={{ fontWeight: 600 }}>
								the grant decides what&apos;s reachable.
							</b>
						</span>
					</div>
				</Stack>
			</div>
		</Section>
	);
}

function BgGrid() {
	return (
		<div
			aria-hidden
			style={{
				position: "absolute",
				inset: 0,
				backgroundImage: `linear-gradient(${TOKENS.line} 1px, transparent 1px), linear-gradient(90deg, ${TOKENS.line} 1px, transparent 1px)`,
				backgroundSize: "56px 56px",
				backgroundPosition: "-1px -1px",
				opacity: 0.5,
				mask: "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)",
				WebkitMask:
					"radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)",
				pointerEvents: "none",
			}}
		/>
	);
}
