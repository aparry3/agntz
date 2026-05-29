// Editable inspector primitives. Mirrors the read-only SubBlock / Field
// helpers in inspector-bits.tsx but commits edits through a value/onChange
// prop. Each one renders the V3-style label + bordered input.

"use client";

import { I } from "@/components/v3/icons";
import { Mono, ag } from "@/components/v3/primitives";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

const labelStyle: CSSProperties = {
	fontSize: 10,
	letterSpacing: "0.08em",
	textTransform: "uppercase",
	color: ag.muted,
	fontWeight: 500,
	fontFamily: "var(--font-mono)",
};

const baseInput: CSSProperties = {
	display: "block",
	width: "100%",
	marginTop: 5,
	border: `1px solid ${ag.line}`,
	borderRadius: 4,
	padding: "6px 10px",
	background: ag.surface2,
	fontFamily: "inherit",
	fontSize: 12.5,
	lineHeight: 1.5,
	color: ag.ink,
	outline: "none",
};

/* ── EditableText — single-line or multi-line text input ───────────────── */
export function EditableText({
	label,
	value,
	onChange,
	placeholder,
	multiline,
	rows = 3,
	mono,
}: {
	label?: string;
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	multiline?: boolean;
	rows?: number;
	mono?: boolean;
}) {
	const sharedStyle: CSSProperties = {
		...baseInput,
		fontFamily: mono ? "var(--font-mono)" : "inherit",
		fontSize: mono ? 11.5 : 12.5,
	};
	return (
		<div>
			{label && <div style={labelStyle}>{label}</div>}
			{multiline ? (
				<textarea
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					rows={rows}
					spellCheck={false}
					style={{ ...sharedStyle, resize: "vertical", minHeight: rows * 18 }}
				/>
			) : (
				<input
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					spellCheck={false}
					style={sharedStyle}
				/>
			)}
		</div>
	);
}

/* ── EditableNumber — numeric input with optional bounds + step ────────── */
export function EditableNumber({
	label,
	value,
	onChange,
	min,
	max,
	step,
	placeholder,
	hint,
}: {
	label?: string;
	value: number | undefined;
	onChange: (next: number | undefined) => void;
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
	hint?: string;
}) {
	return (
		<div>
			{label && <div style={labelStyle}>{label}</div>}
			<input
				type="number"
				value={value ?? ""}
				onChange={(e) => {
					const raw = e.target.value;
					if (raw === "") {
						onChange(undefined);
						return;
					}
					const n = Number(raw);
					if (!Number.isNaN(n)) onChange(n);
				}}
				min={min}
				max={max}
				step={step}
				placeholder={placeholder}
				spellCheck={false}
				style={{ ...baseInput, fontFamily: "var(--font-mono)", fontSize: 11.5 }}
			/>
			{hint && (
				<Mono
					size={10.5}
					color={ag.muted}
					style={{ marginTop: 4, display: "inline-block" }}
				>
					{hint}
				</Mono>
			)}
		</div>
	);
}

/* ── EditableToggle — labelled boolean switch ──────────────────────────── */
export function EditableToggle({
	label,
	value,
	onChange,
	hint,
}: {
	label: string;
	value: boolean;
	onChange: (next: boolean) => void;
	hint?: string;
}) {
	return (
		<div>
			<label
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "8px 10px",
					border: `1px solid ${ag.line}`,
					borderRadius: 4,
					background: ag.surface2,
					fontSize: 12.5,
					cursor: "pointer",
				}}
			>
				<Switch checked={value} onChange={onChange} />
				<span style={{ flex: 1, color: ag.ink }}>{label}</span>
			</label>
			{hint && (
				<Mono
					size={10.5}
					color={ag.muted}
					style={{ marginTop: 4, display: "inline-block" }}
				>
					{hint}
				</Mono>
			)}
		</div>
	);
}

