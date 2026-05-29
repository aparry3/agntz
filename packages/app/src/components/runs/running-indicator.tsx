export function RunningIndicator() {
	return (
		<div className="flex items-center gap-2 px-1 py-3 text-sm text-zinc-500">
			<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
			Agent is working…
		</div>
	);
}
