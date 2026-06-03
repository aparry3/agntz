import { classify, isMissingCredentials } from "./bucket.js";
import { envVarFor, hasCredentials } from "./credentials.js";
import { Semaphore } from "./semaphore.js";
import { compareSnapshot } from "./snapshot.js";
import type {
	HarnessSdk,
	Provider,
	ProviderAdapter,
	ProviderModelEntry,
	TestDefinition,
	TestResult,
} from "./types.js";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_PROVIDER_CONCURRENCY = 4;
export const DEFAULT_PROVIDER_START_INTERVAL_MS: Partial<
	Record<Provider, number>
> = {
	cohere: 8_000,
};

export interface RunOptions {
	matrix: readonly ProviderModelEntry[];
	tests: readonly TestDefinition[];
	adapters: readonly ProviderAdapter[];
	globalConcurrency?: number;
	providerConcurrency?: number;
	providerStartIntervalMs?: Partial<Record<Provider, number>>;
	defaultTimeoutMs?: number;
	updateSnapshots?: boolean;
}

export async function runMatrix(opts: RunOptions): Promise<TestResult[]> {
	const concurrency = opts.providerConcurrency ?? DEFAULT_PROVIDER_CONCURRENCY;
	const defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
	const updateSnapshots = opts.updateSnapshots ?? false;
	const globalSemaphore =
		opts.globalConcurrency !== undefined
			? new Semaphore(opts.globalConcurrency)
			: undefined;
	const providerStartIntervalMs = {
		...DEFAULT_PROVIDER_START_INTERVAL_MS,
		...opts.providerStartIntervalMs,
	};

	const semaphores = new Map<string, Semaphore>();
	const semaphoreFor = (provider: string): Semaphore => {
		let s = semaphores.get(provider);
		if (!s) {
			s = new Semaphore(concurrency);
			semaphores.set(provider, s);
		}
		return s;
	};

	const pacers = new Map<Provider, StartPacer>();
	const pacerFor = (provider: Provider): StartPacer | undefined => {
		const intervalMs = providerStartIntervalMs[provider] ?? 0;
		if (intervalMs < 1) return undefined;
		let pacer = pacers.get(provider);
		if (!pacer) {
			pacer = new StartPacer(intervalMs);
			pacers.set(provider, pacer);
		}
		return pacer;
	};

	const tasks: Array<Promise<TestResult>> = [];
	for (const adapter of opts.adapters) {
		for (const entry of opts.matrix) {
			for (const test of opts.tests) {
				tasks.push(
					runOne(
						adapter,
						entry,
						test,
						semaphoreFor(`${adapter.sdk}:${entry.provider}`),
						globalSemaphore,
						pacerFor(entry.provider),
						defaultTimeoutMs,
						updateSnapshots,
					),
				);
			}
		}
	}
	return Promise.all(tasks);
}

async function runOne(
	adapter: ProviderAdapter,
	model: ProviderModelEntry,
	test: TestDefinition,
	semaphore: Semaphore,
	globalSemaphore: Semaphore | undefined,
	pacer: StartPacer | undefined,
	defaultTimeoutMs: number,
	updateSnapshots: boolean,
): Promise<TestResult> {
	const base = {
		sdk: adapter.sdk as HarnessSdk,
		test: test.id,
		provider: model.provider,
		model: model.model,
	} as const;

	// Preflight: skip providers without credentials before spending a call or a
	// semaphore slot. Streaming auth failures surface as a generic
	// NoOutputGeneratedError that can't be distinguished from a real empty
	// stream, so catching this up front (per plan §11 #4) is the clean path.
	if (!hasCredentials(model.provider)) {
		return {
			...base,
			bucket: "SKIPPED",
			durationMs: 0,
			skipReason: `no ${envVarFor(model.provider)} in environment`,
		};
	}

	const runBody = async (): Promise<TestResult> => {
		const timeoutMs = test.timeoutMs ?? defaultTimeoutMs;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
		const start = Date.now();

		try {
			const output = await test.run(model, {
				sdk: adapter.sdk,
				adapter,
				abortSignal: controller.signal,
			});
			const durationMs = Date.now() - start;

			if (output.skip) {
				return {
					...base,
					bucket: "SKIPPED",
					durationMs,
					skipReason: output.skip,
				};
			}

			const capabilitySupported = hasCapability(
				adapter.sdk,
				model,
				test.capability,
			);

			if (output.ok) {
				if (output.snapshot !== undefined) {
					const snap = await compareSnapshot({
						sdk: adapter.sdk,
						testId: test.id,
						provider: model.provider,
						model: model.model,
						value: output.snapshot,
						update: updateSnapshots,
					});
					if (snap.kind === "mismatch") {
						return {
							...base,
							bucket: "SDK_ERROR",
							durationMs,
							error: {
								name: "SnapshotMismatch",
								message: `structural snapshot drift for ${test.id} (${snap.path})`,
							},
							snapshotDiff: snap.diff,
						};
					}
				}
				return {
					...base,
					bucket: classify({ capabilitySupported, outcome: { kind: "pass" } }),
					durationMs,
				};
			}
			return {
				...base,
				bucket: classify({
					capabilitySupported,
					outcome: {
						kind: "assertion-failed",
						reason: output.reason ?? "unknown",
					},
				}),
				durationMs,
				error: {
					name: "AssertionFailed",
					message: output.reason ?? "test returned ok:false",
				},
			};
		} catch (err) {
			const durationMs = Date.now() - start;
			const error = err instanceof Error ? err : new Error(String(err));

			if (controller.signal.aborted) {
				return {
					...base,
					bucket: "TIMEOUT",
					durationMs,
				};
			}

			if (isMissingCredentials(error)) {
				return {
					...base,
					bucket: "SKIPPED",
					durationMs,
					skipReason: `missing credentials (${error.message})`,
				};
			}

			const capabilitySupported = hasCapability(
				adapter.sdk,
				model,
				test.capability,
			);
			return {
				...base,
				bucket: classify({
					capabilitySupported,
					outcome: { kind: "thrown", error },
				}),
				durationMs,
				error: { name: error.name, message: error.message, stack: error.stack },
			};
		} finally {
			clearTimeout(timer);
		}
	};

	return semaphore.run(() =>
		pacer
			? pacer.run(() =>
					globalSemaphore ? globalSemaphore.run(runBody) : runBody(),
				)
			: globalSemaphore
				? globalSemaphore.run(runBody)
				: runBody(),
	);
}

class StartPacer {
	private readonly lock = new Semaphore(1);
	private lastStartAt = 0;

	constructor(private readonly intervalMs: number) {}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.lock.run(async () => {
			const waitMs = this.intervalMs - (Date.now() - this.lastStartAt);
			if (waitMs > 0) {
				await sleep(waitMs);
			}
			this.lastStartAt = Date.now();
		});
		return fn();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasCapability(
	sdk: HarnessSdk,
	model: ProviderModelEntry,
	capability: TestDefinition["capability"],
): boolean {
	return (
		model.sdkCapabilities?.[sdk]?.has(capability) ??
		model.capabilities.has(capability)
	);
}
