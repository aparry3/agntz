"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import {
	type SkillDraft,
	SkillEditor,
	type ToolRef,
} from "@/components/skill-editor";
import { ag } from "@/components/v3/primitives";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

interface SkillResponse {
	name: string;
	description: string;
	instructions: string;
	tools?: ToolRef[];
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export default function SkillDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name: routeName } = use(params);
	const skillName = decodeURIComponent(routeName);
	const router = useRouter();

	const [skill, setSkill] = useState<SkillResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	useEffect(() => {
		fetch(`/api/skills/${encodeURIComponent(skillName)}`)
			.then(async (r) => {
				if (!r.ok) {
					const data = await r.json().catch(() => ({}));
					setError(data?.error ?? `Failed to load skill (${r.status})`);
					return;
				}
				setSkill(await r.json());
			})
			.finally(() => setLoading(false));
	}, [skillName]);

	const handleSubmit = async (draft: SkillDraft) => {
		const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				description: draft.description,
				instructions: draft.instructions,
				tools: draft.tools,
				metadata: skill?.metadata,
			}),
		});
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			return { error: data?.error ?? `Failed to save skill (${res.status})` };
		}
		const updated = await fetch(
			`/api/skills/${encodeURIComponent(skillName)}`,
		).then((r) => r.json());
		setSkill(updated);
	};

	const handleDelete = async () => {
		await fetch(`/api/skills/${encodeURIComponent(skillName)}`, {
			method: "DELETE",
		});
		setConfirmDelete(false);
		router.push("/skills");
	};

	if (loading) {
		return (
			<div style={{ padding: 32, color: ag.muted, fontSize: 13 }}>
				Loading skill…
			</div>
		);
	}
	if (error) {
		return (
			<div
				style={{
					margin: 32,
					padding: "12px 14px",
					border: `1px solid ${ag.danger}`,
					background: ag.warnBg,
					color: ag.danger,
					borderRadius: 4,
					fontSize: 13,
				}}
			>
				{error}
			</div>
		);
	}
	if (!skill) return null;

	return (
		<>
			<SkillEditor
				breadcrumb={[
					"agntz",
					<Link
						key="skills"
						href="/skills"
						style={{ color: "inherit", textDecoration: "none" }}
					>
						Skills
					</Link>,
					skill.name,
				]}
				initial={{
					name: skill.name,
					description: skill.description,
					instructions: skill.instructions,
					tools: skill.tools ?? [],
				}}
				lockName
				submitLabel="Save"
				submittingLabel="Saving…"
				onSubmit={handleSubmit}
				onDelete={() => setConfirmDelete(true)}
				metaInfo={{
					updatedAt: skill.updatedAt
						? formatRelative(skill.updatedAt)
						: undefined,
				}}
			/>

			<ConfirmDialog
				open={confirmDelete}
				title="Delete Skill"
				message={`Are you sure you want to delete "${skillName}"? This cannot be undone.`}
				onConfirm={handleDelete}
				onCancel={() => setConfirmDelete(false)}
			/>
		</>
	);
}

function formatRelative(timestamp: string): string {
	const date = new Date(timestamp);
	const now = Date.now();
	const diff = Math.max(0, now - date.getTime());
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (diff < minute) return "just now";
	if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
	if (diff < day) return `${Math.floor(diff / hour)}h ago`;
	if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
