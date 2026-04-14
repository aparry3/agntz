import { NextResponse } from "next/server";
import { requireWorkspaceContext, WorkspaceRequiredError } from "@/lib/workspace";

const SUPPORTED_PROVIDERS = [
  { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o4-mini"] },
  { id: "anthropic", name: "Anthropic", models: ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001", "claude-opus-4-6"] },
  { id: "google", name: "Google", models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
  { id: "mistral", name: "Mistral", models: ["mistral-large-latest", "mistral-small-latest"] },
  { id: "xai", name: "xAI", models: ["grok-3", "grok-3-mini"] },
  { id: "groq", name: "Groq", models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"] },
  { id: "deepseek", name: "DeepSeek", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "perplexity", name: "Perplexity", models: ["sonar-pro", "sonar"] },
  { id: "cohere", name: "Cohere", models: ["command-r-plus", "command-r"] },
  { id: "azure", name: "Azure OpenAI", models: [] },
];

export async function GET() {
  try {
    const { runner } = await requireWorkspaceContext();
    const stored = runner.providers ? await runner.providers.listProviders() : [];
    const storedMap = new Map(stored.map((p) => [p.id, p.configured]));

    const providers = SUPPORTED_PROVIDERS.map((p) => ({
      ...p,
      configured: storedMap.get(p.id) ?? false,
    }));

    return NextResponse.json(providers);
  } catch (error) {
    if (error instanceof WorkspaceRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
