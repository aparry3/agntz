// ═══════════════════════════════════════════════════════════════════════
// AES-256-GCM secret encryption.
//
// Used by the SecretStore implementations in @agntz/store-sqlite and
// @agntz/store-postgres. The master key is read lazily on first use from
// the AGNTZ_SECRET_KEY environment variable so tests can set it in
// beforeEach without import-order shenanigans.
//
// Encoding: `base64(iv):base64(authTag):base64(ciphertext)`.
// IV is 12 bytes (GCM standard) from randomBytes(12).
// ═══════════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const KEY_BYTES = 32; // AES-256

let cachedKey: Buffer | null = null;

function loadMasterKey(): Buffer {
	if (cachedKey) return cachedKey;

	const raw = process.env.AGNTZ_SECRET_KEY;
	if (!raw) {
		throw new Error(
			"AGNTZ_SECRET_KEY must be a 32-byte key encoded as 64 hex chars or 44 base64 chars.",
		);
	}

	let buf: Buffer | null = null;

	// Try hex (64 chars).
	if (/^[0-9a-fA-F]{64}$/.test(raw)) {
		buf = Buffer.from(raw, "hex");
	} else {
		// Try base64. 32 bytes encodes to 44 base64 chars (with `=` padding).
		try {
			const decoded = Buffer.from(raw, "base64");
			if (decoded.length === KEY_BYTES) {
				buf = decoded;
			}
		} catch {
			// fall through to reject
		}
	}

	if (!buf || buf.length !== KEY_BYTES) {
		throw new Error(
			"AGNTZ_SECRET_KEY must be a 32-byte key encoded as 64 hex chars or 44 base64 chars.",
		);
	}

	cachedKey = buf;
	return cachedKey;
}

/**
 * Reset the cached master key. For tests only.
 * @internal
 */
export function _resetCryptoKeyCache(): void {
	cachedKey = null;
}

/**
 * Encrypt a plaintext secret using AES-256-GCM.
 *
 * @param plaintext UTF-8 plaintext to encrypt.
 * @returns `base64(iv):base64(authTag):base64(ciphertext)`.
 */
export function encryptSecret(plaintext: string): string {
	const key = loadMasterKey();
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypt a previously-encrypted secret.
 *
 * @param ciphertext Output of {@link encryptSecret}.
 * @returns The original UTF-8 plaintext.
 * @throws If the master key is wrong, the auth tag is invalid, or the
 *         encoding is malformed.
 */
export function decryptSecret(ciphertext: string): string {
	const key = loadMasterKey();
	const parts = ciphertext.split(":");
	if (parts.length !== 3) {
		throw new Error("decryptSecret: malformed ciphertext (expected iv:tag:ct)");
	}
	const [ivB64, tagB64, ctB64] = parts;
	const iv = Buffer.from(ivB64, "base64");
	const tag = Buffer.from(tagB64, "base64");
	const ct = Buffer.from(ctB64, "base64");
	if (iv.length !== IV_BYTES) {
		throw new Error(`decryptSecret: invalid IV length (expected ${IV_BYTES})`);
	}
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
	return plaintext.toString("utf8");
}

/**
 * Return the last 4 characters of the plaintext for masked-UI display
 * (e.g. `••••5678`). If the plaintext is shorter than 4 chars, return it
 * as-is — masking shorter values isn't useful and would be misleading.
 */
export function getLastFour(plaintext: string): string {
	if (plaintext.length <= 4) return plaintext;
	return plaintext.slice(-4);
}
