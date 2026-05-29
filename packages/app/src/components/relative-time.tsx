"use client";

import { useEffect, useState } from "react";

/**
 * Render a relative timestamp ("2m ago"). Re-renders every 30s while mounted
 * so visible times stay fresh. Static rendering would also be acceptable for
 * lists that rarely stay open long, but live tail pages can be open for
 * minutes.
 */
export function RelativeTime({ iso }: { iso: string }) {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 30_000);
		return () => clearInterval(id);
	}, []);

	// Reference `tick` so the linter doesn't warn about unused state; the
	// re-render is the effect we want.
	void tick;

	return <span title={iso}>{formatRelative(iso)}</span>;
}

function formatRelative(iso: string): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return iso;
	const diff = Date.now() - t;
	const seconds = Math.round(diff / 1000);
	if (seconds < 5) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(t).toLocaleDateString();
}
