"use client";

export type PanelMode = "build" | "yaml" | "instruction" | "both";

interface PanelToggleProps {
  value: PanelMode;
  onChange: (mode: PanelMode) => void;
  /** When true, the "Build" option is hidden. */
  hideBuild?: boolean;
  /** When true, the "Instruction" and "Both" options are hidden. */
  hideInstruction?: boolean;
}

interface Option {
  value: PanelMode;
  label: string;
}

const BUILD_OPTION: Option = { value: "build", label: "Build" };
const YAML_OPTION: Option = { value: "yaml", label: "YAML" };
const INSTRUCTION_OPTION: Option = { value: "instruction", label: "Instruction" };
const BOTH_OPTION: Option = { value: "both", label: "Both" };

export function PanelToggle({ value, onChange, hideBuild, hideInstruction }: PanelToggleProps) {
  const options: Option[] = [];
  if (!hideBuild) options.push(BUILD_OPTION);
  options.push(YAML_OPTION);
  if (!hideInstruction) {
    options.push(INSTRUCTION_OPTION);
    options.push(BOTH_OPTION);
  }

  return (
    <div className="inline-flex rounded-xl border border-stone-200 bg-stone-100 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value
              ? "bg-white text-zinc-950 shadow-sm"
              : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
