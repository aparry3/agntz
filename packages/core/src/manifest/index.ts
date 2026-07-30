// Types
export type {
	AgentKind,
	AgentManifest,
	AgentManifestBase,
	LLMAgentManifest,
	ToolAgentManifest,
	SequentialAgentManifest,
	ParallelAgentManifest,
	TranscriptionAgentManifest,
	ImageAgentManifest,
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
	CallbackToolEntry,
	ClientToolEntry,
	ToolCallConfig,
	AgentRef,
	AgentState,
	ExecutionContext,
	ExecutionResult,
} from "./types.js";

// Parser
export { parseManifest, normalizeManifest } from "./parser.js";
export type { BatchManifest, BatchProvider } from "./batch.js";
export { BATCH_PROVIDERS, parseBatchManifest } from "./batch.js";

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

// Canonical JSON Schema helpers
export type { JsonSchema, ManifestSchema, SchemaIssue } from "./schema.js";
export {
	ManifestSchemaError,
	isCanonicalManifestSchema,
	manifestSchemaToJsonSchema,
	manifestSchemaPropertyNames,
	compileManifestSchema,
	assertManifestSchemaValue,
	validateManifestSchemaDefinition,
} from "./schema.js";

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
