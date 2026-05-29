/**
 * Static fallback catalog of providers + curated model lists.
 *
 * The live `/api/providers/[id]/models` endpoint is preferred when the user
 * has configured the provider's API key. These static lists exist for:
 * - Listing which providers exist in the picker (id + display name)
 * - A safety fallback if a live `/models` fetch fails on a configured provider
 */

export interface SupportedProvider {
	id: string;
	name: string;
	/** Curated default model list — used as a fallback only. */
	models: string[];
}

export const SUPPORTED_PROVIDERS: SupportedProvider[] = [
	{
		id: "openai",
		name: "OpenAI",
		models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4-pro"],
	},
	{
		id: "anthropic",
		name: "Anthropic",
		models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
	},
	{
		id: "google",
		name: "Google",
		models: [
			"gemini-3.1-pro-preview",
			"gemini-3-flash",
			"gemini-3.1-flash-lite-preview",
		],
	},
	{ id: "openrouter", name: "OpenRouter", models: [] },
	{
		id: "mistral",
		name: "Mistral",
		models: [
			"mistral-large-latest",
			"mistral-medium-latest",
			"mistral-small-latest",
		],
	},
	{
		id: "xai",
		name: "xAI",
		models: ["grok-4.20", "grok-4.1", "grok-4.1-mini"],
	},
	{
		id: "groq",
		name: "Groq",
		models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		models: ["deepseek-chat", "deepseek-reasoner"],
	},
	{
		id: "perplexity",
		name: "Perplexity",
		models: [
			"sonar-pro",
			"sonar",
			"sonar-reasoning-pro",
			"sonar-reasoning",
			"sonar-deep-research",
		],
	},
	{
		id: "cohere",
		name: "Cohere",
		models: [
			"command-a-03-2025",
			"command-r-plus-08-2024",
			"command-r-08-2024",
			"command-r7b",
		],
	},
	{ id: "azure", name: "Azure OpenAI", models: [] },
];

export function findSupportedProvider(
	id: string,
): SupportedProvider | undefined {
	return SUPPORTED_PROVIDERS.find((p) => p.id === id);
}
