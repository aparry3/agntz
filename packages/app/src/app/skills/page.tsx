"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { I } from "@/components/v3/icons";
import { Btn, Crumbs, Mono, ag } from "@/components/v3/primitives";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface SkillSummary {
	name: string;
	description: string;
}

const TEMPLATES: Array<[string, string]> = [
	["refund-policy", "Refund eligibility playbook"],
	["researcher", "Multi-source research"],
	["summarizer", "Long-content distillation"],
	["code-review", "Structured PR review"],
];

export default function SkillsPage() {
	const [skills, setSkills] = useState<SkillSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);
	const [search, setSearch] = useState("");

	const loadSkills = () => {
		fetch("/api/skills")
			.then((r) => r.json())
			.then((data) => setSkills(Array.isArray(data) ? data : []))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		loadSkills();
	}, []);

	const handleDelete = async () => {
		if (!deleteTarget) return;
		await fetch(`/api/skills/${encodeURIComponent(deleteTarget.name)}`, {
			method: "DELETE",
		});
		setDeleteTarget(null);
		loadSkills();
	};

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return skills;
		return skills.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				(s.description ?? "").toLowerCase().includes(q),
		);
	}, [skills, search]);

	return (
		<div
			style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
		>
			{/* Header */}
			<div
				style={{
					padding: "20px 32px 18px",
					borderBottom: `1px solid ${ag.line2}`,
					background: ag.bg,
				}}
			>
				<div style={{ marginBottom: 8 }}>
					<Crumbs trail={["agntz", "Skills"]} />
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "flex-end",
						justifyContent: "space-between",
						gap: 24,
					}}
				>
					<div>
						<h1
							style={{
								margin: 0,
								fontSize: 24,
								fontWeight: 600,
								letterSpacing: "-0.015em",
								color: ag.ink,
							}}
						>
							Skills
						</h1>
						<div
							style={{
								marginTop: 5,
								fontSize: 13,
								color: ag.text2,
								maxWidth: 560,
							}}
						>
							Reusable instruction + tool bundles. Agents declare which skills
							they may load; the LLM opts into one mid-run via{" "}
							<Mono size={11.5} color={ag.text2}>
								use_skill
							</Mono>
							.
						</div>
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<Btn
							variant="secondary"
							icon={<I.Filter size={12} style={{ marginRight: 6 }} />}
						>
							Filter
						</Btn>
						<Link
							href="/skills/new"
							style={{
								background: ag.ink,
								color: ag.surface,
								border: `1px solid ${ag.ink}`,
								borderRadius: 4,
								padding: "6px 11px",
								fontSize: 12.5,
								fontWeight: 500,
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								textDecoration: "none",
							}}
						>
							<I.Plus size={12} />
							New Skill
						</Link>
					</div>
				</div>
			</div>

			{/* Toolbar — only shown when there are skills */}
			{!loading && skills.length > 0 && (
				<div
					style={{
						padding: "10px 32px",
						display: "flex",
						alignItems: "center",
						gap: 10,
						borderBottom: `1px solid ${ag.line2}`,
						background: ag.surface,
						flexWrap: "wrap",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 7,
							padding: "5px 10px",
							border: `1px solid ${ag.line}`,
							background: ag.surface2,
							borderRadius: 4,
							color: ag.muted,
							flex: 1,
							maxWidth: 360,
						}}
					>
						<I.Search size={12} />
						<input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search skills by name or description…"
							style={{
								fontSize: 12,
								flex: 1,
								border: 0,
								outline: 0,
								background: "transparent",
								color: ag.ink,
								fontFamily: "inherit",
							}}
						/>
					</div>
					<div style={{ flex: 1 }} />
					<Mono size={11} color={ag.muted}>
						sort: name ↑
					</Mono>
				</div>
			)}

			{/* Body */}
			<div style={{ padding: "16px 32px 32px", flex: 1, overflow: "auto" }}>
				{loading ? (
					<div
						style={{
							background: ag.surface2,
							border: `1px solid ${ag.line}`,
							borderRadius: 5,
							padding: "60px 24px",
							textAlign: "center",
							color: ag.muted,
							fontSize: 13,
						}}
					>
						Loading skills…
					</div>
				) : skills.length === 0 ? (
					<EmptyState />
				) : filtered.length === 0 ? (
					<div
						style={{
							background: ag.surface2,
							border: `1px solid ${ag.line}`,
							borderRadius: 5,
							padding: "40px 24px",
							textAlign: "center",
							color: ag.muted,
							fontSize: 13,
						}}
					>
						No skills match the current filter.
					</div>
				) : (
					<SkillsTable rows={filtered} onDelete={(s) => setDeleteTarget(s)} />
				)}
			</div>

			<ConfirmDialog
				open={deleteTarget !== null}
				title="Delete Skill"
				message={`Are you sure you want to delete "${deleteTarget?.name ?? ""}"? This cannot be undone.`}
				onConfirm={handleDelete}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}

