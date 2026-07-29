import type { ResultBucket, TestResult } from "./types.js";

export const REGRESSION_BUCKETS: ReadonlySet<ResultBucket> = new Set([
	"SDK_ERROR",
	"UNEXPECTED_UNSUPPORTED",
	"TIMEOUT",
]);

export function isRegression(result: TestResult): boolean {
	return REGRESSION_BUCKETS.has(result.bucket);
}
