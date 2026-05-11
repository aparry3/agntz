"use client";

import { AGENT_KINDS, type AgentKindOption } from "@/lib/manifest-catalog";
import { Field, SectionCard, Select, TextArea, TextInput } from "./form-controls";

interface IdentitySectionProps {
  id: string;
  name: string;
  description: string;
  kind: AgentKindOption | "";
  idLocked: boolean;
  onIdChange: (next: string) => void;
  onNameChange: (next: string) => void;
  onDescriptionChange: (next: string) => void;
  onKindChange: (next: AgentKindOption) => void;
}

export function IdentitySection({
  id,
  name,
  description,
  kind,
  idLocked,
  onIdChange,
  onNameChange,
  onDescriptionChange,
  onKindChange,
}: IdentitySectionProps) {
  return (
    <SectionCard
      title="Identity"
      description="Name, id and the kind of agent this is."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Agent ID"
          hint={
            idLocked
              ? "The ID is locked after creation."
              : "Lowercase, dashes ok. Used in URLs and references."
          }
        >
          <TextInput
            value={id}
            onChange={onIdChange}
            placeholder="my-agent-id"
            readOnly={idLocked}
            mono
          />
        </Field>
        <Field label="Display name">
          <TextInput value={name} onChange={onNameChange} placeholder="My Agent" />
        </Field>
        <Field label="Kind">
          <Select<AgentKindOption>
            value={kind}
            onChange={(next) => {
              if (next !== "") onKindChange(next);
            }}
            options={AGENT_KINDS.map((k) => ({ value: k, label: k }))}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="Description"
            hint="A short summary shown in agent lists."
          >
            <TextArea
              value={description}
              onChange={onDescriptionChange}
              rows={3}
              placeholder="What does this agent do?"
            />
          </Field>
        </div>
      </div>
    </SectionCard>
  );
}
