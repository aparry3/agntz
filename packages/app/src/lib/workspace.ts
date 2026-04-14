import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createRunner, type Runner, type UnifiedStore, type Workspace } from "@agent-runner/core";
import { getStore } from "./store";

/**
 * Resolve the active workspace for the current request.
 *
 * - Reads { userId, orgId } from Clerk's request session.
 * - Looks up our local workspace row by clerk_org_id, or lazy-creates it from
 *   the Clerk org name (covers cases where a webhook hasn't fired yet).
 * - Returns a workspace-scoped store + a Runner wired to that store.
 *
 * Throws if the user isn't authenticated or has no active organization.
 */
export interface WorkspaceContext {
  workspace: Workspace;
  store: UnifiedStore;
  runner: Runner;
}

export class WorkspaceRequiredError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requireWorkspaceContext(): Promise<WorkspaceContext> {
  const { userId, orgId } = await auth();
  if (!userId) throw new WorkspaceRequiredError("Not signed in", 401);
  if (!orgId) throw new WorkspaceRequiredError("No active workspace. Create or select one.", 400);

  const adminStore = await getStore();
  let workspace = await adminStore.getWorkspaceByClerkOrgId(orgId);

  if (!workspace) {
    // Lazy-create — webhook may not have fired yet.
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({ organizationId: orgId });
    workspace = await adminStore.createWorkspace({
      clerkOrgId: orgId,
      name: org.name ?? orgId,
    });
  }

  const store = adminStore.forWorkspace(workspace.id);
  const runner = createRunner({
    store,
    defaults: {
      model: {
        provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
        name: process.env.DEFAULT_MODEL_NAME ?? "gpt-4o",
      },
    },
  });

  return { workspace, store, runner };
}

/**
 * Wrap a route handler to inject WorkspaceContext and convert
 * WorkspaceRequiredError into a JSON error response.
 */
export function withWorkspace<T extends unknown[]>(
  handler: (ctx: WorkspaceContext, ...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      const ctx = await requireWorkspaceContext();
      return await handler(ctx, ...args);
    } catch (err) {
      if (err instanceof WorkspaceRequiredError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      return Response.json({ error: String(err) }, { status: 500 });
    }
  };
}
