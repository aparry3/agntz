import { createHmac, timingSafeEqual } from "node:crypto";

export interface InternalAuthClaims {
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

/**
 * Sign an internal-auth token (HMAC-SHA256), symmetric with
 * `verifyInternalAuthToken`. Mirrors the app's `signWorkerIdentity`; exposed for
 * worker-side signing and tests. `iat`/`exp` default to a 60-second window.
 */
export function signInternalAuthToken(
	claims: {
		actorUserId: string;
		tenantId: string;
		orgId?: string;
		orgSlug?: string;
		orgRole?: string;
		roles?: string[];
		permissions?: string[];
		authMethod?: "clerk";
		iat?: number;
		exp?: number;
	},
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): string {
	const full: InternalAuthClaims = {
		v: 1,
		actorUserId: claims.actorUserId,
		tenantId: claims.tenantId,
		...(claims.orgId ? { orgId: claims.orgId } : {}),
		...(claims.orgSlug ? { orgSlug: claims.orgSlug } : {}),
		...(claims.orgRole ? { orgRole: claims.orgRole } : {}),
		roles: claims.roles ?? [],
		permissions: claims.permissions ?? [],
		authMethod: claims.authMethod ?? "clerk",
		iat: claims.iat ?? nowSeconds,
		exp: claims.exp ?? nowSeconds + 60,
	};
	const payload = Buffer.from(JSON.stringify(full), "utf8").toString(
		"base64url",
	);
	const sig = createHmac("sha256", secret).update(payload).digest("base64url");
	return `${payload}.${sig}`;
}

export function verifyInternalAuthToken(
	token: string,
	secret: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): InternalAuthClaims | null {
	const [payload, signature] = token.split(".");
	if (!payload || !signature) return null;

	const expected = createHmac("sha256", secret)
		.update(payload)
		.digest("base64url");
	if (!safeEqual(signature, expected)) return null;

	const claims = parseClaims(payload);
	if (!claims) return null;
	if (claims.v !== 1) return null;
	if (!claims.actorUserId || !claims.tenantId) return null;
	if (!Array.isArray(claims.roles) || !Array.isArray(claims.permissions)) {
		return null;
	}
	if (claims.exp < nowSeconds || claims.iat > nowSeconds + 60) return null;
	return claims;
}

function parseClaims(payload: string): InternalAuthClaims | null {
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}
