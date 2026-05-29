"use client";

import { useEffect, useState } from "react";

interface Provider {
	id: string;
	name: string;
	models: string[];
	configured: boolean;
}

interface Me {
	userId: string;
	isSuperAdmin: boolean;
}

export default function SettingsPage() {
	const [providers, setProviders] = useState<Provider[]>([]);
	const [loading, setLoading] = useState(true);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [saving, setSaving] = useState(false);
	const [me, setMe] = useState<Me | null>(null);
	const [copied, setCopied] = useState(false);

	const loadProviders = async () => {
		const res = await fetch("/api/providers");
		const data = await res.json();
		setProviders(data);
		setLoading(false);
	};

	useEffect(() => {
		loadProviders();
		fetch("/api/me")
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (data) setMe(data);
			});
	}, []);

	const copyUserId = async () => {
		if (!me) return;
		await navigator.clipboard.writeText(me.userId);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleEdit = (provider: Provider) => {
		setEditingId(provider.id);
		setApiKey("");
		setBaseUrl("");
	};

	const handleSave = async () => {
		if (!editingId || !apiKey.trim()) return;
		setSaving(true);
		await fetch(`/api/providers/${editingId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				apiKey: apiKey.trim(),
				baseUrl: baseUrl.trim() || undefined,
			}),
		});
		setSaving(false);
		setEditingId(null);
		setApiKey("");
		setBaseUrl("");
		await loadProviders();
	};

	const handleDelete = async (id: string) => {
		if (!confirm(`Remove API key for ${id}?`)) return;
		await fetch(`/api/providers/${id}`, { method: "DELETE" });
		await loadProviders();
	};

	if (loading) {
		return (
			<div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">
				Loading...
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-4xl">
			<h1 className="text-4xl font-semibold tracking-tight text-zinc-950">
				Settings
			</h1>
			<p className="mt-2 mb-6 text-sm leading-6 text-zinc-600">
				Configure API keys for LLM providers. Keys are stored in the database
				and used at runtime. Environment variables are used as fallback.
			</p>

			{me && (
				<div className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
					<div className="mb-1 text-sm font-medium text-zinc-950">
						Your Clerk user ID
						{me.isSuperAdmin && (
							<span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
								Super admin
							</span>
						)}
					</div>
					<p className="mb-3 text-xs text-zinc-500">
						Paste this into{" "}
						<code className="font-mono">SUPER_ADMIN_USER_IDS</code>{" "}
						(comma-separated) in <code className="font-mono">.env.local</code>{" "}
						to unlock the System Agents admin view.
					</p>
					<div className="flex items-center gap-2">
						<code className="flex-1 select-all rounded bg-stone-100 px-3 py-2 font-mono text-xs text-zinc-900">
							{me.userId}
						</code>
						<button
							onClick={copyUserId}
							className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-stone-100"
						>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
				</div>
			)}

			<h2 className="mb-3 text-lg font-semibold text-zinc-900">Providers</h2>

			<div className="flex flex-col gap-3">
				{providers.map((provider) => (
					<div
						key={provider.id}
						className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
					>
						<div className="flex items-center justify-between">
							<div>
								<div className="font-medium text-zinc-950">{provider.name}</div>
								<div className="text-sm text-zinc-500">
									{provider.models.length > 0
										? provider.models.join(", ")
										: "Custom models"}
								</div>
							</div>
							<div className="flex items-center gap-2">
								<span
									className={`text-xs px-2 py-1 rounded ${
										provider.configured
											? "bg-emerald-50 text-emerald-700"
											: "bg-stone-100 text-zinc-500"
									}`}
								>
									{provider.configured ? "Configured" : "Not configured"}
								</span>
								{provider.configured && (
									<button
										onClick={() => handleDelete(provider.id)}
										className="text-xs text-red-600 hover:text-red-500"
									>
										Remove
									</button>
								)}
								<button
									onClick={() => handleEdit(provider)}
									className="text-xs text-zinc-800 hover:text-zinc-950"
								>
									{provider.configured ? "Update" : "Configure"}
								</button>
							</div>
						</div>

						{editingId === provider.id && (
							<div className="mt-3 flex flex-col gap-2">
								<input
									type="password"
									placeholder="API Key"
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
								/>
								<input
									type="text"
									placeholder="Base URL (optional, for custom endpoints)"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
								/>
								<div className="flex gap-2">
									<button
										onClick={handleSave}
										disabled={saving || !apiKey.trim()}
										className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
									>
										{saving ? "Saving..." : "Save"}
									</button>
									<button
										onClick={() => setEditingId(null)}
										className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800"
									>
										Cancel
									</button>
								</div>
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
