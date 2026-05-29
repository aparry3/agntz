import type {
	AgentDefinition,
	ContentBlock,
	ContextEntry,
	Message,
} from "./types.js";
import { isContentBlockArray } from "./types.js";

/**
 * AI SDK content part shape. Mirrors `@ai-sdk/provider-utils` `TextPart` /
 * `ImagePart` — duplicated here so the runner doesn't take a runtime
 * dependency on the AI SDK's types just to build a message array. The model
 * provider passes these through unchanged (see model-provider.ts).
 *
 * `image` carries a raw base64 string for v1; provider-utils accepts string,
 * Uint8Array, Buffer, or URL, but every code path through normalizeImageBlocks
 * produces base64 first, so we standardize on string.
 */
export type AiMessagePart =
	| { type: "text"; text: string }
	| { type: "image"; image: string; mediaType?: string }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			input: unknown;
			providerOptions?: unknown;
	  }
	| {
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			output:
				| { type: "text"; value: string }
				| { type: "json"; value: unknown };
	  };

/**
 * Output message shape consumed by `ModelProvider.generateText` /
 * `streamText`. `content` is `string` for back-compat with text-only callers
 * and `AiMessagePart[]` for multimodal user messages.
 */
export interface AiSdkMessage {
	role: string;
	content: string | AiMessagePart[];
}

/**
 * Build the message array for a model call.
 * Order: system prompt (with context) → session history → user input
 *
 * Accepts either a plain string (legacy) or a `ContentBlock[]` (multimodal).
 * Multimodal user blocks are emitted as AI SDK parts; string input remains a
 * plain string for full backward compatibility with text-only providers.
 */
export function buildMessages(options: {
	agent: AgentDefinition;
	input: string | ContentBlock[];
	sessionHistory?: Message[];
	contextEntries?: Map<string, ContextEntry[]>;
	extraContext?: string;
}): AiSdkMessage[] {
	const { agent, input, sessionHistory, contextEntries, extraContext } =
		options;
	const messages: AiSdkMessage[] = [];

	// 1. System prompt (with context injected)
	let systemContent = agent.systemPrompt;

	// Inject few-shot examples
	if (agent.examples?.length) {
		systemContent += "\n\n## Examples\n";
		for (const ex of agent.examples) {
			systemContent += `\nUser: ${ex.input}\nAssistant: ${ex.output}\n`;
		}
	}

	// Inject context entries
	if (contextEntries && contextEntries.size > 0) {
		systemContent += "\n\n";
		for (const [contextId, entries] of contextEntries) {
			if (entries.length === 0) continue;
			systemContent += `<context id="${contextId}">\n`;
			for (const entry of entries) {
				systemContent += `  <entry agent="${entry.agentId}" time="${entry.createdAt}">\n`;
				systemContent += `    ${entry.content}\n`;
				systemContent += "  </entry>\n";
			}
			systemContent += "</context>\n";
		}
	}

	// Inject extra context
	if (extraContext) {
		systemContent += `\n\n<extra-context>\n${extraContext}\n</extra-context>`;
	}

	messages.push({ role: "system", content: systemContent });

	// 2. Session history
	if (sessionHistory?.length) {
		for (const msg of sessionHistory) {
			// Skip system messages from history, except conversation summaries.
			// Use the flattened text view for the startsWith check so it works
			// whether `content` is a string or a ContentBlock[].
			const flat = flattenContentToText(msg.content);
			if (msg.role === "system" && !flat.startsWith("[Conversation Summary]"))
				continue;

			messages.push({
				role: msg.role,
				content: messageContentToAiSdk(msg.content),
			});
		}
	}

	// 3. User input (apply template if defined)
	if (isContentBlockArray(input)) {
		// Multimodal — emit a parts array. The userPromptTemplate is intentionally
		// bypassed: replacing `{{input}}` with a serialized blocks array would
		// produce nonsense, and the standard MMS pattern is "text + image" in
		// separate parts.
		messages.push({
			role: "user",
			content: contentBlocksToAiSdkParts(input),
		});
	} else {
		let userContent = input;
		if (agent.userPromptTemplate) {
			userContent = agent.userPromptTemplate.replace("{{input}}", input);
		}
		messages.push({ role: "user", content: userContent });
	}

	return messages;
}

/**
 * Convert a stored `Message.content` (string or ContentBlock[]) to the AI SDK
 * `content` field. Strings pass through; ContentBlock[] becomes a parts
 * array.
 */
export function messageContentToAiSdk(
	content: string | ContentBlock[],
): string | AiMessagePart[] {
	if (typeof content === "string") return content;
	return contentBlocksToAiSdkParts(content);
}

/**
 * Map ContentBlock[] → AI SDK parts.
 * - text blocks → `{type:"text", text}`
 * - image-with-base64 → `{type:"image", image: base64, mediaType}`
 * - image-with-url is unexpected here (the runner normalizes URLs before
 *   passing blocks to the message builder) — we fall back to a text part that
 *   names the URL so the model isn't completely lost if it slips through.
 */
export function contentBlocksToAiSdkParts(
	blocks: ContentBlock[],
): AiMessagePart[] {
	const parts: AiMessagePart[] = [];
	for (const b of blocks) {
		if (b.type === "text") {
			parts.push({ type: "text", text: b.text });
			continue;
		}
		if ("base64" in b) {
			parts.push({ type: "image", image: b.base64, mediaType: b.mediaType });
			continue;
		}
		// image-with-url that escaped normalization: degrade gracefully.
		parts.push({ type: "text", text: `[image: ${b.url}]` });
	}
	return parts;
}

/**
 * Flatten a `string | ContentBlock[]` into a single text view. Used by
 * stores to populate the legacy `content TEXT` column, and by the
 * conversation-summary detection inside `buildMessages`. Image blocks are
 * rendered as a `[image]` placeholder.
 */
export function flattenContentToText(content: string | ContentBlock[]): string {
	if (typeof content === "string") return content;
	const pieces: string[] = [];
	for (const b of content) {
		if (b.type === "text") pieces.push(b.text);
		else pieces.push("[image]");
	}
	return pieces.join(" ");
}

/**
 * Trim session history using sliding window strategy.
 */
export function trimHistory(
	messages: Message[],
	maxMessages: number,
): Message[] {
	if (messages.length <= maxMessages) return messages;

	// Keep the most recent messages
	return messages.slice(-maxMessages);
}
