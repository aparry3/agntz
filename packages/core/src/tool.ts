import type { ZodSchema } from "zod";
import type {
	ToolContext,
	ToolDefinition,
	ToolInfo,
	ToolReference,
} from "./types.js";
import { zodToJsonSchema } from "./utils/schema.js";

/**
 * Define a tool with type-safe input schema and execution function.
 */
export function defineTool<
	TCtx extends Record<string, unknown> = Record<string, unknown>,
>(definition: ToolDefinition<unknown, TCtx>): ToolDefinition<unknown, TCtx> {
	if (!definition.name) {
		throw new Error("Tool definition requires a 'name'");
	}
	if (!definition.description) {
		throw new Error("Tool definition requires a 'description'");
	}
	if (!definition.input) {
		throw new Error("Tool definition requires an 'input' schema");
	}
	if (!definition.execute) {
		throw new Error("Tool definition requires an 'execute' function");
	}
	return definition;
}

/**
 * In-memory tool registry. Single source of truth for all tools
 * regardless of source (inline, MCP, agent).
 */
export class ToolRegistry {
	private tools = new Map<
		string,
		{
			definition: ToolDefinition;
			info: ToolInfo;
		}
	>();

	/**
	 * Register an inline tool.
	 */
	register(tool: ToolDefinition): void {
		if (this.tools.has(tool.name)) {
			throw new Error(`Tool "${tool.name}" is already registered`);
		}

		const jsonSchema = zodToJsonSchema(tool.input);

		this.tools.set(tool.name, {
			definition: tool,
			info: {
				name: tool.name,
				description: tool.description,
				source: "inline",
				inputSchema: jsonSchema,
			},
		});
	}

	/**
	 * Register a tool from an MCP server (already has JSON Schema).
	 */
	registerMCP(
		serverName: string,
		toolInfo: {
			name: string;
			description: string;
			inputSchema: Record<string, unknown>;
			execute: (input: unknown) => Promise<unknown>;
		},
	): void {
		const fullName = toolInfo.name;

		this.tools.set(fullName, {
			definition: {
				name: fullName,
				description: toolInfo.description,
				input: {} as ZodSchema, // MCP tools use JSON Schema directly
				execute: async (input: unknown, _ctx: ToolContext) => {
					return toolInfo.execute(input);
				},
			},
			info: {
				name: fullName,
				description: toolInfo.description,
				source: `mcp:${serverName}`,
				inputSchema: toolInfo.inputSchema,
			},
		});
	}

	/**
	 * Get all registered tools as ToolInfo (serializable metadata).
	 */
	list(): ToolInfo[] {
		return Array.from(this.tools.values()).map((t) => t.info);
	}

	/**
	 * Get a specific tool's info.
	 */
	get(name: string): ToolInfo | undefined {
		return this.tools.get(name)?.info;
	}

	/**
	 * Get a tool's full definition (includes execute function).
	 */
	getDefinition(name: string): ToolDefinition | undefined {
		return this.tools.get(name)?.definition;
	}

	/**
	 * Execute a tool by name.
	 */
	async execute(
		name: string,
		input: unknown,
		ctx: ToolContext,
	): Promise<unknown> {
		const entry = this.tools.get(name);
		if (!entry) {
			throw new Error(`Tool "${name}" not found in registry`);
		}

		const validatedInput =
			entry.info.source === "inline" && entry.definition.input?.parse
				? entry.definition.input.parse(input)
				: input;

		return entry.definition.execute(validatedInput, ctx);
	}

	/**
	 * Check if a tool exists.
	 */
	has(name: string): boolean {
		return this.tools.has(name);
	}

	/**
	 * Get count of registered tools.
	 */
	get size(): number {
		return this.tools.size;
	}

	/**
	 * Resolve a list of ToolReferences into model-facing tool descriptors,
	 * connecting MCP servers and looking up agent-as-tool refs via the host
	 * runner's helpers. Idempotent: tools already present are reused (no
	 * "already registered" error). Used for mid-run skill tool loading.
	 */
	async registerToolReferences(
		refs: ToolReference[],
		helpers: {
			resolveAgentAsTool: (agentId: string) => {
				name: string;
				description: string;
				parameters: Record<string, unknown>;
			} | null;
			resolveMCPTools: (
				server: string,
				tools?: string[],
			) => Array<{
				name: string;
				description: string;
				parameters: Record<string, unknown>;
			}>;
			ensureMCPServerRegistered: (server: string) => Promise<void>;
		},
	): Promise<
		Array<{
			name: string;
			description: string;
			parameters: Record<string, unknown>;
		}>
	> {
		const mcpServers = Array.from(
			new Set(
				refs
					.filter(
						(r): r is Extract<ToolReference, { type: "mcp" }> =>
							r.type === "mcp",
					)
					.map((r) => r.server),
			),
		);
		for (const server of mcpServers) {
			await helpers.ensureMCPServerRegistered(server);
		}

		const resolved: Array<{
			name: string;
			description: string;
			parameters: Record<string, unknown>;
		}> = [];
		for (const ref of refs) {
			if (ref.type === "inline") {
				const info = this.get(ref.name);
				if (info) {
					resolved.push({
						name: info.name,
						description: info.description,
						parameters: info.inputSchema,
					});
				}
			} else if (ref.type === "agent") {
				const info = helpers.resolveAgentAsTool(ref.agentId);
				if (info) resolved.push(info);
			} else if (ref.type === "mcp") {
				const mcpTools = helpers.resolveMCPTools(ref.server, ref.tools);
				resolved.push(...mcpTools);
			}
		}
		return resolved;
	}
}
