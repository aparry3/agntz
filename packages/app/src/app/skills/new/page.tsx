"use client";

import { type SkillDraft, SkillEditor } from "@/components/skill-editor";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

const TEMPLATES: Record<string, Omit<SkillDraft, "name">> = {
	"refund-policy": {
		description:
			"Handles refund eligibility and processing per Acme's 30-day policy.",
		instructions: `When the user asks about a refund:
1. Look up the order with lookup_order.
2. If the order is < 30 days old AND not a final-sale item, eligible.
   Issue refund via issue_refund, then confirm to the user.
3. Otherwise, escalate to a human agent and apologize for the inconvenience.

Tone: empathetic, never argumentative. Lead with what you can do.`,
		tools: [
			{ type: "inline", name: "lookup_order" },
			{ type: "inline", name: "issue_refund" },
		],
	},
	researcher: {
		description: "Multi-source research playbook with web + academic search.",
		instructions: `When asked to research a topic:
1. Break the question into sub-queries.
2. Run web + academic search for each.
3. Cross-reference top sources and note disagreements.
4. Return a structured report: findings · sources · confidence.`,
		tools: [],
	},
	summarizer: {
		description:
			"Condenses long content into bulleted summaries with citations.",
		instructions: `Given long-form content:
1. Identify the 3–5 most important claims.
2. Bullet them, each with a citation back to the source.
3. End with a one-sentence "if you only read one thing".`,
		tools: [],
	},
	"code-review": {
		description:
			"Runs a structured PR review with checklist + tone guardrails.",
		instructions: `When reviewing a PR:
1. Scan the diff for correctness, security, and style issues.
2. Group comments by severity (blocker · suggestion · nit).
3. Lead with what's working before what isn't.`,
		tools: [],
	},
};

function NewSkillContent() {
	const router = useRouter();
	const params = useSearchParams();
	const templateKey = params.get("template");

	const initial = useMemo<SkillDraft>(() => {
		const tpl = templateKey ? TEMPLATES[templateKey] : null;
		if (tpl) {
			return { name: templateKey ?? "", ...tpl };
		}
		return { name: "", description: "", instructions: "", tools: [] };
	}, [templateKey]);

	const handleSubmit = async (draft: SkillDraft) => {
		const res = await fetch("/api/skills", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(draft),
		});
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			return { error: data?.error ?? `Failed to create skill (${res.status})` };
		}
		router.push(`/skills/${encodeURIComponent(draft.name)}`);
	};

	return (
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
				"New skill",
			]}
			initial={initial}
			submitLabel="Create skill"
			submittingLabel="Creating…"
			onSubmit={handleSubmit}
		/>
	);
}

export default function NewSkillPage() {
	return (
		<Suspense fallback={null}>
			<NewSkillContent />
		</Suspense>
	);
}
