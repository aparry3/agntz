import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRunner, defineAgent, defineTool } from "../src/index.js";
import { Telemetry } from "../src/telemetry.js";
import type {
	OTelSpan,
	OTelTracer,
	TelemetryConfig,
} from "../src/telemetry.js";

// ═══════════════════════════════════════════════════════════════════════
// Mock Tracer + Span for testing
// ═══════════════════════════════════════════════════════════════════════

function createMockSpan(name: string): OTelSpan & {
	_name: string;
	_attrs: Record<string, any>;
	_status: any;
	_ended: boolean;
	_exceptions: any[];
} {
	return {
		_name: name,
		_attrs: {},
		_status: null,
		_ended: false,
		_exceptions: [],
		setAttribute(key: string, value: string | number | boolean) {
			this._attrs[key] = value;
			return this;
		},
		setStatus(status: { code: number; message?: string }) {
			this._status = status;
			return this;
		},
		recordException(exception: Error | string) {
			this._exceptions.push(exception);
		},
		end() {
			this._ended = true;
		},
		spanContext() {
			return { traceId: "test-trace-id", spanId: `span-${name}` };
		},
	};
}

function createMockTracer(): OTelTracer & {
	spans: ReturnType<typeof createMockSpan>[];
} {
	const spans: ReturnType<typeof createMockSpan>[] = [];
	return {
		spans,
		startSpan(name: string, options?: any) {
			const span = createMockSpan(name);
			if (options?.attributes) {
				Object.assign(span._attrs, options.attributes);
			}
			spans.push(span);
			return span;
		},
	};
}

// Mock model provider
function createMockProvider(
	responses: Array<{ text: string; toolCalls?: any[] }> = [{ text: "Hello!" }],
) {
	let callIndex = 0;
	return {
		generateText: vi.fn(async () => {
			const response = responses[Math.min(callIndex++, responses.length - 1)];
			return {
				text: response.text,
				toolCalls: response.toolCalls ?? [],
				usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
				finishReason: "stop",
			};
		}),
	};
}

// ═══════════════════════════════════════════════════════════════════════
// Telemetry Unit Tests
// ═══════════════════════════════════════════════════════════════════════

