"use client";

import { CodeBlock } from "../landing/code-block";
import { ArrowIcon } from "../landing/icons";
import { Card, H2, Lede, Pill, Row, Section } from "../landing/primitives";
import { ACCENTS, TOKENS } from "../landing/tokens";
import { LanguageToggle, usePreferredLanguage } from "../language";

const LIB_CODE_TS = `// Hand-rolled: pgvector + glue + scope filters.
import { Pool } from 'pg';
import OpenAI from 'openai';

const pg = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI();

async function remember(scope, fact) {
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: fact,
  });
  // dedupe? topics? supersede? you write all of it.
  await pg.query(
    \`INSERT INTO memories (scope, content, embedding)
     VALUES ($1, $2, $3)\`,
    [scope, fact, embedding.data[0].embedding],
  );
}

async function recall(scope, query) {
  const e = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  // hope your scope filter is right; hope nothing leaks.
  const { rows } = await pg.query(
    \`SELECT content FROM memories
     WHERE scope LIKE $1 || '%'
     ORDER BY embedding <-> $2 LIMIT 8\`,
    [scope, e.data[0].embedding],
  );
  return rows;
}

// + a cron job to dedupe.
// + a curator to reconcile contradictions.
// + retries, redaction, audit log, ...`;

const LIB_CODE_PY = `# Hand-rolled: pgvector + glue + scope filters.
import os
import psycopg
from openai import OpenAI

pg = psycopg.connect(os.environ["DATABASE_URL"])
openai = OpenAI()

def remember(scope, fact):
    e = openai.embeddings.create(
        model="text-embedding-3-small",
        input=fact,
    )
    # dedupe? topics? supersede? you write all of it.
    pg.execute(
        "INSERT INTO memories (scope, content, embedding) "
        "VALUES (%s, %s, %s)",
        (scope, fact, e.data[0].embedding),
    )

def recall(scope, query):
    e = openai.embeddings.create(
        model="text-embedding-3-small",
        input=query,
    )
    # hope your scope filter is right; hope nothing leaks.
    rows = pg.execute(
        "SELECT content FROM memories "
        "WHERE scope LIKE %s || '%%' "
        "ORDER BY embedding <-> %s LIMIT 8",
        (scope, e.data[0].embedding),
    ).fetchall()
    return rows

# + a cron job to dedupe.
# + a curator to reconcile contradictions.
# + retries, redaction, audit log, ...`;

const MEMREZ_CODE = `# With memrez — declare the slot, pass the grant.
resources:
  memory:
    mode: read-write
    autoScan: true
    writePolicy:
      descendants: true
      ancestorPromotion: none`;

const ROWS: [string, string][] = [
	[
		"Embed everything; pray for relevance",
		"Tag on write; scan TOC; read on demand",
	],
	[
		"One bucket — hope your scope filter is right",
		"Hierarchical scope + grants enforced by the runtime",
	],
	["Duplicates accumulate forever", "Append-only + supersede; curator merges"],
	[
		"Model picks the namespace (and sometimes the wrong one)",
		"Model picks the topic; namespace comes from the grant",
	],
	[
		"Vector DB + retrieval glue + auth wrapper",
		"One resource declaration in your agntz YAML",
	],
	[
		"You own the curation glue",
		"Memrez exposes curation primitives; your app schedules them",
	],
];

