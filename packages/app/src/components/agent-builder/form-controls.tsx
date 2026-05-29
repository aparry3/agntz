"use client";

// Small UI primitives used by the legacy HTTP-tool sub-editors
// (HeadersEditor, ParamsEditor) that still ship as standalone components
// embedded inside the pipeline inspector. The pipeline inspector itself
// uses its own inline-styled controls; this file is intentionally narrow.

import type { ReactNode } from "react";

export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<label className="block">
			<span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
				{label}
			</span>
			{children}
			{hint && (
				<span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>
			)}
		</label>
	);
}

const inputClass =
	"w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm outline-none transition focus:border-zinc-400 focus:bg-white";

export function TextInput({
	value,
	onChange,
	placeholder,
	readOnly,
	mono,
}: {
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	readOnly?: boolean;
	mono?: boolean;
}) {
	return (
		<input
			value={value}
			onChange={(event) => onChange(event.target.value)}
			placeholder={placeholder}
			readOnly={readOnly}
			className={`${inputClass} ${mono ? "font-mono" : ""} ${readOnly ? "cursor-not-allowed bg-stone-100 text-zinc-500" : ""}`}
		/>
	);
}

export function TextArea({
	value,
	onChange,
	placeholder,
	rows = 4,
	mono,
}: {
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	rows?: number;
	mono?: boolean;
}) {
	return (
		<textarea
			value={value}
			onChange={(event) => onChange(event.target.value)}
			placeholder={placeholder}
			rows={rows}
			className={`${inputClass} ${mono ? "font-mono" : ""}`}
		/>
	);
}

export function Select<T extends string>({
	value,
	onChange,
	options,
	allowEmpty,
	emptyLabel,
}: {
	value: T | "";
	onChange: (next: T | "") => void;
	options: Array<{ value: T; label: string; hint?: string }>;
	allowEmpty?: boolean;
	emptyLabel?: string;
}) {
	return (
		<select
			value={value}
			onChange={(event) => onChange(event.target.value as T | "")}
			className={inputClass}
		>
			{allowEmpty && <option value="">{emptyLabel ?? "—"}</option>}
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
					{option.hint ? ` · ${option.hint}` : ""}
				</option>
			))}
		</select>
	);
}

export function SmallButton({
	label,
	onClick,
	tone = "neutral",
	disabled,
}: {
	label: string;
	onClick: () => void;
	tone?: "neutral" | "danger" | "primary";
	disabled?: boolean;
}) {
	const cls =
		tone === "danger"
			? "border-red-200 text-red-600 hover:bg-red-50"
			: tone === "primary"
				? "border-zinc-900 bg-zinc-950 text-white hover:bg-zinc-800"
				: "border-stone-200 bg-white text-zinc-700 hover:bg-stone-50";
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
		>
			{label}
		</button>
	);
}