const COLUMNS = "minmax(280px, 2.5fr) 90px 110px 40px";

function SkillsTable({
	rows,
	onDelete,
}: {
	rows: SkillSummary[];
	onDelete: (s: SkillSummary) => void;
}) {
	return (
		<div
			style={{
				background: ag.surface2,
				border: `1px solid ${ag.line}`,
				borderRadius: 5,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: COLUMNS,
					padding: "9px 16px",
					gap: 12,
					alignItems: "center",
					background: ag.surface,
					borderBottom: `1px solid ${ag.line}`,
					fontSize: 10.5,
					textTransform: "uppercase",
					letterSpacing: "0.08em",
					color: ag.muted,
					fontWeight: 500,
				}}
			>
				<div>Skill</div>
				<div style={{ textAlign: "right" }}>Tools</div>
				<div>Updated</div>
				<div />
			</div>
			{rows.map((row, i) => (
				<SkillRowItem
					key={row.name}
					row={row}
					isLast={i === rows.length - 1}
					onDelete={onDelete}
				/>
			))}
		</div>
	);
}

function SkillRowItem({
	row,
	isLast,
	onDelete,
}: {
	row: SkillSummary;
	isLast: boolean;
	onDelete: (s: SkillSummary) => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<Link
			href={`/skills/${encodeURIComponent(row.name)}`}
			style={{
				display: "grid",
				gridTemplateColumns: COLUMNS,
				padding: "12px 16px",
				gap: 12,
				alignItems: "center",
				borderBottom: isLast ? "none" : `1px solid ${ag.line2}`,
				fontSize: 13,
				textDecoration: "none",
				color: "inherit",
				background: "transparent",
				position: "relative",
			}}
		>
			<div
				style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}
			>
				<div
					style={{
						width: 24,
						height: 24,
						borderRadius: 4,
						flex: "0 0 auto",
						background: ag.warnBg,
						color: ag.warn,
						display: "grid",
						placeItems: "center",
					}}
				>
					<I.Bolt size={12} />
				</div>
				<div style={{ minWidth: 0 }}>
					<Mono size={12.5} color={ag.ink} style={{ fontWeight: 500 }}>
						{row.name}
					</Mono>
					<div
						style={{
							fontSize: 12,
							color: ag.text2,
							marginTop: 2,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{row.description || "—"}
					</div>
				</div>
			</div>
			<Mono
				size={12}
				color={ag.muted}
				style={{ textAlign: "right", display: "block" }}
			>
				—
			</Mono>
			<Mono size={11} color={ag.muted}>
				—
			</Mono>
			<button
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					setMenuOpen((open) => !open);
				}}
				onBlur={() => setTimeout(() => setMenuOpen(false), 120)}
				style={{
					justifySelf: "end",
					background: "transparent",
					border: "1px solid transparent",
					borderRadius: 3,
					color: ag.muted,
					padding: "3px 4px",
					cursor: "pointer",
					fontFamily: "inherit",
				}}
				aria-label="Row actions"
			>
				<I.Ellipsis size={14} />
				{menuOpen && (
					<span
						style={{
							position: "absolute",
							right: 24,
							top: 28,
							background: ag.surface2,
							border: `1px solid ${ag.line}`,
							borderRadius: 4,
							padding: 4,
							minWidth: 140,
							display: "flex",
							flexDirection: "column",
							gap: 2,
							zIndex: 10,
							boxShadow: "0 4px 12px rgba(26,25,22,0.08)",
							textAlign: "left",
						}}
					>
						<span
							style={menuItemStyle}
							onMouseDown={(e) => {
								e.preventDefault();
								e.stopPropagation();
								onDelete(row);
								setMenuOpen(false);
							}}
						>
							Delete skill
						</span>
					</span>
				)}
			</button>
		</Link>
	);
}

