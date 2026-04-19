// Mirror of packages/worker/src/tools/registry.ts:LOCAL_TOOL_NAMES.
// Used at manifest-validation time so the app can recognize tool names
// the worker ships locally. Keep in sync when adding/removing worker tools.
export const LOCAL_TOOL_NAMES: string[] = ["read_file", "validate_manifest"];
