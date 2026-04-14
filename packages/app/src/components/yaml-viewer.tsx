import { highlightYaml } from "@/lib/yaml-highlight";

interface YamlViewerProps {
  value: string;
  className?: string;
  showLineNumbers?: boolean;
  /** Constrain height and scroll internally. Default: false (renders full). */
  maxHeightClassName?: string;
}

/**
 * Read-only YAML viewer with syntax highlighting. Uses the same token rules
 * as {@link YamlEditor} so edit and view modes look identical.
 */
export function YamlViewer({
  value,
  className = "",
  showLineNumbers = true,
  maxHeightClassName = "max-h-[70vh]",
}: YamlViewerProps) {
  const lines = value.split("\n");
  const html = lines.map((line) => `<div>${highlightYaml(line)}</div>`).join("");

  return (
    <div className={`overflow-hidden rounded-2xl border border-stone-200 bg-white ${className}`}>
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs">
        <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">YAML</span>
        <span className="text-zinc-400">{lines.length} lines</span>
      </div>
      {/* Single scroll container so line numbers and content stay aligned. */}
      <div className={`overflow-auto ${maxHeightClassName ?? ""}`}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)]">
          {showLineNumbers && (
            <div
              aria-hidden="true"
              className="select-none border-r border-stone-200 bg-stone-50 px-3 py-3 font-mono text-xs leading-6 text-zinc-400"
            >
              {lines.map((_, i) => (
                <div key={i} className="text-right">
                  {i + 1}
                </div>
              ))}
            </div>
          )}
          <pre
            className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-sm leading-6"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}
