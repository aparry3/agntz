import { highlightYAML } from "../landing/code-block";
import {
	ArrowIcon,
	CubeIcon,
	ExternalIcon,
	GithubIcon,
} from "../landing/icons";
import {
	Btn,
	Card,
	H2,
	Lede,
	Pill,
	Row,
	Section,
	Stack,
} from "../landing/primitives";
import { ACCENTS, TOKENS } from "../landing/tokens";

const COMPOSE = `# docker-compose.yml
services:
  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    ports: ["4001:4001"]
    environment:
      - STORE=postgres
      - DATABASE_URL=postgres://postgres:postgres@db:5432/agntz
      - WORKER_INTERNAL_SECRET=\${WORKER_INTERNAL_SECRET}
      - OPENAI_API_KEY=\${OPENAI_API_KEY}
      - MEMREZ_REASONER=llm
      - MEMREZ_CURATE_INTERVAL=30m
    depends_on: [db]

  db:
    image: postgres:17-alpine
    environment:
      - POSTGRES_DB=agntz
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes: [pgdata:/var/lib/postgresql/data]

volumes:
  pgdata:`;

const SERVICES = [
	{ name: "worker", image: "Dockerfile.worker", up: "2d 14h", port: "4001" },
	{ name: "db", image: "postgres:17-alpine", up: "2d 14h", port: "5432" },
];

const REQS: [string, string][] = [
	["Postgres 17+", "agent store + memrez entry/topic store"],
	["Node 22+", "Agntz worker + LLM reasoner runtime"],
	["Provider API key", "default agent model + memrez LLM reasoner"],
	["Docker · Kubernetes", "deploy pattern of your choice"],
];

