"use client";

import { SectionCard } from "./form-controls";

interface InstructionSectionProps {
  instruction: string;
  onChange: (next: string) => void;
}

export function InstructionSection({ instruction, onChange }: InstructionSectionProps) {
  return (
    <SectionCard
      title="Instruction"
      description="The system prompt this agent runs with."
    >
      <textarea
        value={instruction}
        onChange={(event) => onChange(event.target.value)}
        rows={12}
        spellCheck={false}
        placeholder="You are a helpful assistant..."
        className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 outline-none transition focus:border-zinc-400 focus:bg-white"
      />
    </SectionCard>
  );
}