export function MemrezTheShift() {
	const a = ACCENTS.terracotta;
	const { language } = usePreferredLanguage();
	const libraryCode = language === "python" ? LIB_CODE_PY : LIB_CODE_TS;
	const libraryLabel =
		language === "python" ? "psycopg + openai" : "pg + openai";
	const libraryFilename =
		language === "python" ? "support-memory.py" : "support-memory.ts";
	const runSnippet =
		language === "python"
			? 'client.agents.run(..., context=["org/acme/user/u_123"])'
			: "client.agents.run({ ..., context: ['org/acme/user/u_123'] })";

	return (
		<Section
			id="shift"
			kicker="The shift"
			style={{ background: TOKENS.surface }}
		>
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
					A memory layer,
					<br />
					<span style={{ color: TOKENS.muted }}>not a vector dump.</span>
				</H2>
				<Lede>
					Most &quot;agent memory&quot; is a bag of embeddings with no scope, no
					curation, and no recourse when two facts contradict.{" "}
					<b style={{ color: TOKENS.ink, fontWeight: 600 }}>
						memrez is opinionated
					</b>{" "}
					— small tagged facts, owning scopes, append-only with reconciliation
					in the background.
				</Lede>
			</div>

			<Card style={{ overflow: "hidden", marginBottom: 28 }}>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						borderBottom: `1px solid ${TOKENS.line}`,
						background: TOKENS.warm,
					}}
				>
					<div style={{ padding: "18px 22px" }}>
						<Row gap={8} style={{ alignItems: "center", marginBottom: 4 }}>
							<span
								style={{
									width: 8,
									height: 8,
									borderRadius: 2,
									background: TOKENS.muted,
								}}
							/>
							<span style={{ fontWeight: 600, fontSize: 15 }}>
								Vector store, hand-rolled
							</span>
							<Pill mono style={{ marginLeft: 4 }}>
								{libraryLabel}
							</Pill>
							<LanguageToggle compact label="Library example" />
						</Row>
						<span style={{ fontSize: 13, color: TOKENS.text2 }}>
							Embeddings + glue. You own the policy.
						</span>
					</div>
					<div
						style={{
							padding: "18px 22px",
							borderLeft: `1px solid ${TOKENS.line}`,
							background: a.bg,
						}}
					>
						<Row gap={8} style={{ alignItems: "center", marginBottom: 4 }}>
							<span
								style={{
									width: 8,
									height: 8,
									borderRadius: 2,
									background: a.fg,
								}}
							/>
							<span style={{ fontWeight: 600, fontSize: 15 }}>With memrez</span>
							<Pill accent="terracotta" mono style={{ marginLeft: 4 }}>
								declared memory
							</Pill>
						</Row>
						<span style={{ fontSize: 13, color: TOKENS.text2 }}>
							A slot. The runtime owns the policy.
						</span>
					</div>
				</div>
				{ROWS.map((r, i) => (
					<div
						key={r[0]}
						style={{
							display: "grid",
							gridTemplateColumns: "1fr 1fr",
							borderBottom:
								i < ROWS.length - 1 ? `1px solid ${TOKENS.line2}` : "none",
							background: i % 2 === 1 ? TOKENS.warm : TOKENS.surface2,
						}}
					>
						<div
							style={{
								padding: "16px 22px",
								fontSize: 14,
								color: TOKENS.text2,
								display: "flex",
								alignItems: "center",
								gap: 10,
							}}
						>
							<span
								style={{
									fontFamily: "var(--mono)",
									fontSize: 10.5,
									color: TOKENS.muted,
									letterSpacing: "0.12em",
									textTransform: "uppercase",
									width: 16,
								}}
							>
								0{i + 1}
							</span>
							{r[0]}
						</div>
						<div
							style={{
								padding: "16px 22px",
								borderLeft: `1px solid ${TOKENS.line2}`,
								fontSize: 14,
								fontWeight: 500,
								color: TOKENS.ink,
								background: `${a.bg}55`,
								display: "flex",
								alignItems: "center",
								gap: 10,
							}}
						>
							<span style={{ color: a.fg, display: "inline-flex" }}>
								<ArrowIcon />
							</span>
							{r[1]}
						</div>
					</div>
				))}
			</Card>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
				<div>
					<Row gap={8} style={{ alignItems: "center", marginBottom: 10 }}>
						<Pill mono>before</Pill>
						<span
							style={{
								fontFamily: "var(--mono)",
								fontSize: 11,
								color: TOKENS.muted,
								letterSpacing: "0.12em",
								textTransform: "uppercase",
							}}
						>
							imperative · embeddings, hand-wired
						</span>
					</Row>
					<CodeBlock
						filename={libraryFilename}
						lang={language === "python" ? "python" : "ts"}
					>
						{libraryCode}
					</CodeBlock>
				</div>
				<div>
					<Row gap={8} style={{ alignItems: "center", marginBottom: 10 }}>
						<Pill accent="terracotta" dot mono>
							after
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
							declarative · same memory, declared
						</span>
					</Row>
					<CodeBlock filename="support-agent.yaml" lang="yaml" wrap>
						{MEMREZ_CODE}
					</CodeBlock>
					<div
						style={{
							marginTop: 12,
							padding: "12px 14px",
							border: `1px solid ${TOKENS.line}`,
							borderRadius: 8,
							background: TOKENS.surface2,
							fontFamily: "var(--mono)",
							fontSize: 12.5,
							color: TOKENS.text2,
							display: "flex",
							alignItems: "center",
							gap: 10,
						}}
					>
						<span style={{ color: TOKENS.muted }}>$</span>
						<span style={{ color: TOKENS.ink }}>{runSnippet}</span>
						<span style={{ flex: 1 }} />
						<span style={{ color: TOKENS.muted }}>
							// that&apos;s the whole memory contract
						</span>
					</div>
				</div>
			</div>
		</Section>
	);
}
