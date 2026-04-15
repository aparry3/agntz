import { readFileTool } from "./read-file.js";
import { validateManifestTool } from "./validate-manifest.js";

/**
 * Every tool registered with the worker's runner. Used by routes.ts to
 * register them and exported so other packages (e.g. the app) can know which
 * local tool names are available when validating manifests.
 */
export const LOCAL_TOOLS = [readFileTool, validateManifestTool] as const;

export const LOCAL_TOOL_NAMES: string[] = LOCAL_TOOLS.map((t) => t.name);
