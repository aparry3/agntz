import { flattenContentToText } from "../message-builder.js";
import type { Message, ModelConfig, ModelProvider } from "../types.js";

/**
 * Summarize a list of messages into a concise summary message.
 * Uses the model provider to generate the summary.
 */
export async function summarizeMessages(
	messages: Message[],
	modelProvider: ModelProvider,
	modelConfig: ModelConfig,
	signal?: AbortSignal,
): Promise<string> {
	if (messages.length === 0) return "";

	const conversationText = messages
		.filter((m) => m.role !== "system")
		.map((m) => `${m.role}: ${flattenContentToText(m.content)}`)
		.join("\n");

	const result = await modelProvider.generateText({
		model: modelConfig,
		messages: [
			{
				role: "system",
				content:
					"You are a conversation summarizer. Produce a concise summary of the conversation below. " +
					"Include key decisions, important information exchanged, and any action items. " +
					"Keep the summary under 500 words. Output ONLY the summary, no preamble.",
			},
			{
				role: "user",
				content: `Summarize this conversation:\n\n${conversationText}`,
			},
		],
		signal,
	});

	return result.text;
}

/**
 * Trim session history using the "summary" strategy:
 * - Keep the most recent `keepRecent` messages intact
 * - Summarize all older messages into a single summary message
 * - Returns a new array with [summary_message, ...recent_messages]
 *
 * If there aren't enough messages to warrant summarization, returns them as-is.
 */
export async function trimHistoryWithSummary(
	messages: Message[],
	options: {
		maxMessages: number;
		keepRecent?: number;
		modelProvider: ModelProvider;
		modelConfig: ModelConfig;
		signal?: AbortSignal;
	},
): Promise<Message[]> {
	const { maxMessages, modelProvider, modelConfig, signal } = options;

	if (messages.length <= maxMessages) return messages;

	// Keep the most recent messages intact (default: 60% of maxMessages, min 4)
	const keepRecent =
		options.keepRecent ?? Math.max(4, Math.floor(maxMessages * 0.6));
	const recentMessages = messages.slice(-keepRecent);
	const olderMessages = messages.slice(0, -keepRecent);

	if (olderMessages.length === 0) {
		// Nothing to summarize, just trim
		return messages.slice(-maxMessages);
	}

	// Check if older messages already start with a summary
	// (avoid re-summarizing a summary). Flatten first since content may be a
	// ContentBlock[] in multimodal sessions.
	const existingSummary =
		olderMessages[0]?.role === "system" &&
		flattenContentToText(olderMessages[0]?.content ?? "").startsWith(
			"[Conversation Summary]",
		);

	const toSummarize = existingSummary
		? olderMessages // include existing summary in re-summarization
		: olderMessages;

	const summary = await summarizeMessages(
		toSummarize,
		modelProvider,
		modelConfig,
		signal,
	);

	const summaryMessage: Message = {
		role: "system",
		content: `[Conversation Summary]\n${summary}`,
		timestamp: new Date().toISOString(),
	};

	return [summaryMessage, ...recentMessages];
}
