"use client";

import { useId, useState } from "react";
import { Field, SmallButton, TextInput } from "./form-controls";

export interface HeadersEditorSecret {
	name: string;
	lastFour: string;
	description?: string;
}

interface HeadersEditorProps {
	headers: Record<string, string>;
	onChange: (next: Record<string, string>) => void;
	secrets: HeadersEditorSecret[];
}

interface HeaderRow {
	key: string;
	value: string;
}

/**
 * Editor for HTTP request headers. Rows hold (name, value) pairs; the value
 * input supports inserting `{{secrets.<name>}}` references via an "Insert
 * secret" menu. We NEVER autocomplete the raw secret value — only the
 * template reference. A "Bearer auth" shortcut inserts a fully-formed
 * `Authorization: Bearer {{secrets.<chosen>}}` row.
 *
 * Internal state is a list (not a Map) so users can have a blank row while
 * typing without it being yanked out from underneath them. We flush to the
 * parent's record on every change, filtering out entries with an empty key.
 */
export function HeadersEditor({
	headers,
	onChange,
	secrets,
}: HeadersEditorProps) {
	// Maintain a stable row order: hydrate from `headers` once, then own the
	// ordering locally. Re-hydrating on every parent update would lose row
	// identity when the user clears a key while typing.
	const [rows, setRows] = useState<HeaderRow[]>(() =>
		Object.entries(headers).map(([key, value]) => ({ key, value })),
	);

	const flush = (next: HeaderRow[]) => {
		setRows(next);
		const out: Record<string, string> = {};
		for (const row of next) {
			const k = row.key.trim();
			if (k.length === 0) continue;
			out[k] = row.value;
		}
		onChange(out);
	};

	const updateRow = (index: number, patch: Partial<HeaderRow>) => {
		flush(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
	};

	const removeRow = (index: number) => {
		flush(rows.filter((_, i) => i !== index));
	};

	const addRow = () => {
		flush([...rows, { key: "", value: "" }]);
	};

	const addBearer = (secretName: string) => {
		// Replace any existing Authorization row; otherwise append.
		const idx = rows.findIndex(
			(r) => r.key.trim().toLowerCase() === "authorization",
		);
		const ref = `Bearer {{secrets.${secretName}}}`;
		if (idx >= 0) {
			flush(rows.map((r, i) => (i === idx ? { ...r, value: ref } : r)));
		} else {
			flush([...rows, { key: "Authorization", value: ref }]);
		}
	};

	return (
		<Field
			label="Headers"
			hint="Header values may reference secrets via {{secrets.<name>}}. Values are templated at runtime — the frontend never sees decrypted values."
		>
			<div className="space-y-2">
				{rows.length === 0 && (
					<div className="rounded-xl border border-dashed border-stone-300 bg-white px-3 py-3 text-xs text-zinc-500">
						No headers configured.
					</div>
				)}
				{rows.map((row, index) => (
					<HeaderRowEditor
						key={index}
						row={row}
						secrets={secrets}
						onChange={(patch) => updateRow(index, patch)}
						onRemove={() => removeRow(index)}
					/>
				))}
				<div className="flex flex-wrap gap-2">
					<SmallButton label="+ Add header" onClick={addRow} />
					<BearerAuthMenu secrets={secrets} onPick={addBearer} />
				</div>
			</div>
		</Field>
	);
}

function HeaderRowEditor({
	row,
	secrets,
	onChange,
	onRemove,
}: {
	row: HeaderRow;
	secrets: HeadersEditorSecret[];
	onChange: (patch: Partial<HeaderRow>) => void;
	onRemove: () => void;
}) {
	return (
		<div className="grid gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
			<TextInput
				value={row.key}
				onChange={(v) => onChange({ key: v })}
				placeholder="Header name"
			/>
			<div className="flex flex-col gap-1">
				<TextInput
					value={row.value}
					onChange={(v) => onChange({ value: v })}
					placeholder="Header value"
					mono
				/>
				<div className="flex justify-end">
					<InsertSecretMenu
						secrets={secrets}
						onPick={(name) =>
							onChange({ value: appendSecretRef(row.value, name) })
						}
					/>
				</div>
			</div>
			<div className="flex items-start">
				<SmallButton label="Remove" onClick={onRemove} tone="danger" />
			</div>
		</div>
	);
}

/**
 * Append `{{secrets.<name>}}` to the current value. We append rather than
 * positionally insert because <input> doesn't expose a stable caret without
 * a controlled ref, and append is what users almost always want for header
 * construction (e.g. building "Bearer <token>").
 */
export function appendSecretRef(current: string, secretName: string): string {
	const ref = `{{secrets.${secretName}}}`;
	if (current.length === 0) return ref;
	// If the user already has whitespace, keep it; otherwise insert one space.
	const sep = /\s$/.test(current) ? "" : " ";
	return `${current}${sep}${ref}`;
}

function InsertSecretMenu({
	secrets,
	onPick,
}: {
	secrets: HeadersEditorSecret[];
	onPick: (name: string) => void;
}) {
	const id = useId();
	return (
		<details className="relative">
			<summary className="cursor-pointer select-none list-none rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] text-zinc-600 hover:bg-stone-50">
				Insert secret →
			</summary>
			<div className="absolute right-0 z-10 mt-1 w-60 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
				{secrets.length === 0 ? (
					<div className="px-2 py-1.5 text-[11px] text-zinc-500">
						No secrets defined.
					</div>
				) : (
					secrets.map((secret) => (
						<button
							key={`${id}-${secret.name}`}
							type="button"
							onClick={(event) => {
								onPick(secret.name);
								// Close the <details> popover by toggling open state.
								const details = event.currentTarget.closest("details");
								if (details) details.removeAttribute("open");
							}}
							className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-stone-50"
						>
							<span className="font-mono font-medium text-zinc-800">
								{secret.name}
							</span>
							{secret.lastFour && (
								<span className="ml-2 text-[11px] text-zinc-400">
									••••{secret.lastFour}
								</span>
							)}
							{secret.description && (
								<span className="ml-2 text-[11px] text-zinc-500">
									{secret.description}
								</span>
							)}
						</button>
					))
				)}
				<div className="mt-1 border-t border-stone-100 pt-1">
					<a
						href="/settings/secrets/new"
						target="_blank"
						rel="noreferrer"
						className="block rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-600 hover:bg-stone-50"
					>
						+ New secret…
					</a>
				</div>
			</div>
		</details>
	);
}

function BearerAuthMenu({
	secrets,
	onPick,
}: {
	secrets: HeadersEditorSecret[];
	onPick: (name: string) => void;
}) {
	const id = useId();
	if (secrets.length === 0) return null;
	return (
		<details className="relative">
			<summary className="cursor-pointer select-none list-none rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-stone-50">
				+ Add Bearer auth
			</summary>
			<div className="absolute left-0 z-10 mt-1 w-60 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
				{secrets.map((secret) => (
					<button
						key={`${id}-${secret.name}`}
						type="button"
						onClick={(event) => {
							onPick(secret.name);
							const details = event.currentTarget.closest("details");
							if (details) details.removeAttribute("open");
						}}
						className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-stone-50"
					>
						<span className="font-mono font-medium text-zinc-800">
							{secret.name}
						</span>
						{secret.lastFour && (
							<span className="ml-2 text-[11px] text-zinc-400">
								••••{secret.lastFour}
							</span>
						)}
					</button>
				))}
			</div>
		</details>
	);
}
