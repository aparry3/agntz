import { describe, expect, it, vi } from "vitest";

// Mock the http-tool builder so we can assert exactly what the bridge forwards
// (the worker used to drop auth/body/body_type + token deps). `vi.hoisted`
// keeps the mock fn referenceable from the hoisted `vi.mock` factory.
const { buildHttpToolDefinition } = vi.hoisted(() => ({
	buildHttpToolDefinition: vi.fn(() => ({
		name: "http__mock",
		description: "",
		input: {},
		execute: vi.fn(async () => ({ ok: true })),
	})),
}));
vi.mock("../src/http-tool.js", () => ({ buildHttpToolDefinition }));

import { createManifestExecutionContext } from "../src/manifest-execution-context.js";
import type {
	AgentState,
	LLMAgentManifest,
	ToolCallConfig,
} from "../src/manifest/index.js";
import type { Runner } from "../src/runner.js";
import type { ToolContext, ToolDefinition } from "../src/types.js";

function llm(extras: Partial<LLMAgentManifest> = {}): LLMAgentManifest {
	return {
		id: "step",
		kind: "llm",
		model: { provider: "openai", name: "gpt-5.4" },
		instruction: "be helpful",
		...extras,
	};
}

function st(obj: Record<string, unknown> = {}): AgentState {
	return obj as unknown as AgentState;
}

interface CapturedDef {
	id: string;
	systemPrompt?: string;
	userPromptTemplate?: string;
}

interface FakeOpts {
	invoke?: (
		id: string,
		input: string,
		opts: Record<string, unknown>,
	) => Promise<{ output: string; replies?: unknown[] }>;
	toolsExecute?: (name: string, params: unknown) => Promise<unknown>;
}

function fakeRunner(o: FakeOpts = {}) {
	const registered = new Map<string, CapturedDef>();
	const tokenResolver = { _: "resolver" };
	const tokenCache = { _: "cache" };
	const calls = {
		defs: [] as CapturedDef[],
		deregister: [] as string[],
		invoke: [] as {
			id: string;
			input: string;
			opts: Record<string, unknown>;
		}[],
		tools: [] as { name: string; params: unknown }[],
	};
	const runner = {
		tokenResolver,
		tokenCache,
		registerAgent(def: CapturedDef) {
			registered.set(def.id, def);
			calls.defs.push(def);
		},
		deregisterAgent(id: string) {
			calls.deregister.push(id);
			return registered.delete(id);
		},
		async invoke(id: string, input: string, opts: Record<string, unknown>) {
			calls.invoke.push({ id, input, opts });
			if (!registered.has(id))
				throw new Error(`invoke called before register: ${id}`);
			return o.invoke ? await o.invoke(id, input, opts) : { output: "ok" };
		},
		tools: {
			async execute(name: string, params: unknown) {
				calls.tools.push({ name, params });
				return o.toolsExecute
					? await o.toolsExecute(name, params)
					: { tool: name };
			},
		},
	};
	return {
		runner: runner as unknown as Runner,
		registered,
		calls,
		tokenResolver,
		tokenCache,
	};
}

describe("createManifestExecutionContext — resolveAgent", () => {
	it("delegates to the supplied strategy", async () => {
		const manifest = llm({ id: "abc" });
		const ctx = createManifestExecutionContext(fakeRunner().runner, {
			resolveAgent: async (id) => {
				expect(id).toBe("abc");
				return manifest;
			},
		});
		expect(await ctx.resolveAgent("abc")).toBe(manifest);
	});
});

