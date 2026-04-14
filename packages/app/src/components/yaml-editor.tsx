"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { highlightYaml } from "@/lib/yaml-highlight";

interface YamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSaveShortcut?: () => void;
  placeholder?: string;
  className?: string;
}

interface FoldableLine {
  lineIndex: number;
  indent: number;
}

interface VisibleLine {
  lineIndex: number;
  line: string;
  hiddenCount: number;
}

const highlightYamlLine = highlightYaml;

function getIndent(line: string) {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function isMeaningfulLine(line: string) {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith("#");
}

function findFoldableLines(lines: string[]) {
  const foldable = new Map<number, FoldableLine>();

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index];
    const trimmed = currentLine.trimEnd();

    if (!trimmed || trimmed.trimStart().startsWith("#") || !trimmed.endsWith(":")) {
      continue;
    }

    const currentIndent = getIndent(currentLine);

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];

      if (!isMeaningfulLine(nextLine)) {
        continue;
      }

      const nextIndent = getIndent(nextLine);
      if (nextIndent > currentIndent) {
        foldable.set(index, { lineIndex: index, indent: currentIndent });
      }
      break;
    }
  }

  return foldable;
}

function countHiddenChildren(lines: string[], lineIndex: number) {
  const parentIndent = getIndent(lines[lineIndex]);
  let hiddenCount = 0;

  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      hiddenCount += 1;
      continue;
    }

    if (getIndent(line) <= parentIndent) {
      break;
    }

    hiddenCount += 1;
  }

  return hiddenCount;
}

function getVisibleLines(lines: string[], collapsed: Set<number>) {
  const visible: VisibleLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    visible.push({
      lineIndex: index,
      line,
      hiddenCount: collapsed.has(index) ? countHiddenChildren(lines, index) : 0,
    });

    if (!collapsed.has(index)) {
      continue;
    }

    const parentIndent = getIndent(line);

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];

      if (!nextLine.trim()) {
        index = nextIndex;
        continue;
      }

      if (getIndent(nextLine) <= parentIndent) {
        index = nextIndex - 1;
        break;
      }

      if (nextIndex === lines.length - 1) {
        index = nextIndex;
      }
    }
  }

  return visible;
}

