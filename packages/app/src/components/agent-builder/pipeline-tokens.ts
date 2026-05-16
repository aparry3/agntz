// Color tokens for the pipeline view. Each "kind" of block has a muted
// tinted palette so the flow is glanceable at a distance: dusty blue for LLM,
// amber for tool, sage for sequential containers (incl. loops), plum for
// parallel. Values come straight from the design canvas — keep them in sync
// with `agntzagentbuilder/project/tokens.jsx` if the design ever moves.

export interface KindPalette {
  label: string;
  bg: string;
  bgHeader: string;
  border: string;
  text: string;
  accent: string;
  dot: string;
}

export type PipelineKind = "llm" | "tool" | "sequential" | "parallel";

export const KIND_COLORS: Record<PipelineKind, KindPalette> = {
  llm: {
    label: "LLM",
    bg: "oklch(0.97 0.015 245)",
    bgHeader: "oklch(0.93 0.03 245)",
    border: "oklch(0.84 0.045 245)",
    text: "oklch(0.36 0.07 245)",
    accent: "oklch(0.52 0.10 245)",
    dot: "oklch(0.58 0.13 245)",
  },
  tool: {
    label: "TOOL",
    bg: "oklch(0.97 0.022 80)",
    bgHeader: "oklch(0.93 0.045 80)",
    border: "oklch(0.83 0.07 78)",
    text: "oklch(0.40 0.08 70)",
    accent: "oklch(0.58 0.12 72)",
    dot: "oklch(0.62 0.14 72)",
  },
  sequential: {
    label: "SEQUENTIAL",
    bg: "oklch(0.97 0.013 150)",
    bgHeader: "oklch(0.93 0.025 150)",
    border: "oklch(0.83 0.04 150)",
    text: "oklch(0.36 0.05 150)",
    accent: "oklch(0.50 0.07 150)",
    dot: "oklch(0.55 0.09 150)",
  },
  parallel: {
    label: "PARALLEL",
    bg: "oklch(0.96 0.018 335)",
    bgHeader: "oklch(0.92 0.035 335)",
    border: "oklch(0.83 0.05 335)",
    text: "oklch(0.40 0.06 335)",
    accent: "oklch(0.52 0.09 335)",
    dot: "oklch(0.58 0.12 335)",
  },
};

export const NEUTRAL = {
  paperBg: "#fafaf9",
  paperBg2: "#f5f5f4",
  cardBg: "#ffffff",
  border: "#e7e5e4",
  borderStrong: "#d6d3d1",
  text: "#18181b",
  textMuted: "#71717a",
  textSubtle: "#a1a1aa",
  ink: "#27272a",
};

export const FONT_MONO =
  '"IBM Plex Mono", "SFMono-Regular", "SF Mono", Consolas, monospace';
export const FONT_SANS =
  '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_DISPLAY =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif';
