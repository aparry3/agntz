/**
 * AES-256-GCM secret encryption now lives in `@agntz/contracts` (the store
 * adapters use it). Re-exported here so core's public surface and internal
 * imports are unchanged.
 */
export {
	_resetCryptoKeyCache,
	decryptSecret,
	encryptSecret,
	getLastFour,
} from "@agntz/contracts";
