"use client";

import { Breadcrumb } from "@/components/breadcrumb";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
	SecretEditor,
	type SecretEditorSubmit,
} from "@/components/secret-editor";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

interface SecretResponse {
	name: string;
	description?: string;
	lastFour: string;
	createdAt?: string;
	updatedAt?: string;
}

export default function SecretDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name: routeName } = use(params);
	const secretName = decodeURIComponent(routeName);
	const router = useRouter();

	const [secret, setSecret] = useState<SecretResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const fetchSecret = async () => {
		const r = await fetch(`/api/secrets/${encodeURIComponent(secretName)}`);
		if (!r.ok) {
			const data = await r.json().catch(() => ({}));
			setError(data?.error ?? `Failed to load secret (${r.status})`);
			return;
		}
		setSecret(await r.json());
	};

	useEffect(() => {
		fetchSecret().finally(() => setLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [secretName]);

	const handleSubmit = async (draft: SecretEditorSubmit) => {
		// Only include `value` in the body when the user typed one.
		// Empty string = "leave value unchanged".
		const body: { value?: string; description?: string } = {
			description: draft.description,
		};
		if (draft.value !== "") {
			body.value = draft.value;
		}
		const res = await fetch(`/api/secrets/${encodeURIComponent(secretName)}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			return { error: data?.error ?? `Failed to save secret (${res.status})` };
		}
		// Refresh metadata so the masked indicator reflects any new lastFour.
		await fetchSecret();
	};

	const handleDelete = async () => {
		await fetch(`/api/secrets/${encodeURIComponent(secretName)}`, {
			method: "DELETE",
		});
		setConfirmDelete(false);
		router.push("/settings/secrets");
	};

	return (
		<div className="mx-auto max-w-4xl">
			<Breadcrumb
				items={[
					{ label: "Secrets", href: "/settings/secrets" },
					{ label: secretName },
				]}
			/>

			{loading ? (
				<div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">
					Loading secret...
				</div>
			) : error ? (
				<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{error}
				</div>
			) : secret ? (
				<>
					<div className="mb-6 flex items-start justify-between gap-4">
						<div>
							<h1 className="font-mono text-3xl font-semibold tracking-tight text-zinc-950">
								{secret.name}
							</h1>
							<div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
								<span className="font-mono">••••{secret.lastFour}</span>
								{secret.updatedAt && (
									<span>
										Updated {new Date(secret.updatedAt).toLocaleString()}
									</span>
								)}
							</div>
						</div>
						<button
							onClick={() => setConfirmDelete(true)}
							className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
						>
							Delete
						</button>
					</div>

					<SecretEditor
						initial={{
							name: secret.name,
							value: "",
							description: secret.description ?? "",
						}}
						lockName
						lastFour={secret.lastFour}
						submitLabel="Save changes"
						submittingLabel="Saving..."
						onSubmit={handleSubmit}
					/>
				</>
			) : null}

			<ConfirmDialog
				open={confirmDelete}
				title="Delete Secret"
				message={`Are you sure you want to delete "${secretName}"? Agents that reference {{secrets.${secretName}}} will fail until you re-create it.`}
				onConfirm={handleDelete}
				onCancel={() => setConfirmDelete(false)}
			/>
		</div>
	);
}
