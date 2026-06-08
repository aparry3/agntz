// Types
export type {
	AgentKind,
	AgentManifest,
	AgentManifestBase,
	LLMAgentManifest,
	ToolAgentManifest,
	SequentialAgentManifest,
	ParallelAgentManifest,
	StepRef,
	InputSchema,
	PropertyDef,
	PropertyDefExpanded,
	OutputSchema,
	OutputMapping,
	ModelConfig,
	Example,
	ManifestToolEntry,
	MCPToolEntry,
	MCPToolRef,
	WrappedToolRef,
	LocalToolEntry,
	AgentToolEntry,
	HTTPToolEntry,
	ToolCallConfig,
	AgentRef,
	AgentState,
	ExecutionContext,
	ExecutionResult,
} from "./types.js";

// Parser
export { parseManifest, normalizeManifest } from "./parser.js";

// Template engine
export {
	renderTemplate,
	interpolate,
	resolvePath,
	isTruthy,
} from "./template.js";

// State management
export {
	normalizeId,
	getStateKey,
	isRefStep,
	createInitialState,
	applyInputTransform,
	applyOutputMapping,
} from "./state.js";

// Conditions
export { evaluateCondition } from "./conditions.js";

// Executor
export { execute, executeWithState } from "./executor.js";

// Validation
export type {
	ValidationResult,
	ValidationError,
	ValidationWarning,
	ValidationContext,
} from "./validate.js";
export { validateManifest, validateManifestFull } from "./validate.js";

// Skill parsing & validation
export {
	parseSkill,
	normalizeSkill,
	manifestEntryToToolReferences,
} from "./skill-parser.js";
export { validateSkill, validateSkillFull } from "./skill-validate.js";
export type { SkillValidationContext } from "./skill-validate.js";

// Tools
export type { ResolvedTool } from "./tools.js";
export {
	resolveToolEntries,
	buildToolParams,
	stripPinnedParams,
} from "./tools.js";

// HTTP tool URL parser + builder
export type { Placeholder } from "./http-url.js";
export { parseUrlPlaceholders, buildHttpUrl } from "./http-url.js";

// Manifest selection helpers
export type {
	ManifestPath,
	ManifestSelection,
	SelectedManifestBlock,
} from "./selection.js";
export {
	getAtPath,
	selectionKey,
	selectManifestBlock,
	findSelectionsByAgentId,
} from "./selection.js";