const menuItemStyle = {
	padding: "5px 8px",
	borderRadius: 3,
	fontSize: 12,
	color: ag.ink,
	cursor: "pointer",
	display: "block",
} satisfies React.CSSProperties;

function EmptyState() {
	return (
		<div
			style={{
				flex: 1,
				padding: "32px",
				display: "grid",
				placeItems: "center",
			}}
		>
			<div
				style={{
					width: "100%",
					maxWidth: 560,
					padding: "40px 32px",
					border: `1px solid ${ag.line}`,
					borderRadius: 6,
					background: ag.surface2,
					textAlign: "center",
				}}
			>
				<div
					style={{
						width: 38,
						height: 38,
						borderRadius: 6,
						margin: "0 auto 16px",
						background: ag.warnBg,
						color: ag.warn,
						display: "grid",
						placeItems: "center",
					}}
				>
					<I.Bolt size={18} />
				</div>
				<div
					style={{
						fontSize: 17,
						fontWeight: 600,
						color: ag.ink,
						letterSpacing: "-0.01em",
					}}
				>
					No skills yet
				</div>
				<div
					style={{
						marginTop: 8,
						fontSize: 13,
						color: ag.text2,
						lineHeight: 1.55,
					}}
				>
					A skill is an instruction + tools bundle an LLM can load mid-run.
					<br />
					Bundle a &lsquo;playbook&rsquo; once, reference it from many agents.
				</div>
				<div
					style={{
						marginTop: 22,
						display: "flex",
						justifyContent: "center",
						gap: 8,
					}}
				>
					<Link
						href="/skills/new"
						style={{
							background: ag.ink,
							color: ag.surface,
							border: `1px solid ${ag.ink}`,
							borderRadius: 4,
							padding: "6px 11px",
							fontSize: 12.5,
							fontWeight: 500,
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							textDecoration: "none",
						}}
					>
						<I.Plus size={11} />
						New skill
					</Link>
				</div>

				<div
					style={{
						marginTop: 28,
						paddingTop: 18,
						borderTop: `1px solid ${ag.line2}`,
						textAlign: "left",
					}}
				>
					<div
						style={{
							fontSize: 10.5,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: ag.muted,
							fontWeight: 500,
							marginBottom: 10,
						}}
					>
						Or start from a template
					</div>
					<div
						style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}
					>
						{TEMPLATES.map(([n, d]) => (
							<Link
								key={n}
								href={`/skills/new?template=${encodeURIComponent(n)}`}
								style={{
									padding: "8px 10px",
									border: `1px solid ${ag.line}`,
									borderRadius: 4,
									background: ag.bg,
									cursor: "pointer",
									textDecoration: "none",
									display: "block",
								}}
							>
								<Mono size={12} color={ag.ink} style={{ fontWeight: 500 }}>
									{n}
								</Mono>
								<div style={{ fontSize: 11.5, color: ag.muted, marginTop: 1 }}>
									{d}
								</div>
							</Link>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
