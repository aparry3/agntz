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
