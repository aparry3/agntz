import { createHmac } from "node:crypto";

export interface WorkerIdentity {
	userId: string;
	actorUserId?: string;
	tenantId?: string;
	orgId?: string;
	orgSlug?: string;
	orgRole?: string;
	roles?: string[];
	permissions?: string[];
	authMethod?: "clerk";
}

interface InternalAuthClaims {
	v: 1;
	actorUserId: string;
	tenantId: string;
	orgId?: string;
	orgSlug?: string;
	orgRole?: string;
	roles: string[];
	permissions: string[];
	authMethod: "clerk";
	iat: number;
	exp: number;
}

export function signWorkerIdentity(
	identity: WorkerIdentity,
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): string {
	const tenantId = identity.tenantId ?? identity.userId;
	const claims: InternalAuthClaims = {
		v: 1,
		actorUserId: identity.actorUserId ?? identity.userId,
		tenantId,
		...(identity.orgId ? { orgId: identity.orgId } : {}),
		...(identity.orgSlug ? { orgSlug: identity.orgSlug } : {}),
		...(identity.orgRole ? { orgRole: identity.orgRole } : {}),
		roles: identity.roles ?? [],
		permissions: identity.permissions ?? [],
		authMethod: identity.authMethod ?? "clerk",
		iat: nowSeconds,
		exp: nowSeconds + 60,
	};
	const payload = base64url(JSON.stringify(claims));
	const sig = createHmac("sha256", secret).update(payload).digest("base64url");
	return `${payload}.${sig}`;
}

function base64url(input: string): string {
	return Buffer.from(input, "utf8").toString("base64url");
}
