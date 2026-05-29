import { describe, expect, it } from "vitest";
import { MemrezScopeError, createMemrez } from "../src/index.js";
import type {
	CurateOp,
	MemrezReasoner,
	TaggerInput,
	TaggerResult,
} from "../src/index.js";

class FakeReasoner implements MemrezReasoner {
	public tagCalls: TaggerInput[] = [];
	public nextCurateOps: CurateOp[] = [];

	async tag(input: TaggerInput): Promise<TaggerResult> {
		this.tagCalls.push(input);
		const directive = parseDirective(input.content);
		return {
			namespace: directive.namespace ?? input.grants[0],
			topics: directive.topics ?? input.topicsHint ?? ["general"],
			type: directive.type ?? "fact",
			normalizedContent: directive.content,
			duplicateOf: directive.duplicateOf,
		};
	}

	async curate(): Promise<CurateOp[]> {
		return this.nextCurateOps;
	}
}

describe("memrez core", () => {
	it("writes tagged facts and scans visible topics", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({ reasoner });

		const result = await memrez.write(
			["app/user/u_123"],
			"topic:billing,prefs|Prefers email receipts.",
		);
		const scan = await memrez.scan(["app/user/u_123"]);

		expect(result.action).toBe("appended");
		expect(result.entry).toMatchObject({
			scope: "app/user/u_123",
			content: "Prefers email receipts.",
			topics: ["billing", "prefs"],
			status: "active",
		});
		expect(scan.topics.map((topic) => [topic.topic, topic.count])).toEqual([
			["billing", 1],
			["prefs", 1],
		]);
	});

	it("reads ancestor scopes but not siblings", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({ reasoner });

		await memrez.write(["app"], "scope:app|topic:shared|Global rule.");
		await memrez.write(["app/user/u_123"], "topic:prefs|User 123 preference.");
		await memrez.write(["app/user/u_456"], "topic:prefs|User 456 preference.");

		const shared = await memrez.read(["app/user/u_123"], "shared");
		const prefs = await memrez.read(["app/user/u_123"], "prefs");

		expect(shared.map((entry) => entry.content)).toEqual(["Global rule."]);
		expect(prefs.map((entry) => entry.content)).toEqual([
			"User 123 preference.",
		]);
	});

	it("allows descendant writes by default and rejects siblings or ancestors", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({ reasoner });

		const child = await memrez.write(
			["app/user/u_123"],
			"scope:app/user/u_123/session/s_1|topic:session|Session fact.",
		);
		expect(child.entry.scope).toBe("app/user/u_123/session/s_1");

		await expect(
			memrez.write(
				["app/user/u_123"],
				"scope:app/user/u_456|topic:prefs|Bad sibling.",
			),
		).rejects.toBeInstanceOf(MemrezScopeError);
		await expect(
			memrez.write(
				["app/user/u_123"],
				"scope:app/user|topic:prefs|Bad ancestor.",
			),
		).rejects.toBeInstanceOf(MemrezScopeError);
	});

	it("allows exact ancestor writes only when promotion is configured", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({ reasoner });

		await expect(
			memrez.write(
				["sales/org/acme/account/a_789"],
				"scope:sales/org/acme|topic:rules|Generalized rule.",
				{ writePolicy: { ancestorPromotion: "ancestors" } },
			),
		).resolves.toMatchObject({ entry: { scope: "sales/org/acme" } });

		await expect(
			memrez.write(
				["sales/org/acme/account/a_789"],
				"scope:sales/org/acme/account/a_790|topic:rules|Sibling account rule.",
				{ writePolicy: { ancestorPromotion: "ancestors" } },
			),
		).rejects.toBeInstanceOf(MemrezScopeError);
	});

	it("rejects broad grants that cover protected private namespace branches", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({
			reasoner,
			namespacePolicy: {
				protectedNamespaces: [{ namespace: "gymtext/private/users" }],
			},
		});

		await expect(
			memrez.write(["gymtext"], "topic:prefs|Bad broad root."),
		).rejects.toThrow(/protected namespace/);
		await expect(
			memrez.write(
				["gymtext/private/users"],
				"topic:prefs|Bad all-users grant.",
			),
		).rejects.toThrow(/protected namespace/);

		await expect(
			memrez.write(
				["gymtext/private/users/u_123"],
				"topic:prefs|User-specific memory.",
			),
		).resolves.toMatchObject({
			action: "appended",
			entry: { scope: "gymtext/private/users/u_123" },
		});
	});

	it("dedupes exact active entries in the same scope", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({ reasoner });

		const first = await memrez.write(
			["app/user/u_123"],
			"topic:prefs|Prefers metric.",
		);
		const second = await memrez.write(
			["app/user/u_123"],
			"topic:prefs|Prefers metric.",
		);

		expect(second.action).toBe("deduped");
		expect(second.entry.id).toBe(first.entry.id);
	});

	it("applies curator supersede and topic blurb operations", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({ reasoner });

		const oldA = await memrez.write(
			["app/user/u_123"],
			"topic:prefs|Likes SMS.",
		);
		const oldB = await memrez.write(
			["app/user/u_123"],
			"topic:prefs|Prefers email.",
		);
		reasoner.nextCurateOps = [
			{
				type: "supersede",
				ids: [oldA.entry.id, oldB.entry.id],
				replacement: {
					namespace: "app/user/u_123",
					content: "Prefers email over SMS.",
					topics: ["prefs"],
				},
			},
			{
				type: "setBlurb",
				scope: "app/user/u_123",
				topic: "prefs",
				blurb: "Communication preferences.",
			},
		];

		const report = await memrez.curate(["app/user/u_123"]);
		const entries = await memrez.read(["app/user/u_123"], "prefs");
		const scan = await memrez.scan(["app/user/u_123"]);

		expect(report).toEqual({
			scanned: 2,
			superseded: 2,
			created: 1,
			blurbsUpdated: 1,
		});
		expect(entries.map((entry) => entry.content)).toEqual([
			"Prefers email over SMS.",
		]);
		expect(scan.topics[0]).toMatchObject({
			topic: "prefs",
			count: 1,
			blurb: "Communication preferences.",
		});
	});
});

function parseDirective(raw: string): {
	namespace?: string;
	topics?: string[];
	content: string;
	type?: TaggerResult["type"];
	duplicateOf?: string;
} {
	const parts = raw.split("|");
	const out: ReturnType<typeof parseDirective> = {
		content: parts.at(-1)?.trim() ?? raw,
	};
	for (const part of parts.slice(0, -1)) {
		const [key, value] = part.split(":");
		if (key === "scope") out.namespace = value;
		if (key === "topic")
			out.topics = value.split(",").map((topic) => topic.trim());
		if (key === "type") out.type = value as TaggerResult["type"];
		if (key === "dup") out.duplicateOf = value;
	}
	return out;
}