export function YamlEditor({
  value,
  onChange,
  onSaveShortcut,
  placeholder,
  className = "",
}: YamlEditorProps) {
  const editorId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const foldedViewRef = useRef<HTMLDivElement>(null);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<number>>(new Set());

  const lines = useMemo(() => {
    const entries = value.split("\n");
    return entries.length > 0 ? entries : [""];
  }, [value]);

  const foldableLines = useMemo(() => findFoldableLines(lines), [lines]);
  const hasCollapsedBlocks = collapsedBlocks.size > 0;

  useEffect(() => {
    setCollapsedBlocks((current) => {
      const next = new Set<number>();
      for (const lineIndex of current) {
        if (foldableLines.has(lineIndex)) {
          next.add(lineIndex);
        }
      }
      return next;
    });
  }, [foldableLines]);

  const visibleLines = useMemo(
    () => (hasCollapsedBlocks ? getVisibleLines(lines, collapsedBlocks) : lines.map((line, lineIndex) => ({ lineIndex, line, hiddenCount: 0 }))),
    [collapsedBlocks, hasCollapsedBlocks, lines]
  );

  const highlightedMarkup = useMemo(
    () => lines.map((line) => `<div>${highlightYamlLine(line)}</div>`).join(""),
    [lines]
  );

  const syncEditScroll = () => {
    if (!textareaRef.current) return;
    const top = textareaRef.current.scrollTop;
    const left = textareaRef.current.scrollLeft;

    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = top;
    }

    if (highlightRef.current) {
      highlightRef.current.scrollTop = top;
      highlightRef.current.scrollLeft = left;
    }
  };

  const syncFoldedScroll = () => {
    if (!foldedViewRef.current || !lineNumbersRef.current) return;
    lineNumbersRef.current.scrollTop = foldedViewRef.current.scrollTop;
  };

  const toggleBlock = (lineIndex: number) => {
    if (!foldableLines.has(lineIndex)) return;

    setCollapsedBlocks((current) => {
      const next = new Set(current);
      if (next.has(lineIndex)) {
        next.delete(lineIndex);
      } else {
        next.add(lineIndex);
      }
      return next;
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;

    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      onSaveShortcut?.();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange(nextValue);

      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.selectionStart = start + 2;
        textareaRef.current.selectionEnd = start + 2;
      });
      return;
    }

    if (event.key === "Enter") {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const currentLine = value.slice(lineStart, start);
      const indentation = currentLine.match(/^\s*/)?.[0] ?? "";
      const extraIndent = currentLine.trimEnd().endsWith(":") ? "  " : "";

      event.preventDefault();
      const insertion = `\n${indentation}${extraIndent}`;
      const nextValue = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
      onChange(nextValue);

      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        const cursor = start + insertion.length;
        textareaRef.current.selectionStart = cursor;
        textareaRef.current.selectionEnd = cursor;
      });
    }
  };

  return (
    <div className={`overflow-hidden rounded-2xl border border-stone-200 bg-white ${className}`}>
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs">
        <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">YAML</span>
        <div className="flex items-center gap-3 text-zinc-400">
          {hasCollapsedBlocks && (
            <button
              onClick={() => setCollapsedBlocks(new Set())}
              className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-stone-50"
            >
              Expand all
            </button>
          )}
          <span>
            {visibleLines.length}/{lines.length} lines
          </span>
        </div>
      </div>

      {hasCollapsedBlocks && (
        <div className="border-b border-stone-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Folded view is read-only. Expand a block to continue editing that section.
        </div>
      )}

      <div className="grid grid-cols-[auto_minmax(0,1fr)]">
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          className="max-h-[32rem] overflow-hidden border-r border-stone-200 bg-stone-50 px-2 py-3 font-mono text-xs leading-6 text-zinc-400"
        >
          {visibleLines.map(({ lineIndex }) => {
            const isFoldable = foldableLines.has(lineIndex);
            const isCollapsed = collapsedBlocks.has(lineIndex);

            return (
              <div key={`${editorId}-${lineIndex}`} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleBlock(lineIndex)}
                  disabled={!isFoldable}
                  className={`flex h-5 w-5 items-center justify-center rounded transition ${
                    isFoldable
                      ? "text-zinc-500 hover:bg-stone-200 hover:text-zinc-800"
                      : "cursor-default text-transparent"
                  }`}
                  aria-label={isCollapsed ? "Expand block" : "Collapse block"}
                >
                  {isFoldable ? (
                    <svg
                      className={`h-3 w-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  ) : (
                    "•"
                  )}
                </button>
                <span className="min-w-[2.25rem] text-right">{lineIndex + 1}</span>
              </div>
            );
          })}
        </div>

        {hasCollapsedBlocks ? (
          <div
            ref={foldedViewRef}
            onScroll={syncFoldedScroll}
            className="max-h-[32rem] overflow-auto px-4 py-3 font-mono text-sm leading-6"
          >
            {visibleLines.map(({ lineIndex, line, hiddenCount }) => (
              <div key={`${editorId}-folded-${lineIndex}`} className="min-h-6">
                <span dangerouslySetInnerHTML={{ __html: highlightYamlLine(line) }} />
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleBlock(lineIndex)}
                    className="ml-3 rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:bg-stone-200 hover:text-zinc-800"
                  >
                    {hiddenCount} hidden line{hiddenCount === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="relative min-w-0">
            <pre
              ref={highlightRef}
              aria-hidden="true"
              className="pointer-events-none max-h-[32rem] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-sm leading-6"
              dangerouslySetInnerHTML={{ __html: highlightedMarkup }}
            />
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={syncEditScroll}
              spellCheck={false}
              placeholder={placeholder}
              className="absolute inset-0 max-h-[32rem] w-full resize-none overflow-auto bg-transparent px-4 py-3 font-mono text-sm leading-6 text-transparent caret-zinc-900 outline-none selection:bg-zinc-200 placeholder:text-zinc-300"
            />
          </div>
        )}
      </div>
    </div>
  );
}
