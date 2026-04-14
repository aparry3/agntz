// The per-workspace Runner is constructed inside requireWorkspaceContext()
// (see workspace.ts). This file remains as a re-export point for legacy
// callers; new code should use workspace.ts.
export { requireWorkspaceContext, withWorkspace } from "./workspace";
