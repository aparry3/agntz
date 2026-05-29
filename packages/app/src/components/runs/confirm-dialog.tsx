"use client";

import { useEffect } from "react";

export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel = "Confirm",
	onConfirm,
	onCancel,
	busy = false,
}: {
	open: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
	busy?: boolean;
}) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !busy) onCancel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, busy, onCancel]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40">
			<div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
				<h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
				<p className="mt-2 text-sm text-zinc-600">{message}</p>
				<div className="mt-6 flex justify-end gap-3">
					<button
						type="button"
						onClick={onCancel}
						disabled={busy}
						className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:border-stone-300 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={busy}
						className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
					>
						{busy ? "Working..." : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
