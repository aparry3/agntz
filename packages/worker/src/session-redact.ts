import type { Message, ToolCallRecord, UnifiedStore } from "@agntz/core";

/**
 * Replace use_skill tool outputs with a placeholder so persisted sessions
 * don't carry the full skill instructions across runs. The tool-call shape
 * (name, id, input, duration, error) is preserved verbatim — only the
 * `instructions` field of the output is rewritten.
 *
 * Pure: returns a new array (and patches new nested objects) when a redaction
 * happens, otherwise returns the input reference unchanged.
 */
export function redactSkillToolResults(messages: Message[]): Message[] {
  let touched = false;
  const next: Message[] = messages.map(msg => {
    if (!msg.toolCalls || msg.toolCalls.length === 0) return msg;
    let msgTouched = false;
    const nextCalls: ToolCallRecord[] = msg.toolCalls.map(tc => {
      if (tc.name !== "use_skill") return tc;
      const out = tc.output;
      if (!isSkillOutput(out)) return tc;
      msgTouched = true;
      return {
        ...tc,
        output: {
          name: out.name,
          description: out.description,
          instructions: `[skill '${out.name}' was loaded earlier — call use_skill('${out.name}') to re-load]`,
        },
      };
    });
    if (!msgTouched) return msg;
    touched = true;
    return { ...msg, toolCalls: nextCalls };
  });
  return touched ? next : messages;
}

function isSkillOutput(
  value: unknown,
): value is { name: string; description: string; instructions: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.instructions === "string"
  );
}

/**
 * Wrap a UnifiedStore so every `append` call passes through
 * `redactSkillToolResults` before delegating to the real store. `forUser`
 * returns its scoped store re-wrapped so redaction follows the scope chain.
 * All other methods/properties pass through unchanged.
 */
export function wrapWithSkillRedaction<T extends UnifiedStore>(store: T): T {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "append") {
        return (sessionId: string, messages: Message[]) =>
          target.append(sessionId, redactSkillToolResults(messages));
      }
      if (prop === "forUser") {
        return (userId: string) => wrapWithSkillRedaction(target.forUser(userId));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}
