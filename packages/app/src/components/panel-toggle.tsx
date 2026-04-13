"use client";

type PanelMode = "yaml" | "instruction" | "both";

interface PanelToggleProps {
  value: PanelMode;
  onChange: (mode: PanelMode) => void;
}

const options: { value: PanelMode; label: string }[] = [
  { value: "yaml", label: "YAML" },
  { value: "instruction", label: "Instruction" },
  { value: "both", label: "Both" },
];

export function PanelToggle({ value, onChange }: PanelToggleProps) {
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