describe("Telemetry class", () => {
	it("returns no-op spans when not configured", () => {
		const telemetry = new Telemetry();
		expect(telemetry.enabled).toBe(false);

		const span = telemetry.startInvoke({
			agentId: "test",
			invocationId: "inv_1",
			model: "openai/gpt-5.4",
		});

		// These should all be no-ops (no errors)
		span.setResult({
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			duration: 0,
			toolCallCount: 0,
			stepCount: 1,
		});
		span.end();
	});

	it("creates spans with a custom tracer", () => {
		const tracer = createMockTracer();
		const telemetry = new Telemetry({ tracer });
		expect(telemetry.enabled).toBe(true);

		const span = telemetry.startInvoke({
			agentId: "test-agent",
			invocationId: "inv_abc",
			model: "anthropic/claude-sonnet",
			sessionId: "sess_1",
			contextIds: ["ctx_a", "ctx_b"],
		});

		expect(tracer.spans).toHaveLength(1);
		expect(tracer.spans[0]._name).toBe("agent.invoke");
		expect(tracer.spans[0]._attrs["agent.id"]).toBe("test-agent");
		expect(tracer.spans[0]._attrs["agent.invocation.id"]).toBe("inv_abc");
		expect(tracer.spans[0]._attrs["agent.model"]).toBe(
			"anthropic/claude-sonnet",
		);
		expect(tracer.spans[0]._attrs["agent.session.id"]).toBe("sess_1");
		expect(tracer.spans[0]._attrs["agent.context.ids"]).toBe("ctx_a,ctx_b");

		span.end();
		expect(tracer.spans[0]._ended).toBe(true);
		expect(tracer.spans[0]._status.code).toBe(1); // OK
	});

	it("creates model call child spans", () => {
		const tracer = createMockTracer();
		const telemetry = new Telemetry({ tracer });

		const invokeSpan = telemetry.startInvoke({
			agentId: "test",
			invocationId: "inv_1",
			model: "openai/gpt-5.4",
		});

		const modelSpan = invokeSpan.modelCall({
			model: "openai/gpt-5.4",
			step: 1,
		});
		expect(tracer.spans).toHaveLength(2);
		expect(tracer.spans[1]._name).toBe("agent.model.call");
		expect(tracer.spans[1]._attrs["agent.model"]).toBe("openai/gpt-5.4");
		expect(tracer.spans[1]._attrs["agent.step"]).toBe(1);

		modelSpan.setResult({
			usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
			finishReason: "stop",
			toolCallCount: 0,
		});
		modelSpan.end();

		expect(tracer.spans[1]._attrs["agent.usage.total_tokens"]).toBe(150);
		expect(tracer.spans[1]._attrs["agent.finish_reason"]).toBe("stop");
		expect(tracer.spans[1]._ended).toBe(true);
	});

	it("creates tool call child spans", () => {
		const tracer = createMockTracer();
		const telemetry = new Telemetry({ tracer });

		const invokeSpan = telemetry.startInvoke({
			agentId: "test",
			invocationId: "inv_1",
			model: "openai/gpt-5.4",
		});

		const toolSpan = invokeSpan.toolCall({
			toolName: "lookup_order",
			toolCallId: "tc_1",
		});
		expect(tracer.spans).toHaveLength(2);
		expect(tracer.spans[1]._name).toBe("agent.tool.execute");
		expect(tracer.spans[1]._attrs["agent.tool.name"]).toBe("lookup_order");

		toolSpan.setResult({
			id: "tc_1",
			name: "lookup_order",
			input: { orderId: "123" },
			output: { order: { id: "123" } },
			duration: 42,
		});
		toolSpan.end();

		expect(tracer.spans[1]._attrs["agent.tool.duration_ms"]).toBe(42);
		expect(tracer.spans[1]._ended).toBe(true);
	});

	it("records errors on spans", () => {
		const tracer = createMockTracer();
		const telemetry = new Telemetry({ tracer });

		const invokeSpan = telemetry.startInvoke({
			agentId: "test",
			invocationId: "inv_1",
			model: "openai/gpt-5.4",
		});

		const error = new Error("Model API error");
		invokeSpan.error(error);

		expect(tracer.spans[0]._status.code).toBe(2); // ERROR
		expect(tracer.spans[0]._status.message).toBe("Model API error");
		expect(tracer.spans[0]._exceptions).toHaveLength(1);
		expect(tracer.spans[0]._ended).toBe(true);
	});

	it("does not record IO by default", () => {
		const tracer = createMockTracer();
		const telemetry = new Telemetry({ tracer });

		const span = telemetry.startInvoke({
			agentId: "test",
			invocationId: "inv_1",
			model: "openai/gpt-5.4",
			input: "sensitive user input",
		});

		span.setResult({
			output: "sensitive output",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			duration: 100,
			toolCallCount: 0,
			stepCount: 1,
		});

		// Input and output should NOT be in attributes (privacy default)
		expect(tracer.spans[0]._attrs["agent.input"]).toBeUndefined();
		expect(tracer.spans[0]._attrs["agent.output"]).toBeUndefined();
	});

	it("records IO when recordIO is true", () => {
		const tracer = createMockTracer();
		const telemetry = new Telemetry({ tracer, recordIO: true });

		const span = telemetry.startInvoke({
			agentId: "test",
			invocationId: "inv_1",
			model: "openai/gpt-5.4",
			input: "user input",
		});

		span.setResult({
			output: "agent output",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			duration: 100,
			toolCallCount: 0,
			stepCount: 1,
		});

		expect(tracer.spans[0]._attrs["agent.input"]).toBe("user input");
		expect(tracer.spans[0]._attrs["agent.output"]).toBe("agent output");
	});

	it("records tool IO when recordToolIO is true", () => {
		const tracer = createMockTracer();
		const telemetry = new Telemetry({ tracer, recordToolIO: true });

		const invokeSpan = telemetry.startInvoke({
			agentId: "test",
			invocationId: "inv_1",
			model: "openai/gpt-5.4",
		});

		const toolSpan = invokeSpan.toolCall({
			toolName: "my_tool",
			toolCallId: "tc_1",
		});
		toolSpan.setResult({
			id: "tc_1",
			name: "my_tool",
			input: { key: "value" },
			output: { result: "data" },
			duration: 10,
		});

		expect(tracer.spans[1]._attrs["agent.tool.input"]).toBe('{"key":"value"}');
		expect(tracer.spans[1]._attrs["agent.tool.output"]).toBe(
			'{"result":"data"}',
		);
	});

	it("includes baseAttributes on all spans", () => {
		const tracer = createMockTracer();
		const telemetry = new Telemetry({
			tracer,
			baseAttributes: { "service.name": "my-app", "deployment.env": "staging" },
		});

		telemetry.startInvoke({
			agentId: "test",
			invocationId: "inv_1",
			model: "openai/gpt-5.4",
		});

		expect(tracer.spans[0]._attrs["service.name"]).toBe("my-app");
		expect(tracer.spans[0]._attrs["deployment.env"]).toBe("staging");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Runner Integration Tests (telemetry in invoke)
// ═══════════════════════════════════════════════════════════════════════

describe("Runner with telemetry", () => {
	it("creates invocation spans on invoke()", async () => {
		const tracer = createMockTracer();
		const provider = createMockProvider();

		const runner = createRunner({
			modelProvider: provider,
			telemetry: { tracer },
		});

		runner.registerAgent(
			defineAgent({
				id: "greeter",
				name: "Greeter",
				systemPrompt: "You are a greeter.",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		);

		const result = await runner.invoke("greeter", "Hello!");

		expect(result.output).toBe("Hello!");

		// Should have invoke span + model call span
		expect(tracer.spans.length).toBeGreaterThanOrEqual(2);

		const invokeSpan = tracer.spans.find((s) => s._name === "agent.invoke");
		expect(invokeSpan).toBeDefined();
		expect(invokeSpan?._attrs["agent.id"]).toBe("greeter");
		expect(invokeSpan?._attrs["agent.model"]).toBe("openai/gpt-5.4");
		expect(invokeSpan?._attrs["agent.usage.total_tokens"]).toBe(15);
		expect(invokeSpan?._attrs["agent.step_count"]).toBe(1);
		expect(invokeSpan?._status.code).toBe(1); // OK
		expect(invokeSpan?._ended).toBe(true);

		const modelSpan = tracer.spans.find((s) => s._name === "agent.model.call");
		expect(modelSpan).toBeDefined();
		expect(modelSpan?._ended).toBe(true);
	});

	it("creates tool call spans when tools are invoked", async () => {
		const tracer = createMockTracer();
		const provider = createMockProvider([
			// First call: model requests a tool call
			{
				text: "",
				toolCalls: [{ id: "tc_1", name: "get_time", args: {} }],
			},
			// Second call: model returns final text
			{ text: "The time is 12:00 PM." },
		]);

		const getTime = defineTool({
			name: "get_time",
			description: "Get the current time",
			input: z.object({}),
			async execute() {
				return { time: "12:00 PM" };
			},
		});

		const runner = createRunner({
			modelProvider: provider,
			tools: [getTime],
			telemetry: { tracer },
		});

		runner.registerAgent(
			defineAgent({
				id: "assistant",
				name: "Assistant",
				systemPrompt: "You are helpful.",
				model: { provider: "openai", name: "gpt-5.4" },
				tools: [{ type: "inline", name: "get_time" }],
			}),
		);

		const result = await runner.invoke("assistant", "What time is it?");
		expect(result.output).toBe("The time is 12:00 PM.");

		// Should have: invoke span, 2x model call spans, 1x tool call span
		const invokeSpan = tracer.spans.find((s) => s._name === "agent.invoke");
		const modelSpans = tracer.spans.filter(
			(s) => s._name === "agent.model.call",
		);
		const toolSpans = tracer.spans.filter(
			(s) => s._name === "agent.tool.execute",
		);

		expect(invokeSpan).toBeDefined();
		expect(modelSpans).toHaveLength(2);
		expect(toolSpans).toHaveLength(1);

		expect(toolSpans[0]._attrs["agent.tool.name"]).toBe("get_time");
		expect(
			toolSpans[0]._attrs["agent.tool.duration_ms"],
		).toBeGreaterThanOrEqual(0);
		expect(toolSpans[0]._ended).toBe(true);

		// Invoke span should record total tool calls
		expect(invokeSpan?._attrs["agent.tool_call_count"]).toBe(1);
	});

	it("records error spans on invocation failure", async () => {
		const tracer = createMockTracer();
		const provider = {
			generateText: vi.fn(async () => {
				throw new Error("API rate limit exceeded");
			}),
		};

		const runner = createRunner({
			modelProvider: provider,
			telemetry: { tracer },
			retry: { maxRetries: 0 }, // No retries for test
		});

		runner.registerAgent(
			defineAgent({
				id: "failing",
				name: "Failing",
				systemPrompt: "You fail.",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		);

		await expect(runner.invoke("failing", "Hello")).rejects.toThrow(
			"API rate limit exceeded",
		);

		// Both invoke and model span should have error status
		const invokeSpan = tracer.spans.find((s) => s._name === "agent.invoke");
		const modelSpan = tracer.spans.find((s) => s._name === "agent.model.call");

		expect(invokeSpan?._status.code).toBe(2); // ERROR
		expect(invokeSpan?._ended).toBe(true);
		expect(modelSpan?._status.code).toBe(2); // ERROR
		expect(modelSpan?._ended).toBe(true);
	});

	it("works normally with no telemetry configured", async () => {
		const provider = createMockProvider();

		const runner = createRunner({
			modelProvider: provider,
			// No telemetry config
		});

		runner.registerAgent(
			defineAgent({
				id: "greeter",
				name: "Greeter",
				systemPrompt: "You are a greeter.",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		);

		const result = await runner.invoke("greeter", "Hello!");
		expect(result.output).toBe("Hello!");
	});

	it("records session and context IDs in span attributes", async () => {
		const tracer = createMockTracer();
		const provider = createMockProvider();

		const runner = createRunner({
			modelProvider: provider,
			telemetry: { tracer },
		});

		runner.registerAgent(
			defineAgent({
				id: "agent",
				name: "Agent",
				systemPrompt: "You are an agent.",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		);

		await runner.invoke("agent", "Hello", {
			sessionId: "sess_test",
			contextIds: ["users/1", "global/config"],
		});

		const invokeSpan = tracer.spans.find((s) => s._name === "agent.invoke");
		expect(invokeSpan?._attrs["agent.session.id"]).toBe("sess_test");
		expect(invokeSpan?._attrs["agent.context.ids"]).toBe(
			"users/1,global/config",
		);
	});
});
