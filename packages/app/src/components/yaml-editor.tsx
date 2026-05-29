"use client";

import type { Catalog } from "@/lib/use-catalog";
import {
	type Suggestion,
	mcpServerInScope,
	parseYamlContext,
	suggestionsFor,
} from "@/lib/yaml-context";
import { highlightYaml } from "@/lib/yaml-highlight";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { parse as parseYAML } from "yaml";
import { CompletionPopover } from "./yaml-editor/completion-popover";

interface YamlEditorProps {
	value: string;
	onChange: (value: string) => void;
	onSaveShortcut?: () => void;
	placeholder?: string;
	className?: string;
	catalog?: Catalog;
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

// Approximate metrics for our text-sm + font-mono + leading-6 styling.
const LINE_HEIGHT = 24;
const CHAR_WIDTH = 8.4;
const EDITOR_PADDING_X = 16;
const EDITOR_PADDING_Y = 12;

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

		if (
			!trimmed ||
			trimmed.trimStart().startsWith("#") ||
			!trimmed.endsWith(":")
		) {
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

function tryParseManifest(yaml: string): Record<string, unknown> | null {
	try {
		const parsed = parseYAML(yaml);
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function caretLineCol(value: string, caret: number) {
	const before = value.slice(0, caret);
	const lines = before.split("\n");
	return {
		line: lines.length - 1,
		col: lines[lines.length - 1].length,
	};
}

function isCaretAtLineEnd(value: string, caret: number): boolean {
	const nextNewline = value.indexOf("\n", caret);
	const lineEnd = nextNewline === -1 ? value.length : nextNewline;
	return value.slice(caret, lineEnd).trim() === "";
}

export function YamlEditor({
	value,
	onChange,
	onSaveShortcut,
	placeholder,
	className = "",
	catalog,
}: YamlEditorProps) {
	const editorId = useId();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const lineNumbersRef = useRef<HTMLDivElement>(null);
	const highlightRef = useRef<HTMLPreElement>(null);
	const foldedViewRef = useRef<HTMLDivElement>(null);
	const [collapsedBlocks, setCollapsedBlocks] = useState<Set<number>>(
		new Set(),
	);

	const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
	const [activeIndex, setActiveIndex] = useState(0);
	const [popoverPos, setPopoverPos] = useState<{
		top: number;
		left: number;
	} | null>(null);
	const [valuePrefixLen, setValuePrefixLen] = useState(0);

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
		() =>
			hasCollapsedBlocks
				? getVisibleLines(lines, collapsedBlocks)
				: lines.map((line, lineIndex) => ({ lineIndex, line, hiddenCount: 0 })),
		[collapsedBlocks, hasCollapsedBlocks, lines],
	);

	const highlightedMarkup = useMemo(
		() => lines.map((line) => `<div>${highlightYamlLine(line)}</div>`).join(""),
		[lines],
	);

	const closePopover = useCallback(() => {
		setSuggestions([]);
		setPopoverPos(null);
		setActiveIndex(0);
		setValuePrefixLen(0);
	}, []);

	const refreshSuggestions = useCallback(
		(nextValue: string, caret: number) => {
			if (!catalog) {
				closePopover();
				return;
			}

			if (!isCaretAtLineEnd(nextValue, caret)) {
				closePopover();
				return;
			}

			const ctx = parseYamlContext(nextValue, caret);
			if (!ctx) {
				closePopover();
				return;
			}

			const parsed = tryParseManifest(nextValue);
			const matches = suggestionsFor(ctx, catalog, parsed);

			// Trigger MCP tools fetch if needed (catalog will populate, next keystroke
			// will pick it up).
			const serverId = mcpServerInScope(ctx);
			if (serverId && !catalog.mcpToolsByServer[serverId]) {
				catalog.loadMcpTools(serverId);
			}

			if (matches.length === 0) {
				closePopover();
				return;
			}

			const { line, col } = caretLineCol(nextValue, caret);
			const textarea = textareaRef.current;
			const scrollTop = textarea ? textarea.scrollTop : 0;
			const scrollLeft = textarea ? textarea.scrollLeft : 0;

			const top = EDITOR_PADDING_Y + (line + 1) * LINE_HEIGHT - scrollTop + 2;
			const left = EDITOR_PADDING_X + col * CHAR_WIDTH - scrollLeft;

			setSuggestions(matches);
			setActiveIndex(0);
			setPopoverPos({ top, left });
			setValuePrefixLen(ctx.valuePrefix.length);
		},
		[catalog, closePopover],
	);

	const handleSelectSuggestion = useCallback(
		(suggestion: Suggestion) => {
			const textarea = textareaRef.current;
			if (!textarea) return;

			const caret = textarea.selectionStart;
			const start = caret - valuePrefixLen;
			const before = value.slice(0, start);
			const after = value.slice(caret);
			const nextValue = `${before}${suggestion.value}${after}`;
			onChange(nextValue);

			requestAnimationFrame(() => {
				const ref = textareaRef.current;
				if (!ref) return;
				const nextCaret = start + suggestion.value.length;
				ref.selectionStart = nextCaret;
				ref.selectionEnd = nextCaret;
				ref.focus();
			});
			closePopover();
		},
		[closePopover, onChange, value, valuePrefixLen],
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

		if (popoverPos) {
			// Reposition popover relative to scroll.
			closePopover();
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

	const popoverOpen = suggestions.length > 0 && popoverPos !== null;

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const textarea = event.currentTarget;

		if ((event.metaKey || event.ctrlKey) && event.key === "s") {
			event.preventDefault();
			onSaveShortcut?.();
			return;
		}

		if (popoverOpen) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActiveIndex((current) => (current + 1) % suggestions.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setActiveIndex(
					(current) => (current - 1 + suggestions.length) % suggestions.length,
				);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				handleSelectSuggestion(suggestions[activeIndex]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				closePopover();
				return;
			}
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

	const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
		const nextValue = event.target.value;
		onChange(nextValue);

		requestAnimationFrame(() => {
			const ref = textareaRef.current;
			if (!ref) return;
			refreshSuggestions(nextValue, ref.selectionStart);
		});
	};

	const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Escape" || event.key === "Enter" || event.key === "Tab")
			return;
		const textarea = event.currentTarget;
		refreshSuggestions(value, textarea.selectionStart);
	};

	const handleClick = (event: React.MouseEvent<HTMLTextAreaElement>) => {
		const textarea = event.currentTarget;
		refreshSuggestions(value, textarea.selectionStart);
	};

	const handleBlur = () => {
		// Defer so click-on-popover registers before we close.
		setTimeout(() => closePopover(), 150);
	};

	return (
		<div
			className={`overflow-hidden rounded-2xl border border-stone-200 bg-white ${className}`}
		>
			<div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs">
				<span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">
					YAML
				</span>
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
					Folded view is read-only. Expand a block to continue editing that
					section.
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
							<div
								key={`${editorId}-${lineIndex}`}
								className="flex items-center gap-2"
							>
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
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												d="M9 5l7 7-7 7"
											/>
										</svg>
									) : (
										"•"
									)}
								</button>
								<span className="min-w-[2.25rem] text-right">
									{lineIndex + 1}
								</span>
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
								<span
									dangerouslySetInnerHTML={{ __html: highlightYamlLine(line) }}
								/>
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
							onChange={handleChange}
							onKeyDown={handleKeyDown}
							onKeyUp={handleKeyUp}
							onClick={handleClick}
							onBlur={handleBlur}
							onScroll={syncEditScroll}
							spellCheck={false}
							placeholder={placeholder}
							className="absolute inset-0 max-h-[32rem] w-full resize-none overflow-auto bg-transparent px-4 py-3 font-mono text-sm leading-6 text-transparent caret-zinc-900 outline-none selection:bg-zinc-200 placeholder:text-zinc-300"
						/>
						{popoverOpen && popoverPos && (
							<CompletionPopover
								suggestions={suggestions}
								activeIndex={activeIndex}
								top={popoverPos.top}
								left={popoverPos.left}
								onSelect={handleSelectSuggestion}
							/>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
