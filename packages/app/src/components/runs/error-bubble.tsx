export function ErrorBubble({ message }: { message: string }) {
	return (
		<div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
			<div className="mb-1 text-xs uppercase tracking-wider text-rose-700">
				Error
			</div>
			<div className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm text-rose-900 font-mono">
				{message}
			</div>
		</div>
	);
}
