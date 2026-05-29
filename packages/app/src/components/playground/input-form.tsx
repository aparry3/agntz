"use client";

import {
	EditableNumber,
	EditableSelect,
	EditableText,
	EditableToggle,
} from "@/components/v3/editor/editable-fields";
import { Mono, ag } from "@/components/v3/primitives";
import type { CSSProperties } from "react";

type PropertyDef =
	| string
	| {
			type: string;
			default?: unknown;
			enum?: unknown[];
			min?: number;
			max?: number;
	  };

type InputSchema = Record<string, PropertyDef>;

interface Example {
	input: string;
	output: string;
}

function getInputSchema(
	manifest: Record<string, unknown>,
): InputSchema | undefined {
	const raw = manifest.inputSchema;
	return raw && typeof raw === "object" ? (raw as InputSchema) : undefined;
}

function getExamples(manifest: Record<string, unknown>): Example[] {
	const raw = manifest.examples;
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(e): e is Example =>
			e !== null &&
			typeof e === "object" &&
			typeof (e as Example).input === "string",
	);
}

function expand(def: PropertyDef): {
	type: string;
	default?: unknown;
	enum?: unknown[];
	min?: number;
	max?: number;
} {
	return typeof def === "string" ? { type: def } : def;
}

const labelStyle: CSSProperties = {
	fontSize: 10,
	letterSpacing: "0.08em",
	textTransform: "uppercase",
	color: ag.muted,
	fontWeight: 500,
	fontFamily: "var(--font-mono)",
};

/**
 * Renders the input form for the playground:
 *  - If the manifest declares an `inputSchema`, one labeled field per property.
 *  - Otherwise, a single mono textarea (string or JSON).
 *  - If the manifest has `examples`, click-to-fill chips above the form
 *    (string mode only — structured examples are out of scope for v1).
 */
export function InputForm({
	manifest,
	value,
	onChange,
}: {
	manifest: Record<string, unknown>;
	value: unknown;
	onChange: (next: unknown) => void;
}) {
	const schema = getInputSchema(manifest);
	const examples = getExamples(manifest);

	if (schema && Object.keys(schema).length > 0) {
		const record: Record<string, unknown> =
			value && typeof value === "object" && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: {};

		return (
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				{Object.entries(schema).map(([key, rawDef]) => (
					<SchemaField
						key={key}
						name={key}
						def={expand(rawDef)}
						value={record[key]}
						onChange={(next) => onChange({ ...record, [key]: next })}
					/>
				))}
			</div>
		);
	}

	// Textarea fallback — string or JSON.
	const stringValue = typeof value === "string" ? value : "";
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			{examples.length > 0 && (
				<ExampleChips examples={examples} onPick={(s) => onChange(s)} />
			)}
			<EditableText
				label="Input"
				value={stringValue}
				onChange={(next) => onChange(next)}
				placeholder="Enter input (string or JSON)..."
				multiline
				rows={6}
				mono
			/>
		</div>
	);
}

function SchemaField({
	name,
	def,
	value,
	onChange,
}: {
	name: string;
	def: {
		type: string;
		default?: unknown;
		enum?: unknown[];
		min?: number;
		max?: number;
	};
	value: unknown;
	onChange: (next: unknown) => void;
}) {
	const t = def.type.toLowerCase();

	if (def.enum && def.enum.length > 0) {
		const current =
			value !== undefined && value !== null
				? String(value)
				: String(def.enum[0]);
		const options = def.enum.map((v) => [String(v), String(v)] as const);
		return (
			<EditableSelect
				label={name}
				value={current}
				options={options as ReadonlyArray<readonly [string, string]>}
				onChange={(next) => onChange(coerceTo(t, next))}
			/>
		);
	}

	if (t === "boolean" || t === "bool") {
		return (
			<EditableToggle
				label={name}
				value={value === true}
				onChange={(next) => onChange(next)}
			/>
		);
	}

	if (t === "number" || t === "integer" || t === "int") {
		return (
			<EditableNumber
				label={name}
				value={typeof value === "number" ? value : undefined}
				onChange={(next) => onChange(next)}
				min={def.min}
				max={def.max}
			/>
		);
	}

	return (
		<EditableText
			label={name}
			value={typeof value === "string" ? value : ""}
			onChange={(next) => onChange(next)}
			placeholder={typeof def.default === "string" ? def.default : undefined}
		/>
	);
}

function coerceTo(type: string, raw: string): unknown {
	const t = type.toLowerCase();
	if (t === "number" || t === "integer" || t === "int") {
		const n = Number(raw);
		return Number.isNaN(n) ? raw : n;
	}
	if (t === "boolean" || t === "bool") {
		return raw === "true";
	}
	return raw;
}

function ExampleChips({
	examples,
	onPick,
}: {
	examples: Example[];
	onPick: (input: string) => void;
}) {
	return (
		<div>
			<div style={labelStyle}>Examples</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
				{examples.map((ex, i) => (
					<button
						key={i}
						type="button"
						onClick={() => onPick(ex.input)}
						style={{
							padding: "4px 10px",
							border: `1px solid ${ag.line}`,
							background: ag.surface2,
							borderRadius: 999,
							fontSize: 11.5,
							color: ag.ink,
							cursor: "pointer",
							maxWidth: 240,
							textOverflow: "ellipsis",
							overflow: "hidden",
							whiteSpace: "nowrap",
						}}
						title={ex.input}
					>
						<Mono size={11} color={ag.muted}>
							{truncate(ex.input, 36)}
						</Mono>
					</button>
				))}
			</div>
		</div>
	);
}

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
