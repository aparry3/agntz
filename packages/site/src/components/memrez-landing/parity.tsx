import { CodeBlock } from "../landing/code-block";
import { BranchIcon } from "../landing/icons";
import { H2, Lede, Pill, Row, Section, Stack } from "../landing/primitives";
import { ACCENTS, TOKENS } from "../landing/tokens";

const REASONER_PROMPT = `You normalize one memory fact.

Choose the most specific allowed namespace,
reuse existing lowercase topics when possible,
classify the entry type, and return strict JSON.

Never invent data beyond the supplied content.`;

const TS_RUNTIME = `import { createMemrez, PostgresMemoryStore } from '@agntz/memrez';

const memory = createMemrez({
  store: new PostgresMemoryStore(process.env.DATABASE_URL!),
  // reasoner defaults to memrez's built-in LLM calls
});

await memory.write(grants, 'Prefers email.');`;

const PY_RUNTIME = `import os

from agntz.memrez import create_memrez
from agntz.memrez_postgres import PostgresMemoryStore

memory = create_memrez(
    store=PostgresMemoryStore(os.environ["DATABASE_URL"]),
    # same reasoner contract
)

memory.write(grants, "Prefers email.")`;

export function MemrezParity() {
	const a = ACCENTS.terracotta;

	return (
		<Section id="parity" kicker="Parity">
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
					One brain.
					<br />
					<span style={{ color: TOKENS.muted }}>Two runtimes.</span>
				</H2>
				<Lede>
					The tagger and curator aren&apos;t user-facing agents — they&apos;re
					memrez-owned structured LLM calls. The same{" "}
					<code
						style={{
							fontFamily: "var(--mono)",
							fontSize: "0.9em",
							background: a.bg,
							color: a.fg,
							padding: "1px 6px",
							borderRadius: 4,
							border: `1px solid ${a.line}`,
						}}
					>
						reasoner contract
					</code>{" "}
					runs from memrez runtimes. Behavior stays identical because the
					input/output contract stays identical.
				</Lede>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1.1fr 1fr 1fr",
					gap: 18,
				}}
			>
				<Stack gap={12}>
					<Row gap={8} style={{ alignItems: "center" }}>
						<Pill accent="terracotta" dot mono>
							the brain
						</Pill>
						<span
							style={{
								fontFamily: "var(--mono)",
								fontSize: 11,
								color: a.fg,
								letterSpacing: "0.12em",
								textTransform: "uppercase",
							}}
						>
							reasoner contract
						</span>
					</Row>
					<CodeBlock filename="reasoner.txt" lang="text" wrap>
						{REASONER_PROMPT}
					</CodeBlock>
				</Stack>

				<Stack gap={12}>
					<Row gap={8} style={{ alignItems: "center" }}>
						<Pill mono>typescript runtime</Pill>
					</Row>
					<CodeBlock filename="memrez.ts" lang="ts">
						{TS_RUNTIME}
					</CodeBlock>
				</Stack>

				<Stack gap={12}>
					<Row gap={8} style={{ alignItems: "center" }}>
						<Pill mono>python runtime</Pill>
					</Row>
					<CodeBlock filename="memrez.py" lang="python">
						{PY_RUNTIME}
					</CodeBlock>
				</Stack>
			</div>

			<Row
				gap={14}
				style={{
					marginTop: 32,
					padding: "16px 20px",
					background: TOKENS.surface2,
					border: `1px solid ${TOKENS.line}`,
					borderRadius: 10,
					alignItems: "center",
				}}
			>
				<span style={{ color: a.fg, display: "inline-flex" }}>
					<BranchIcon />
				</span>
				<span
					style={{
						fontSize: 14,
						color: TOKENS.text2,
						flex: 1,
						lineHeight: 1.5,
					}}
				>
					<b style={{ color: TOKENS.ink, fontWeight: 600 }}>
						The contract is the manifest, not the SDK.
					</b>{" "}
					A fixture under <code>contracts/memrez/</code> runs in both runtimes
					with a deterministic fake reasoner — LLM nondeterminism stays out of
					CI.
				</span>
			</Row>
		</Section>
	);
}
