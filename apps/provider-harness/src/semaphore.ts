export class Semaphore {
	private waiting: Array<() => void> = [];
	private active = 0;

	constructor(private readonly limit: number) {
		if (limit < 1)
			throw new Error(`Semaphore limit must be >= 1, got ${limit}`);
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}

	private async acquire(): Promise<void> {
		if (this.active < this.limit) {
			this.active++;
			return;
		}
		await new Promise<void>((resolve) => this.waiting.push(resolve));
	}

	private release(): void {
		const next = this.waiting.shift();
		if (next) {
			next();
		} else {
			this.active--;
		}
	}
}