export function MemrezSelfHostedSpotlight() {
	const a = ACCENTS.terracotta;

	return (
		<Section
			id="self-hosted"
			kicker="Self-hosted spotlight"
			style={{ background: TOKENS.surface }}
		>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "0.9fr 1.1fr",
					gap: 72,
					alignItems: "center",
				}}
			>
				<Stack gap={24}>
					<H2 size={56} style={{ letterSpacing: "-0.035em" }}>
						Run memrez
						<br />
						<span style={{ color: TOKENS.muted }}>yourself.</span>
					</H2>
					<Lede>
						The Agntz worker hosts the memory provider and optional curation
						sweep. Postgres stores agents, runs, traces, and memrez entries.
					</Lede>

					<Stack gap={6} style={{ marginTop: 4 }}>
						<span
							style={{
								fontFamily: "var(--mono)",
								fontSize: 10.5,
								letterSpacing: "0.18em",
								textTransform: "uppercase",
								color: TOKENS.muted,
								marginBottom: 4,
							}}
						>
							requirements
						</span>
						{REQS.map(([k, v]) => (
							<Row
								key={k}
								gap={10}
								style={{
									alignItems: "baseline",
									fontFamily: "var(--mono)",
									fontSize: 12.5,
								}}
							>
								<span style={{ color: a.fg, fontWeight: 500, minWidth: 200 }}>
									{k}
								</span>
								<span style={{ color: TOKENS.muted }}>{v}</span>
							</Row>
						))}
					</Stack>

					<Row gap={10} style={{ marginTop: 8, flexWrap: "wrap" }}>
						<Btn primary href="/docs/deploy/self-host-production">
							Read the self-host guide <ArrowIcon />
						</Btn>
						<Btn
							icon={<GithubIcon />}
							href="https://github.com/aparry3/agntz"
							newTab
						>
							memrez/self-host <ExternalIcon />
						</Btn>
					</Row>
				</Stack>

				<Card
					style={{
						overflow: "hidden",
						padding: 0,
						boxShadow:
							"0 20px 60px rgba(26,25,22,0.10), 0 4px 12px rgba(26,25,22,0.05)",
					}}
				>
					<Row
						style={{
							alignItems: "center",
							justifyContent: "space-between",
							padding: "10px 14px",
							borderBottom: `1px solid ${TOKENS.line}`,
							background: TOKENS.warm,
						}}
					>
						<Row gap={6} style={{ alignItems: "center" }}>
							<span
								style={{
									width: 9,
									height: 9,
									borderRadius: 99,
									background: TOKENS.line,
								}}
							/>
							<span
								style={{
									width: 9,
									height: 9,
									borderRadius: 99,
									background: TOKENS.line,
								}}
							/>
							<span
								style={{
									width: 9,
									height: 9,
									borderRadius: 99,
									background: TOKENS.line,
								}}
							/>
							<span
								style={{
									marginLeft: 14,
									fontFamily: "var(--mono)",
									fontSize: 11.5,
									color: TOKENS.text2,
								}}
							>
								~/agntz / docker-compose.yml
							</span>
						</Row>
						<Pill mono>2 services</Pill>
					</Row>

					<pre
						style={{
							margin: 0,
							padding: "16px 18px",
							fontFamily: "var(--mono)",
							fontSize: 12,
							lineHeight: 1.65,
							color: TOKENS.ink,
							background: TOKENS.surface2,
							overflowX: "auto",
							whiteSpace: "pre",
						}}
					>
						<code>{highlightYAML(COMPOSE)}</code>
					</pre>

					<Row
						gap={10}
						style={{
							alignItems: "center",
							padding: "10px 16px",
							borderTop: `1px solid ${TOKENS.line}`,
							borderBottom: `1px solid ${TOKENS.line}`,
							background: TOKENS.warm,
							fontFamily: "var(--mono)",
							fontSize: 12,
						}}
					>
						<span style={{ color: TOKENS.muted }}>$</span>
						<span style={{ color: TOKENS.ink }}>docker compose up -d</span>
						<span style={{ flex: 1 }} />
						<Row
							gap={6}
							style={{ alignItems: "center", color: ACCENTS.green.fg }}
						>
							<span
								style={{
									width: 6,
									height: 6,
									borderRadius: 99,
									background: ACCENTS.green.fg,
								}}
							/>
							<span
								style={{
									fontSize: 11,
									color: ACCENTS.green.fg,
									fontWeight: 500,
								}}
							>
								all healthy
							</span>
						</Row>
					</Row>

					<div style={{ background: TOKENS.surface }}>
						<Row
							style={{
								padding: "10px 16px 6px",
								fontFamily: "var(--mono)",
								fontSize: 9.5,
								letterSpacing: "0.14em",
								textTransform: "uppercase",
								color: TOKENS.muted,
							}}
						>
							<span style={{ width: 130 }}>service</span>
							<span style={{ flex: 1 }}>image</span>
							<span style={{ width: 60, textAlign: "right" }}>port</span>
							<span style={{ width: 70, textAlign: "right" }}>up</span>
							<span style={{ width: 70, textAlign: "right" }}>status</span>
						</Row>
						{SERVICES.map((s) => (
							<Row
								key={s.name}
								style={{
									padding: "8px 16px",
									borderTop: `1px dashed ${TOKENS.line2}`,
									alignItems: "center",
									fontFamily: "var(--mono)",
									fontSize: 11.5,
								}}
							>
								<Row gap={8} style={{ width: 130, alignItems: "center" }}>
									<span style={{ color: a.fg, display: "inline-flex" }}>
										<CubeIcon />
									</span>
									<span style={{ color: TOKENS.ink, fontWeight: 500 }}>
										{s.name}
									</span>
								</Row>
								<span style={{ flex: 1, color: TOKENS.text2 }}>{s.image}</span>
								<span
									style={{
										width: 60,
										textAlign: "right",
										color: TOKENS.muted,
									}}
								>
									{s.port === "—" ? s.port : `:${s.port}`}
								</span>
								<span
									style={{
										width: 70,
										textAlign: "right",
										color: TOKENS.text2,
									}}
								>
									{s.up}
								</span>
								<Row
									gap={5}
									style={{
										width: 70,
										justifyContent: "flex-end",
										alignItems: "center",
									}}
								>
									<span
										style={{
											width: 5,
											height: 5,
											borderRadius: 99,
											background: ACCENTS.green.fg,
										}}
									/>
									<span style={{ color: ACCENTS.green.fg, fontSize: 11 }}>
										running
									</span>
								</Row>
							</Row>
						))}
					</div>
				</Card>
			</div>
		</Section>
	);
}
