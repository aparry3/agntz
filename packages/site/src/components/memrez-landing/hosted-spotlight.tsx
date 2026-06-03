import { ArrowIcon, BranchIcon, PinIcon } from "../landing/icons";
import { Btn, H2, Lede, Row, Section, Stack } from "../landing/primitives";
import { ACCENTS, TOKENS } from "../landing/tokens";

type Topic = {
	name: string;
	count: number;
	blurb: string;
	active?: boolean;
};

const SCOPE_TREE = [
	{ label: "org/", depth: 0, muted: true },
	{ label: "acme/", depth: 1, muted: true },
	{ label: "kb/", depth: 2, muted: true },
	{ label: "product-docs", depth: 3, muted: true },
	{ label: "user/", depth: 2, muted: false },
	{ label: "u_123", depth: 3, active: true },
	{ label: "u_124", depth: 3, muted: true },
	{ label: "u_125", depth: 3, muted: true },
];

const TOPICS: Topic[] = [
	{
		name: "prefs",
		count: 7,
		blurb: "early mornings, email-first, no phone calls",
		active: true,
	},
	{
		name: "billing",
		count: 4,
		blurb: "card on file, prefers invoice for amounts > $500",
	},
	{
		name: "schedule",
		count: 12,
		blurb: "Tuesday 7am standing, no Fridays",
	},
	{
		name: "contact",
		count: 3,
		blurb: "aaron@acme.com, EST timezone",
	},
	{
		name: "history",
		count: 18,
		blurb: "5 sessions, last touched 2026-05-22",
	},
];

const ENTRIES = [
	{
		text: "Prefers email over phone for all confirmations.",
		when: "2026-05-22",
		tag: "current",
		superseded: false,
	},
	{
		text: "Email-first; phone only for urgent reschedules.",
		when: "2026-04-14",
		tag: "older",
		superseded: false,
	},
	{
		text: "No phone calls.",
		when: "2026-02-08",
		tag: "merged → current",
		superseded: true,
	},
	{
		text: "Likes early morning slots, before 9am EST.",
		when: "2026-01-30",
		tag: "current",
		superseded: false,
	},
];

