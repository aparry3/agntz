"use client";

import type { CSSProperties, ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CodeBlock } from "@/components/landing/code-block";
import { TOKENS } from "@/components/landing/tokens";

export type SnippetLanguage = "ts" | "python";
export type CodeLanguage = SnippetLanguage | "yaml" | "bash" | "text";

export type CodeVariant = {
  lang: CodeLanguage;
  code: string;
  filename?: string;
};

type LanguageContextValue = {
  language: SnippetLanguage;
  setLanguage: (language: SnippetLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function isSnippetLanguage(value: string | null): value is SnippetLanguage {
  return value === "ts" || value === "python";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SnippetLanguage>("ts");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("lang");
    const fromStorage = window.localStorage.getItem("agntz-docs-language");
    const next = isSnippetLanguage(fromUrl)
      ? fromUrl
      : isSnippetLanguage(fromStorage)
        ? fromStorage
        : "ts";
    setLanguageState(next);
  }, []);

  const setLanguage = (next: SnippetLanguage) => {
    setLanguageState(next);
    window.localStorage.setItem("agntz-docs-language", next);
    if (window.location.pathname.startsWith("/docs")) {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.history.replaceState({}, "", url);
    }
  };

  const value = useMemo(() => ({ language, setLanguage }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function usePreferredLanguage() {
  const value = useContext(LanguageContext);
  if (!value) {
    return {
      language: "ts" as SnippetLanguage,
      setLanguage: () => undefined,
    };
  }
  return value;
}

export function LanguageToggle({
  compact = false,
  label = "Examples",
  style,
}: {
  compact?: boolean;
  label?: string;
  style?: CSSProperties;
}) {
  const { language, setLanguage } = usePreferredLanguage();
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: compact ? 4 : 5,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 8,
        background: TOKENS.surface,
        boxShadow: compact ? "none" : "0 1px 0 rgba(26,25,22,0.04)",
        ...style,
      }}
      aria-label={`${label} language`}
    >
      {!compact && (
        <span
          style={{
            padding: "0 6px",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: TOKENS.muted,
          }}
        >
          {label}
        </span>
      )}
      {[
        ["ts", "TypeScript"],
        ["python", "Python"],
      ].map(([id, text]) => {
        const active = language === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setLanguage(id as SnippetLanguage)}
            aria-pressed={active}
            style={{
              appearance: "none",
              border: 0,
              borderRadius: 6,
              padding: compact ? "6px 9px" : "7px 11px",
              background: active ? TOKENS.ink : "transparent",
              color: active ? TOKENS.bg : TOKENS.text2,
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: compact ? 10.5 : 11.5,
              fontWeight: active ? 700 : 500,
              letterSpacing: "0.02em",
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function LanguageCodeBlock({
  variants,
  wrap = false,
}: {
  variants: CodeVariant[];
  wrap?: boolean;
}) {
  const { language } = usePreferredLanguage();
  const variant =
    variants.find((item) => item.lang === language) ??
    variants.find((item) => item.lang === "ts") ??
    variants[0];
  if (!variant) return null;
  return (
    <CodeBlock lang={variant.lang} filename={variant.filename} wrap={wrap}>
      {variant.code}
    </CodeBlock>
  );
}
