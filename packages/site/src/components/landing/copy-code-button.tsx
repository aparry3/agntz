"use client";

import { useState } from "react";
import { TOKENS } from "./tokens";

export function CopyCodeButton({ text }: { text: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 1500);
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label="Copy code to clipboard"
      style={{
        appearance: "none",
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        fontFamily: "var(--mono)",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: status === "copied" ? TOKENS.ok : TOKENS.muted,
        transition: "color 120ms ease",
      }}
    >
      {status === "copied" ? "copied" : status === "error" ? "failed" : "copy"}
    </button>
  );
}
