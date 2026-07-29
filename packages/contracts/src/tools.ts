import type { CallbackToolEntry } from "./callback-tool.js";
import type { ClientToolEntry } from "./client-tool.js";
import type { HTTPToolEntry } from "./http-tool.js";

/**
 * A tool a skill or agent can register. Discriminated by `type`:
 * `inline` (a registered tool by name), `mcp` (tools from an MCP server),
 * `agent` (invoke another agent as a tool), or `http` (a declarative HTTP
 * endpoint).
 */
export type ToolReference =
	| { type: "inline"; name: string }
	| {
			type: "mcp";
			server: string;
			tools?: string[];
			headers?: Record<string, string>;
	  }
	| { type: "agent"; agentId: string }
	| { type: "http"; entry: HTTPToolEntry }
	| { type: "callback"; entry: CallbackToolEntry }
	| { type: "client"; entry: ClientToolEntry };

/**
 * A reusable skill: instructions plus optional tools, loaded on demand by the
 * runner's synthetic `use_skill` tool when the LLM requests it.
 */
export interface SkillDefinition {
	/** lowercase-kebab-case; unique per user; identifier */
	name: string;
	/** Surfaced to the LLM via the system prompt's "Available skills" section. */
	description: string;
	/** Returned as the use_skill tool result when the LLM loads the skill. */
	instructions: string;
	/** Tools registered into the live tool registry when the skill is loaded. */
	tools?: ToolReference[];
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}
