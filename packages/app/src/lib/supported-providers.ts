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
		models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
	},
	{
		id: "anthropic",
		name: "Anthropic",
		models: [
			"claude-fable-5",
			"claude-opus-5",
			"claude-sonnet-5",
			"claude-haiku-4-5",
		],
	},
	{
		id: "google",
		name: "Google",
		models: [
			"gemini-3.6-flash",
			"gemini-3.5-flash",
			"gemini-3.5-flash-lite",
			"gemini-3.1-pro-preview",
		],
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		models: [
			"openai/gpt-5.6-sol",
			"anthropic/claude-opus-5",
			"google/gemini-3.6-flash",
			"x-ai/grok-4.5",
			"deepseek/deepseek-v4-pro",
		],
	},
	{
		id: "mistral",
		name: "Mistral",
		models: ["mistral-medium-3-5", "mistral-small-2603", "mistral-large-2512"],
	},
	{
		id: "xai",
		name: "xAI",
		models: ["grok-4.5"],
	},
	{
		id: "groq",
		name: "Groq",
		models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		models: ["deepseek-v4-pro", "deepseek-v4-flash"],
	},
	{
		id: "perplexity",
		name: "Perplexity",
		models: [
			"sonar-pro",
			"sonar",
			"sonar-reasoning-pro",
			"sonar-deep-research",
		],
	},
	{
		id: "cohere",
		name: "Cohere",
		models: [
			"command-a-plus-05-2026",
			"command-a-03-2025",
			"command-a-reasoning-08-2025",
			"command-a-vision-07-2025",
			"command-r7b-12-2024",
		],
	},
	{ id: "azure", name: "Azure OpenAI", models: [] },
];

export function findSupportedProvider(
	id: string,
): SupportedProvider | undefined {
	return SUPPORTED_PROVIDERS.find((p) => p.id === id);
}