export function MemrezHostedSpotlight() {
	const a = ACCENTS.terracotta;

	return (
		<Section id="hosted" kicker="Hosted spotlight">
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
					Inspect every fact.
					<br />
					<span style={{ color: TOKENS.muted }}>Without a query.</span>
				</H2>
				<Lede>
					When you&apos;re ready for visibility — a TOC view of every topic, the
					full history behind each fact, supersede chains, curator runs — your
					existing <code>memrez.provider()</code> call moves with you. Same
					grant model, more surface.
				</Lede>
			</div>

			<div
				style={{
					borderRadius: 16,
					overflow: "hidden",
					border: `1px solid ${TOKENS.line}`,
					boxShadow:
						"0 32px 80px rgba(26,25,22,0.14), 0 6px 18px rgba(26,25,22,0.06)",
					background: TOKENS.surface2,
				}}
			>
				{/* App chrome */}
				<Row
					style={{
						alignItems: "center",
						justifyContent: "space-between",
						padding: "12px 18px",
						borderBottom: `1px solid ${TOKENS.line}`,
						background: TOKENS.warm,
					}}
				>
					<Row gap={8} style={{ alignItems: "center" }}>
						<span
							style={{
								width: 10,
								height: 10,
								borderRadius: 99,
								background: TOKENS.line,
							}}
						/>
						<span
							style={{
								width: 10,
								height: 10,
								borderRadius: 99,
								background: TOKENS.line,
							}}
						/>
						<span
							style={{
								width: 10,
								height: 10,
								borderRadius: 99,
								background: TOKENS.line,
							}}
						/>
						<span
							style={{
								marginLeft: 14,
								fontFamily: "var(--mono)",
								fontSize: 12,
								color: TOKENS.text2,
							}}
						>
							memrez.co / explorer / org/acme/user/u_123
						</span>
					</Row>
					<Row gap={8} style={{ alignItems: "center" }}>
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
								fontFamily: "var(--mono)",
								fontSize: 11,
								color: TOKENS.text2,
							}}
						>
							last curate: 2h ago · merged 12 · superseded 3
						</span>
					</Row>
				</Row>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "200px 1fr 320px",
						minHeight: 460,
					}}
				>
					{/* Left rail — namespace tree */}
					<div
						style={{
							borderRight: `1px solid ${TOKENS.line}`,
							padding: "16px 14px",
							background: TOKENS.surface,
						}}
					>
						<span
							style={{
								fontFamily: "var(--mono)",
								fontSize: 10,
								letterSpacing: "0.18em",
								textTransform: "uppercase",
								color: TOKENS.muted,
								display: "block",
								marginBottom: 12,
							}}
						>
							namespaces
						</span>
						<Stack gap={4}>
							{SCOPE_TREE.map((n) => (
								<div
									key={`${n.label}-${n.depth}`}
									style={{
										paddingLeft: n.depth * 10,
										fontFamily: "var(--mono)",
										fontSize: 12,
										color: n.active ? TOKENS.ink : TOKENS.muted,
										background: n.active ? a.bg : "transparent",
										padding: `4px ${4 + n.depth * 10}px`,
										borderRadius: 4,
										fontWeight: n.active ? 600 : 400,
									}}
								>
									{n.depth > 0 && (
										<span style={{ color: TOKENS.line, marginRight: 4 }}>
											└
										</span>
									)}
									{n.label}
								</div>
							))}
						</Stack>
					</div>

					{/* Middle — topic TOC */}
					<div style={{ padding: "20px 22px", background: TOKENS.surface2 }}>
						<Row
							style={{
								alignItems: "baseline",
								justifyContent: "space-between",
								marginBottom: 16,
							}}
						>
							<Stack gap={4}>
								<span
									style={{
										fontFamily: "var(--mono)",
										fontSize: 10,
										letterSpacing: "0.18em",
										textTransform: "uppercase",
										color: TOKENS.muted,
									}}
								>
									topics for u_123
								</span>
								<span
									style={{ fontSize: 18, fontWeight: 500, color: TOKENS.ink }}
								>
									5 topics · 44 entries
								</span>
							</Stack>
							<span
								style={{
									fontFamily: "var(--mono)",
									fontSize: 11,
									padding: "4px 8px",
									background: a.bg,
									color: a.fg,
									borderRadius: 4,
								}}
							>
								+ ancestors visible
							</span>
						</Row>
						<Stack gap={6}>
							{TOPICS.map((t) => (
								<div
									key={t.name}
									style={{
										padding: "12px 14px",
										background: t.active ? a.bg : TOKENS.surface,
										border: `1px solid ${t.active ? a.line : TOKENS.line}`,
										borderRadius: 8,
										display: "grid",
										gridTemplateColumns: "120px 1fr 50px",
										gap: 12,
										alignItems: "center",
									}}
								>
									<Row gap={8} style={{ alignItems: "center" }}>
										<span
											style={{
												color: t.active ? a.fg : TOKENS.muted,
												display: "inline-flex",
											}}
										>
											<BranchIcon />
										</span>
										<span
											style={{
												fontFamily: "var(--mono)",
												fontSize: 13,
												color: t.active ? a.fg : TOKENS.ink,
												fontWeight: t.active ? 600 : 500,
											}}
										>
											{t.name}
										</span>
									</Row>
									<span
										style={{
											fontSize: 12.5,
											color: TOKENS.text2,
											lineHeight: 1.4,
										}}
									>
										{t.blurb}
									</span>
									<span
										style={{
											fontFamily: "var(--mono)",
											fontSize: 11,
											color: TOKENS.muted,
											textAlign: "right",
										}}
									>
										{t.count} live
									</span>
								</div>
							))}
						</Stack>
					</div>

					{/* Right rail — entries in focused topic */}
					<div
						style={{
							borderLeft: `1px solid ${TOKENS.line}`,
							padding: "20px 18px",
							background: TOKENS.surface,
						}}
					>
						<Stack gap={4} style={{ marginBottom: 14 }}>
							<span
								style={{
									fontFamily: "var(--mono)",
									fontSize: 10,
									letterSpacing: "0.18em",
									textTransform: "uppercase",
									color: TOKENS.muted,
								}}
							>
								entries · prefs
							</span>
							<Row gap={6} style={{ alignItems: "center" }}>
								<span style={{ color: a.fg, display: "inline-flex" }}>
									<PinIcon />
								</span>
								<span
									style={{
										fontSize: 13,
										fontWeight: 600,
										color: TOKENS.ink,
									}}
								>
									supersede chain visible
								</span>
							</Row>
						</Stack>
						<Stack gap={8}>
							{ENTRIES.map((e) => (
								<div
									key={e.text}
									style={{
										padding: "10px 12px",
										background: e.superseded ? "transparent" : TOKENS.surface2,
										border: `1px solid ${
											e.superseded ? TOKENS.line2 : TOKENS.line
										}`,
										borderRadius: 6,
										opacity: e.superseded ? 0.55 : 1,
									}}
								>
									<p
										style={{
											margin: "0 0 6px",
											fontSize: 12.5,
											lineHeight: 1.5,
											color: TOKENS.ink,
											textDecoration: e.superseded ? "line-through" : "none",
										}}
									>
										{e.text}
									</p>
									<Row
										style={{
											alignItems: "center",
											justifyContent: "space-between",
										}}
									>
										<span
											style={{
												fontFamily: "var(--mono)",
												fontSize: 10,
												color: TOKENS.muted,
											}}
										>
											{e.when}
										</span>
										<span
											style={{
												fontFamily: "var(--mono)",
												fontSize: 10,
												padding: "2px 6px",
												borderRadius: 3,
												background: e.superseded
													? TOKENS.line2
													: e.tag === "current"
														? ACCENTS.green.bg
														: TOKENS.warm,
												color: e.superseded
													? TOKENS.muted
													: e.tag === "current"
														? ACCENTS.green.fg
														: TOKENS.text2,
											}}
										>
											{e.tag}
										</span>
									</Row>
								</div>
							))}
						</Stack>
					</div>
				</div>
			</div>

			<Row
				gap={12}
				style={{ marginTop: 40, alignItems: "center", flexWrap: "wrap" }}
			>
				<Btn primary href="https://app.agntz.co" newTab>
					See hosted <ArrowIcon />
				</Btn>
				<span style={{ fontSize: 13, color: TOKENS.muted, marginLeft: 8 }}>
					Free tier · no credit card · same memrez client works locally.
				</span>
			</Row>
		</Section>
	);
}
