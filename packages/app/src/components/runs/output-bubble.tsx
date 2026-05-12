function looksCodey(s: string): boolean {
  return s.startsWith("{") || s.includes("```");
}

export function OutputBubble({ text }: { text: string }) {
  const code = looksCodey(text);
  return (
    <div className="rounded-2xl bg-blue-50 p-4">
      <div className="mb-1 text-xs uppercase tracking-wider text-blue-700">Output</div>
      <div className={`max-h-96 overflow-y-auto whitespace-pre-wrap text-sm text-zinc-800 ${code ? "font-mono" : ""}`}>
        {text}
      </div>
    </div>
  );
}
