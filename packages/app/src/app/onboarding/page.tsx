import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CreateOrganization } from "@clerk/nextjs";

/**
 * Onboarding gate. After sign-up, Clerk's session has no orgId until the user
 * creates one (we hidePersonal in the OrganizationSwitcher). This page hosts
 * the create-org flow, then bounces to /agents.
 */
export default async function OnboardingPage() {
  const { orgId } = await auth();
  if (orgId) redirect("/agents");

  return (
    <div className="mx-auto max-w-xl py-10">
      <h1 className="mb-2 text-2xl font-semibold text-zinc-950">Create your first workspace</h1>
      <p className="mb-6 text-sm text-zinc-600">
        A workspace groups your agents, sessions, and API keys. You can create more later
        (e.g. one per app you integrate).
      </p>
      <CreateOrganization afterCreateOrganizationUrl="/agents" />
    </div>
  );
}
