"use client";

import { useEffect, useMemo, useState } from "react";

interface McpConnection {
	id: string;
	kind: "mcp";
	displayName: string;
	description?: string;
	config: {
		url: string;
		headers?: Record<string, string>;
	};
	createdAt: string;
	updatedAt: string;
}

interface FormState {
	id: string;
	displayName: string;
	description: string;
	url: string;
	headers: Array<{ key: string; value: string }>;
}

const EMPTY_FORM: FormState = {
	id: "",
	displayName: "",
	description: "",
	url: "",
	headers: [],
};

export function McpServersSection() {
	const [connections, setConnections] = useState<McpConnection[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [warning, setWarning] = useState<string | null>(null);
	const [form, setForm] = useState<FormState>(EMPTY_FORM);
	const [showForm, setShowForm] = useState(false);
	const [saving, setSaving] = useState(false);

	async function load() {
		const res = await fetch("/api/connections?kind=mcp");
		if (!res.ok) {
			setError((await res.json().catch(() => ({})))?.error ?? "failed to load");
			return;
		}
		setConnections((await res.json()) as McpConnection[]);
	}

	useEffect(() => {
		load();
	}, []);

	const idPreview = useMemo(() => form.id || "my-server", [form.id]);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		setWarning(null);
		try {
			const headers: Record<string, string> = {};
			for (const h of form.headers) {
				if (h.key.trim()) headers[h.key.trim()] = h.value;
			}
			const body = {
				kind: "mcp",
				id: form.id.trim(),
				displayName: form.displayName.trim() || form.id.trim(),
				description: form.description.trim() || undefined,
				config: {
					url: form.url.trim(),
					...(Object.keys(headers).length > 0 ? { headers } : {}),
				},
			};

			const res = await fetch("/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const result = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(result.error ?? `HTTP ${res.status}`);
			}
			if (result.warning) setWarning(result.warning);
			setForm(EMPTY_FORM);
			setShowForm(false);
			await load();
		} catch (err) {
			setError(String(err));
		} finally {
			setSaving(false);
		}
	}

	async function remove(id: string) {
		if (
			!confirm(
				`Delete connection '${id}'? Agents that reference it by name will fail to resolve.`,
			)
		) {
			return;
		}
		const res = await fetch(`/api/connections/mcp/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
		if (!res.ok) {
			setError(
				(await res.json().catch(() => ({})))?.error ?? "failed to delete",
			);
			return;
		}
		await load();
	}

	return (
		<section className="space-y-4">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h2 className="text-lg font-semibold text-zinc-900">MCP servers</h2>
					<p className="mt-1 text-sm text-zinc-600">
						Register an MCP server once, then reference it in any agent by the
						short id (e.g.{" "}
						<code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
							server: {idPreview}
						</code>
						). Agents can still pass a raw URL when you don't want to register
						one.
					</p>
				</div>
				{!showForm && (
					<button
						onClick={() => {
							setShowForm(true);
							setError(null);
							setWarning(null);
						}}
						className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
					>
						Add server
					</button>
				)}
			</div>

			{warning && (
				<div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
					{warning}
				</div>
			)}
			{error && (
				<div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
					{error}
				</div>
			)}

			{showForm && (
				<form
					onSubmit={submit}
					className="space-y-3 rounded-xl border border-stone-200 bg-white p-4"
				>
					<div className="grid grid-cols-2 gap-3">
						<label className="space-y-1 text-xs font-medium text-zinc-700">
							ID
							<input
								required
								value={form.id}
								onChange={(e) => setForm({ ...form, id: e.target.value })}
								placeholder="gymtext"
								pattern="[a-z][a-z0-9_-]{0,63}"
								title="lowercase letters, digits, dash, underscore — must start with a letter"
								className="w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm focus:border-zinc-400 focus:outline-none"
							/>
						</label>
						<label className="space-y-1 text-xs font-medium text-zinc-700">
							Display name
							<input
								value={form.displayName}
								onChange={(e) =>
									setForm({ ...form, displayName: e.target.value })
								}
								placeholder="GymText"
								className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none"
							/>
						</label>
					</div>

					<label className="block space-y-1 text-xs font-medium text-zinc-700">
						URL
						<input
							required
							type="url"
							value={form.url}
							onChange={(e) => setForm({ ...form, url: e.target.value })}
							placeholder="https://gymtex.co/mcp"
							className="w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm focus:border-zinc-400 focus:outline-none"
						/>
					</label>

					<label className="block space-y-1 text-xs font-medium text-zinc-700">
						Description
						<input
							value={form.description}
							onChange={(e) =>
								setForm({ ...form, description: e.target.value })
							}
							placeholder="What this server provides"
							className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none"
						/>
					</label>

					<div className="space-y-2">
						<div className="text-xs font-medium text-zinc-700">
							Headers (optional)
						</div>
						<p className="text-xs text-zinc-500">
							Used for auth, e.g.{" "}
							<code className="font-mono">Authorization: Bearer …</code>. Values
							are stored encrypted at rest and masked in the list below.
						</p>
						{form.headers.map((h, i) => (
							<div key={i} className="flex gap-2">
								<input
									value={h.key}
									onChange={(e) => {
										const next = [...form.headers];
										next[i] = { ...next[i], key: e.target.value };
										setForm({ ...form, headers: next });
									}}
									placeholder="Header name"
									className="flex-1 rounded-lg border border-stone-200 px-3 py-2 font-mono text-xs focus:border-zinc-400 focus:outline-none"
								/>
								<input
									value={h.value}
									onChange={(e) => {
										const next = [...form.headers];
										next[i] = { ...next[i], value: e.target.value };
										setForm({ ...form, headers: next });
									}}
									placeholder="Value"
									className="flex-1 rounded-lg border border-stone-200 px-3 py-2 font-mono text-xs focus:border-zinc-400 focus:outline-none"
								/>
								<button
									type="button"
									onClick={() =>
										setForm({
											...form,
											headers: form.headers.filter((_, j) => j !== i),
										})
									}
									className="rounded-lg px-3 py-2 text-xs text-zinc-500 hover:text-rose-700"
								>
									Remove
								</button>
							</div>
						))}
						<button
							type="button"
							onClick={() =>
								setForm({
									...form,
									headers: [...form.headers, { key: "", value: "" }],
								})
							}
							className="rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-stone-50"
						>
							+ Add header
						</button>
					</div>

					<div className="flex gap-2 pt-2">
						<button
							type="submit"
							disabled={saving}
							className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
						>
							{saving ? "Saving…" : "Save"}
						</button>
						<button
							type="button"
							onClick={() => {
								setShowForm(false);
								setForm(EMPTY_FORM);
								setError(null);
							}}
							className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900"
						>
							Cancel
						</button>
					</div>
				</form>
			)}

			<div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
				<table className="w-full text-sm">
					<thead className="bg-stone-50 text-left text-xs uppercase tracking-wider text-zinc-500">
						<tr>
							<th className="px-4 py-3 font-medium">Name</th>
							<th className="px-4 py-3 font-medium">ID</th>
							<th className="px-4 py-3 font-medium">URL</th>
							<th className="px-4 py-3 font-medium">Headers</th>
							<th className="px-4 py-3" />
						</tr>
					</thead>
					<tbody className="divide-y divide-stone-200">
						{connections === null && (
							<tr>
								<td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
									Loading…
								</td>
							</tr>
						)}
						{connections && connections.length === 0 && (
							<tr>
								<td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
									No MCP servers registered yet.
								</td>
							</tr>
						)}
						{connections?.map((c) => (
							<tr key={c.id}>
								<td className="px-4 py-3 font-medium text-zinc-950">
									{c.displayName}
									{c.description && (
										<div className="mt-0.5 text-xs font-normal text-zinc-500">
											{c.description}
										</div>
									)}
								</td>
								<td className="px-4 py-3 font-mono text-xs text-zinc-700">
									{c.id}
								</td>
								<td className="px-4 py-3 font-mono text-xs text-zinc-700">
									<a
										href={c.config.url}
										target="_blank"
										rel="noreferrer"
										className="hover:underline"
									>
										{c.config.url}
									</a>
								</td>
								<td className="px-4 py-3 text-xs text-zinc-500">
									{c.config.headers
										? Object.keys(c.config.headers).join(", ")
										: "—"}
								</td>
								<td className="px-4 py-3 text-right">
									<button
										onClick={() => remove(c.id)}
										className="text-xs font-medium text-rose-700 hover:underline"
									>
										Delete
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
