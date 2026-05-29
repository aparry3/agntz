import { describe, expect, it, vi } from "vitest";
import {
	OutboundUrlPolicyError,
	assertOutboundUrlAllowed,
	fetchWithOutboundPolicy,
	validateOutboundUrl,
} from "../src/utils/outbound-url.js";

describe("outbound URL policy", () => {
	it.each([
		"file:///etc/passwd",
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://10.0.0.5",
		"http://169.254.169.254/latest/meta-data",
		"http://192.168.1.2",
		"http://[::1]/",
		"http://[0:0:0:0:0:0:0:1]/",
		"http://[::ffff:127.0.0.1]/",
		"http://[fd00::1]/",
		"http://[fe80::1]/",
	])("blocks unsafe literal URL %s", (url) => {
		expect(() => validateOutboundUrl(url)).toThrow(OutboundUrlPolicyError);
	});

	it("blocks public hostnames that resolve to private addresses", async () => {
		await expect(
			assertOutboundUrlAllowed("https://safe-looking.example/api", {
				resolveHostname: async () => ["10.0.0.1"],
			}),
		).rejects.toMatchObject({ code: "disallowed_host" });
	});

	it("allows public hostnames that resolve to public addresses", async () => {
		await expect(
			assertOutboundUrlAllowed("https://api.example.com/users", {
				resolveHostname: async () => ["93.184.216.34"],
			}),
		).resolves.toBeInstanceOf(URL);
	});

	it("validates same-origin redirects before following them", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "/next" },
				}),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const response = await fetchWithOutboundPolicy(
			"https://api.example.com/start",
			{},
			{
				fetchImpl: fetchImpl as unknown as typeof fetch,
				policy: { skipDnsResolution: true },
			},
		);

		expect(await response.text()).toBe("ok");
		expect(fetchImpl).toHaveBeenNthCalledWith(
			2,
			"https://api.example.com/next",
			expect.objectContaining({ redirect: "manual" }),
		);
	});

	it("blocks redirects to private hosts", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: "http://169.254.169.254/latest/meta-data" },
				}),
		);

		await expect(
			fetchWithOutboundPolicy(
				"https://api.example.com/start",
				{},
				{
					fetchImpl: fetchImpl as unknown as typeof fetch,
					policy: { skipDnsResolution: true },
				},
			),
		).rejects.toMatchObject({ code: "disallowed_host" });
	});
});
