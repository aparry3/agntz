// Time-formatting helpers shared by the versions rail (compact "when" labels
// and day-grouping headers). Kept tiny — no i18n, no Intl.RelativeTime.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeWhen(iso: string, now = Date.now()): string {
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return iso;
	const diff = now - t;
	if (diff < MIN) return "just now";
	if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
	if (sameDay(t, now)) {
		return `today · ${formatHM(t)}`;
	}
	if (isYesterday(t, now)) return "yesterday";
	return formatMonthDay(t);
}

export function dayBucket(
	iso: string,
	now = Date.now(),
): "today" | "yesterday" | "earlier" {
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return "earlier";
	if (sameDay(t, now)) return "today";
	if (isYesterday(t, now)) return "yesterday";
	return "earlier";
}

export function formatAbsolute(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${formatHM(d.getTime())} UTC`;
}

export function formatMonthDay(t: number): string {
	return new Date(t).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

function sameDay(a: number, b: number): boolean {
	const da = new Date(a);
	const db = new Date(b);
	return (
		da.getFullYear() === db.getFullYear() &&
		da.getMonth() === db.getMonth() &&
		da.getDate() === db.getDate()
	);
}

function isYesterday(t: number, now: number): boolean {
	return sameDay(t, now - DAY);
}

function formatHM(t: number): string {
	const d = new Date(t);
	const h = String(d.getUTCHours()).padStart(2, "0");
	const m = String(d.getUTCMinutes()).padStart(2, "0");
	return `${h}:${m}`;
}
