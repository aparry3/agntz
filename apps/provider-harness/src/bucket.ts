import type { ResultBucket } from "./types.js";

export type Outcome =
	| { kind: "pass" }
	| { kind: "assertion-failed"; reason: string }
	| { kind: "thrown"; error: Error }
	| { kind: "timeout" };

export function classify(input: {
	capabilitySupported: boolean;
	outcome: Outcome;
}): ResultBucket {
	const { capabilitySupported, outcome } = input;

	if (outcome.kind === "timeout") return "TIMEOUT";

	if (outcome.kind === "pass") {
		return capabilitySupported ? "PASS" : "UNEXPECTED_UNSUPPORTED";
	}

	if (outcome.kind === "assertion-failed") {
		// The call returned but our structural check on the result failed.
		// Treat as SDK_ERROR — the response shape didn't match what we expect.
		return "SDK_ERROR";
	}

	const msg = outcome.error.message ?? "";

	if (looksLikeRateLimit(msg)) {
		return "RATE_LIMITED";
	}
	if (looksLikeUnsupported(msg)) {
		return capabilitySupported
			? "UNEXPECTED_UNSUPPORTED"
			: "EXPECTED_UNSUPPORTED";
	}
	// A capability the matrix says is unsupported that produces no output (e.g.
	// OpenRouter routing a model to an endpoint without the feature) is expected.
	// Gated on !capabilitySupported so an empty stream on a *supported* capability
	// still reads as a real SDK_ERROR.
	if (!capabilitySupported && /no output generated/i.test(msg)) {
		return "EXPECTED_UNSUPPORTED";
	}
	if (looksLikeProviderError(msg)) {
		return "PROVIDER_ERROR";
	}
	// A (usually 200) response the provider's AI-SDK adapter couldn't parse or
	// schema-validate — e.g. @ai-sdk/cohere rejecting a valid Cohere response
	// whose citations omit the `document` field its Zod schema requires. The model
	// worked; it's an upstream adapter fault, not an agntz SDK bug.
	if (looksLikeAdapterParseError(outcome.error)) {
		return "PROVIDER_ERROR";
	}
	return "SDK_ERROR";
}

export function isMissingCredentials(err: Error): boolean {
	const msg = (err.message ?? "").toLowerCase();
	// Each provider phrases missing/invalid auth differently. Treat both
	// "no key" and "key provided but rejected" as SKIPPED for harness purposes —
	// either way we can't actually test this model.
	if (/\bunauthorized\b/.test(msg)) return true;
	if (/x-api-key.*required|api[\s_-]?key.*required/.test(msg)) return true;
	if (/invalid[\s_-]api[\s_-]?key/.test(msg)) return true;
	if (/no api key|missing api key/.test(msg)) return true;
	if (/unregistered caller/.test(msg)) return true;
	if (
		/api[\s_-]?key|api[\s_-]?token/.test(msg) &&
		/required|missing|not\s+(?:set|configured|provided|loaded|found)|undefined|no\b/.test(
			msg,
		)
	)
		return true;
	if (/authentication.*(?:fail|required|missing|invalid)/.test(msg))
		return true;
	if (/credential.*(?:missing|invalid|not.*set|required)/.test(msg))
		return true;
	return false;
}

function looksLikeRateLimit(msg: string): boolean {
	// OpenAI: "exceeded your current quota"; Google free tier: "Quota exceeded
	// ... limit: 5 ... Please retry in 15s"; OpenRouter free tier: "requires more
	// credits", "Prompt tokens limit exceeded", "can only afford N". All are
	// account/tier constraints, not SDK or model faults.
	return /\b429\b|rate.?limit|quota|exceeded your current quota|resource[_\s]exhausted|too many requests|please retry in|requires more credits|insufficient credits|never purchased credits|upgrade to a paid account|tokens limit exceeded|can only afford/i.test(
		msg,
	);
}

function looksLikeUnsupported(msg: string): boolean {
	// "content must be a string": text-only models (e.g. Groq Llama 3.3) reject
	// multimodal message parts — an expected capability gap, not an SDK fault.
	return /unsupported|not\s+support|does\s+not\s+support|not\s+available|no endpoints found that support|invalid_request_error.*unsupported|capability.*not|content must be a string/i.test(
		msg,
	);
}

function looksLikeProviderError(msg: string): boolean {
	// Match specific 5xx status codes, not any 3-digit number starting with 5
	// (token counts like "512" were false-matching the old \b5\d{2}\b).
	return /\b(500|502|503|504)\b|service\s+unavailable|internal\s+server\s+error|server\s+error|bad\s+gateway|gateway\s+timeout/i.test(
		msg,
	);
}

function looksLikeAdapterParseError(err: Error): boolean {
	// The provider returned a response its AI-SDK adapter couldn't parse or
	// schema-validate (e.g. @ai-sdk/cohere rejecting citations that omit the
	// `document` field its Zod schema requires). Upstream adapter fault, not ours.
	const name = err.name ?? "";
	const msg = err.message ?? "";
	return (
		/TypeValidation|JSONParse/i.test(name) ||
		/invalid json response|type validation failed/i.test(msg)
	);
}
