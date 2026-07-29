import { describe, expect, it } from "vitest";
import { classify, isMissingCredentials } from "../src/bucket.js";

describe("classify", () => {
	it("separates SDK regressions from provider and account failures", () => {
		expect(
			classify({
				capabilitySupported: true,
				outcome: { kind: "assertion-failed", reason: "wrong shape" },
			}),
		).toBe("SDK_ERROR");
		expect(
			classify({
				capabilitySupported: true,
				outcome: { kind: "thrown", error: new Error("429 rate limit") },
			}),
		).toBe("RATE_LIMITED");
		expect(
			classify({
				capabilitySupported: true,
				outcome: { kind: "thrown", error: new Error("503 unavailable") },
			}),
		).toBe("PROVIDER_ERROR");
		expect(
			classify({ capabilitySupported: true, outcome: { kind: "timeout" } }),
		).toBe("TIMEOUT");
	});
});

describe("isMissingCredentials", () => {
	it("recognizes common authentication failures", () => {
		expect(isMissingCredentials(new Error("invalid_api_key"))).toBe(true);
		expect(isMissingCredentials(new Error("x-api-key is required"))).toBe(true);
		expect(isMissingCredentials(new Error("model not found"))).toBe(false);
	});
});
