import { describe, expect, it, vi } from "vitest";
import { defineAgent } from "../src/agent.js";
import { createRunner } from "../src/runner.js";

describe("Runner.shutdown()", () => {
	it("succeeds when no stores or MCP are configured", async () => {
		const runner = createRunner();
		await runner.shutdown(); // Should not throw
	});

	it("calls close() on stores that support it", async () => {
		const closeFn = vi.fn();
		const store = {
			// AgentStore
			getAgent: vi.fn().mockResolvedValue(null),
			listAgents: vi.fn().mockResolvedValue([]),
			putAgent: vi.fn().mockResolvedValue(undefined),
			deleteAgent: vi.fn().mockResolvedValue(undefined),
			// SessionStore
			getMessages: vi.fn().mockResolvedValue([]),
			append: vi.fn().mockResolvedValue(undefined),
			deleteSession: vi.fn().mockResolvedValue(undefined),
			listSessions: vi.fn().mockResolvedValue([]),
			// ContextStore
			getContext: vi.fn().mockResolvedValue([]),
			addContext: vi.fn().mockResolvedValue(undefined),
			clearContext: vi.fn().mockResolvedValue(undefined),
			// LogStore
			log: vi.fn().mockResolvedValue(undefined),
			getLogs: vi.fn().mockResolvedValue([]),
			getLog: vi.fn().mockResolvedValue(null),
			// close
			close: closeFn,
		};

		const runner = createRunner({ store });
		await runner.shutdown();

		// close() is called — but since all 4 store references point to the same object,
		// it's called 4 times (once per store slot). That's by design — close() should be idempotent.
		expect(closeFn).toHaveBeenCalled();
	});

	it("handles close() errors gracefully", async () => {
		const store = {
			getAgent: vi.fn().mockResolvedValue(null),
			listAgents: vi.fn().mockResolvedValue([]),
			putAgent: vi.fn().mockResolvedValue(undefined),
			deleteAgent: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockResolvedValue([]),
			append: vi.fn().mockResolvedValue(undefined),
			deleteSession: vi.fn().mockResolvedValue(undefined),
			listSessions: vi.fn().mockResolvedValue([]),
			getContext: vi.fn().mockResolvedValue([]),
			addContext: vi.fn().mockResolvedValue(undefined),
			clearContext: vi.fn().mockResolvedValue(undefined),
			log: vi.fn().mockResolvedValue(undefined),
			getLogs: vi.fn().mockResolvedValue([]),
			getLog: vi.fn().mockResolvedValue(null),
			close: vi.fn().mockRejectedValue(new Error("Close failed")),
		};

		const runner = createRunner({ store });
		// Should not throw even if close() throws
		await runner.shutdown();
	});

	it("is safe to call multiple times", async () => {
		const runner = createRunner();
		await runner.shutdown();
		await runner.shutdown(); // Should not throw
	});
});