describe("createManifestExecutionContext — invokeLLM", () => {
	it("registers a temp agent, invokes it, returns output, and cleans up", async () => {
		const { runner, registered, calls } = fakeRunner({
			invoke: async () => ({ output: "hello" }),
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});

		const out = await ctx.invokeLLM(
			llm(),
			"rendered",
			"hi",
			st({ userQuery: "hi" }),
		);

		expect(out).toBe("hello");
		expect(calls.defs).toHaveLength(1);
		expect(calls.invoke).toHaveLength(1);
		expect(calls.invoke[0].id).toBe(calls.defs[0].id);
		expect(calls.deregister).toEqual([calls.defs[0].id]);
		expect(registered.size).toBe(0);
	});

	it("bakes the rendered instruction into systemPrompt and clears userPromptTemplate", async () => {
		const { runner, calls } = fakeRunner();
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		await ctx.invokeLLM(llm({ prompt: "{{x}}" }), "RENDERED", "hi", st());
		expect(calls.defs[0].systemPrompt).toBe("RENDERED");
		expect(calls.defs[0].userPromptTemplate).toBeUndefined();
	});

	it("uses renderedPrompt as the user message when provided", async () => {
		const { runner, calls } = fakeRunner();
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		await ctx.invokeLLM(
			llm(),
			"instr",
			"the-prompt",
			st({ userQuery: "ignored" }),
		);
		expect(calls.invoke[0].input).toBe("the-prompt");
	});

	it("falls back to state.userQuery, then to JSON.stringify(state)", async () => {
		const a = fakeRunner();
		const ctxA = createManifestExecutionContext(a.runner, {
			resolveAgent: async () => llm(),
		});
		await ctxA.invokeLLM(
			llm(),
			"instr",
			undefined,
			st({ userQuery: "from-state" }),
		);
		expect(a.calls.invoke[0].input).toBe("from-state");

		const b = fakeRunner();
		const ctxB = createManifestExecutionContext(b.runner, {
			resolveAgent: async () => llm(),
		});
		await ctxB.invokeLLM(llm(), "instr", undefined, st({ foo: 1 }));
		expect(b.calls.invoke[0].input).toBe(JSON.stringify({ foo: 1 }));
	});

	it("parses JSON output when the manifest has an outputSchema", async () => {
		const { runner } = fakeRunner({
			invoke: async () => ({ output: '{"a":1}' }),
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		const out = await ctx.invokeLLM(
			llm({ outputSchema: { a: "number" } }),
			"i",
			"u",
			st(),
		);
		expect(out).toEqual({ a: 1 });
	});

	it("rejects raw text when schema output is not valid JSON", async () => {
		const { runner } = fakeRunner({
			invoke: async () => ({ output: "not json" }),
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		await expect(
			ctx.invokeLLM(llm({ outputSchema: { a: "number" } }), "i", "u", st()),
		).rejects.toMatchObject({ code: "STRUCTURED_OUTPUT_INVALID" });
	});

	it("does not parse output when there is no outputSchema", async () => {
		const { runner } = fakeRunner({
			invoke: async () => ({ output: '{"a":1}' }),
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		const out = await ctx.invokeLLM(llm(), "i", "u", st());
		expect(out).toBe('{"a":1}');
	});

	it("accumulates replies into replyCollector", async () => {
		const replyCollector: unknown[] = [];
		const { runner } = fakeRunner({
			invoke: async () => ({
				output: "ok",
				replies: [{ text: "r1" }, { text: "r2" }],
			}),
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
			replyCollector: replyCollector as never,
		});
		await ctx.invokeLLM(llm(), "i", "u", st());
		expect(replyCollector).toHaveLength(2);
	});

	it("runs beforeLLMInvoke before invoking", async () => {
		const order: string[] = [];
		const { runner } = fakeRunner({
			invoke: async () => {
				order.push("invoke");
				return { output: "ok" };
			},
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
			beforeLLMInvoke: async () => {
				order.push("before");
			},
		});
		await ctx.invokeLLM(llm(), "i", "u", st());
		expect(order).toEqual(["before", "invoke"]);
	});

	it("cleans up the temp agent even when invoke throws", async () => {
		const { runner, registered, calls } = fakeRunner({
			invoke: async () => {
				throw new Error("boom");
			},
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		await expect(ctx.invokeLLM(llm(), "i", "u", st())).rejects.toThrow("boom");
		expect(calls.deregister).toHaveLength(1);
		expect(registered.size).toBe(0);
	});

	it("uses a custom cleanupTempAgent instead of deregisterAgent", async () => {
		const cleaned: string[] = [];
		const { runner, calls } = fakeRunner();
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
			cleanupTempAgent: async (_r, id) => {
				cleaned.push(id);
			},
		});
		await ctx.invokeLLM(llm(), "i", "u", st());
		expect(cleaned).toHaveLength(1);
		expect(cleaned[0]).toMatch(/^__manifest_step_/);
		expect(calls.deregister).toHaveLength(0);
	});

	it("threads only the runtime values that are set into runner.invoke", async () => {
		const bare = fakeRunner();
		const ctxBare = createManifestExecutionContext(bare.runner, {
			resolveAgent: async () => llm(),
			userId: "u1",
			sessionId: "s1",
		});
		await ctxBare.invokeLLM(llm(), "i", "u", st());
		const optsBare = bare.calls.invoke[0].opts;
		expect(optsBare.userId).toBe("u1");
		expect(optsBare.sessionId).toBe("s1");
		expect("signal" in optsBare).toBe(false);
		expect("runRegistry" in optsBare).toBe(false);
		expect("ownerId" in optsBare).toBe(false);

		const full = fakeRunner();
		const registry = {} as never;
		const signal = new AbortController().signal;
		const ctxFull = createManifestExecutionContext(full.runner, {
			resolveAgent: async () => llm(),
			runRegistry: registry,
			parentRunId: "parent-1",
			ownerId: "owner-1",
			signal,
		});
		await ctxFull.invokeLLM(llm(), "i", "u", st());
		const optsFull = full.calls.invoke[0].opts;
		expect(optsFull.runRegistry).toBe(registry);
		expect(optsFull.parentRunId).toBe("parent-1");
		expect(optsFull.ownerId).toBe("owner-1");
		expect(optsFull.signal).toBe(signal);
	});
});

describe("createManifestExecutionContext — invokeTool", () => {
	function localTool(name: string, exec: ToolDefinition["execute"]) {
		return new Map<string, ToolDefinition>([
			[name, { name, description: "", input: {}, execute: exec } as never],
		]);
	}

	it("dispatches a local step through the in-process tool map with a ToolContext", async () => {
		const { runner } = fakeRunner();
		const exec = vi.fn(async () => "local-result");
		const toolCtx = { agentId: "x" } as unknown as ToolContext;
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
			localTools: localTool("calc", exec),
			toolContext: () => toolCtx,
		});
		const out = await ctx.invokeTool(
			{ kind: "local", name: "calc", params: { x: "1" } },
			st(),
		);
		expect(out).toBe("local-result");
		expect(exec).toHaveBeenCalledWith({ x: "1" }, toolCtx);
	});

	it("routes local steps through the runner registry when no localTools map is given (worker)", async () => {
		const { runner, calls } = fakeRunner({
			toolsExecute: async () => "registry-result",
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		const out = await ctx.invokeTool(
			{ kind: "local", name: "unknown", params: { a: "b" } },
			st(),
		);
		expect(out).toBe("registry-result");
		expect(calls.tools[0]).toEqual({ name: "unknown", params: { a: "b" } });
	});

	it("throws for an unregistered local tool when a localTools map is given (embedded)", async () => {
		const { runner, calls } = fakeRunner();
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
			localTools: localTool("calc", vi.fn()),
			toolContext: () => ({ agentId: "x" }) as unknown as ToolContext,
		});
		await expect(
			ctx.invokeTool({ kind: "local", name: "missing" }, st()),
		).rejects.toThrow(/no handler was registered/);
		expect(calls.tools).toHaveLength(0);
	});

	it("namespaces mcp tool names with the server id", async () => {
		const { runner, calls } = fakeRunner({
			toolsExecute: async () => "mcp-result",
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		await ctx.invokeTool({ kind: "mcp", name: "search", server: "srv" }, st());
		await ctx.invokeTool({ kind: "mcp", name: "plain" }, st());
		expect(calls.tools[0].name).toBe("srv:search");
		expect(calls.tools[1].name).toBe("plain");
	});

	it("forwards the full http config (auth/body/body_type) + the runner token deps", async () => {
		buildHttpToolDefinition.mockClear();
		const { runner, tokenResolver, tokenCache } = fakeRunner();
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		const auth = { kind: "token_exchange" };
		const config = {
			kind: "http",
			name: "pay",
			url: "https://api.example.com/pay",
			method: "POST",
			body: { amount: 10 },
			body_type: "json",
			auth,
			headers: { "X-Trace": "1" },
			params: { id: "abc" },
		} as unknown as ToolCallConfig;

		const out = await ctx.invokeTool(config, st({ userQuery: "x" }));

		expect(out).toEqual({ ok: true });
		expect(buildHttpToolDefinition).toHaveBeenCalledTimes(1);
		const call = buildHttpToolDefinition.mock.calls[0] as unknown[];
		expect(call[0]).toMatchObject({
			kind: "http",
			name: "pay",
			url: "https://api.example.com/pay",
			method: "POST",
			body: { amount: 10 },
			body_type: "json",
			auth,
			headers: { "X-Trace": "1" },
			params: { id: "abc" },
		});
		expect(call[2]).toEqual({ tokenResolver, tokenCache });
	});

	it("throws when an http step is missing its url", async () => {
		const { runner } = fakeRunner();
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
		});
		await expect(
			ctx.invokeTool({ kind: "http", name: "x" }, st()),
		).rejects.toThrow(/missing 'url'/);
	});
});

describe("createManifestExecutionContext — hooks", () => {
	it("fires lifecycle hooks in order for llm and tool steps", async () => {
		const events: string[] = [];
		const { runner } = fakeRunner();
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
			hooks: {
				onLLMStart: () => events.push("llm:start"),
				onLLMDone: () => events.push("llm:done"),
				onToolStart: () => events.push("tool:start"),
				onToolDone: () => events.push("tool:done"),
			},
		});
		await ctx.invokeLLM(llm(), "i", "u", st());
		await ctx.invokeTool({ kind: "mcp", name: "t" }, st());
		expect(events).toEqual([
			"llm:start",
			"llm:done",
			"tool:start",
			"tool:done",
		]);
	});

	it("fires onLLMError when invoke throws", async () => {
		const errors: unknown[] = [];
		const { runner } = fakeRunner({
			invoke: async () => {
				throw new Error("kaboom");
			},
		});
		const ctx = createManifestExecutionContext(runner, {
			resolveAgent: async () => llm(),
			hooks: { onLLMError: ({ error }) => errors.push(error) },
		});
		await expect(ctx.invokeLLM(llm(), "i", "u", st())).rejects.toThrow(
			"kaboom",
		);
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("kaboom");
	});
});