function Switch({
	checked,
	onChange,
}: { checked: boolean; onChange: (next: boolean) => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={(e) => {
				e.preventDefault();
				onChange(!checked);
			}}
			style={{
				width: 28,
				height: 16,
				borderRadius: 8,
				border: `1px solid ${checked ? ag.ink : ag.line}`,
				background: checked ? ag.ink : ag.surface,
				position: "relative",
				cursor: "pointer",
				padding: 0,
				flex: "0 0 auto",
				transition: "background 120ms",
			}}
		>
			<span
				style={{
					position: "absolute",
					top: 1,
					left: checked ? 13 : 1,
					width: 12,
					height: 12,
					borderRadius: 6,
					background: checked ? ag.surface : ag.ink,
					transition: "left 120ms",
				}}
			/>
		</button>
	);
}

/* ── EditableSelect — labelled native <select> ─────────────────────────── */
export function EditableSelect<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label?: string;
	value: T;
	options: ReadonlyArray<readonly [T, string]>;
	onChange: (next: T) => void;
}) {
	return (
		<div>
			{label && <div style={labelStyle}>{label}</div>}
			<div
				style={{
					position: "relative",
					marginTop: 5,
					border: `1px solid ${ag.line}`,
					borderRadius: 4,
					background: ag.surface2,
				}}
			>
				<select
					value={value}
					onChange={(e) => onChange(e.target.value as T)}
					style={{
						width: "100%",
						border: 0,
						background: "transparent",
						padding: "6px 28px 6px 10px",
						fontFamily: "inherit",
						fontSize: 12.5,
						color: ag.ink,
						outline: "none",
						appearance: "none",
						cursor: "pointer",
					}}
				>
					{options.map(([v, l]) => (
						<option key={v} value={v}>
							{l}
						</option>
					))}
				</select>
				<I.Chev
					size={10}
					style={{
						color: ag.muted,
						position: "absolute",
						right: 10,
						top: 9,
						pointerEvents: "none",
					}}
				/>
			</div>
		</div>
	);
}

/* ── Popover — generic anchored panel that closes on outside-click ─────── */
export function Popover({
	open,
	onClose,
	anchorRef,
	width = 280,
	children,
}: {
	open: boolean;
	onClose: () => void;
	anchorRef: React.RefObject<HTMLElement | null>;
	width?: number;
	children: ReactNode;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{
		top?: number;
		bottom?: number;
		left: number;
		maxHeight: number;
	} | null>(null);

	useEffect(() => {
		if (!open) {
			setPosition(null);
			return;
		}
		const anchor = anchorRef.current;
		if (!anchor) return;

		const margin = 8;
		const gap = 4;
		const minBelow = 140;
		const cap = Math.min(Math.floor(window.innerHeight * 0.6), 520);

		const place = () => {
			const rect = anchor.getBoundingClientRect();
			const left = Math.max(
				margin,
				Math.min(rect.left, window.innerWidth - width - margin),
			);
			const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
			const spaceAbove = rect.top - gap - margin;

			if (spaceBelow >= minBelow || spaceBelow >= spaceAbove) {
				setPosition({
					top: rect.bottom + gap,
					left,
					maxHeight: Math.min(cap, Math.max(spaceBelow, minBelow)),
				});
			} else {
				// Flip above — anchor to bottom so the panel hugs the trigger even when
				// content is shorter than maxHeight.
				setPosition({
					bottom: window.innerHeight - rect.top + gap,
					left,
					maxHeight: Math.min(cap, Math.max(spaceAbove, minBelow)),
				});
			}
		};

		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [open, anchorRef, width]);

	useEffect(() => {
		if (!open) return;
		const handleClick = (e: MouseEvent) => {
			if (!panelRef.current || !anchorRef.current) return;
			const target = e.target as Node;
			if (
				panelRef.current.contains(target) ||
				anchorRef.current.contains(target)
			)
				return;
			onClose();
		};
		const handleEsc = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleEsc);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleEsc);
		};
	}, [open, onClose, anchorRef]);

	if (!open || !position) return null;

	return (
		<div
			ref={panelRef}
			role="dialog"
			style={{
				position: "fixed",
				top: position.top,
				bottom: position.bottom,
				left: position.left,
				width,
				maxHeight: position.maxHeight,
				overflow: "auto",
				background: ag.surface2,
				border: `1px solid ${ag.line}`,
				borderRadius: 6,
				boxShadow: "0 6px 24px rgba(26, 25, 22, 0.12)",
				zIndex: 50,
			}}
		>
			{children}
		</div>
	);
}
