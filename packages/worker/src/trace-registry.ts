import type { Span, TraceStore, TraceSummary, TraceLiveEvent } from "@agntz/core";

export interface TraceRegistry {
  /**
   * Reserve a trace id as "in progress" before any spans have been emitted.
   * Lets a subscriber attach (e.g. via /traces/:id/stream) immediately after
   * a client learns the traceId, without racing against the first spanStart.
   * Idempotent — calling twice is a no-op.
   */
  register(traceId: string, ownerId: string): void;
  spanStart(span: Span): void;
  spanEnd(spanId: string, patch: Partial<Span>): void;
  traceDone(traceId: string, ownerId: string, summary: TraceSummary): void;

  subscribe(traceId: string, ownerId: string): AsyncIterable<TraceLiveEvent>;
  /**
   * Returns active spans for the trace, an empty array if the trace is
   * registered but no spans have started yet, or `null` if the trace is
   * unknown to this registry.
   */
  getInProgress(traceId: string, ownerId: string): Span[] | null;

  /** For tests / graceful shutdown. Flushes the pending buffer synchronously. */
  waitForFlush(): Promise<void>;
}

export interface InMemoryTraceRegistryOptions {
  store: TraceStore;
  /** Default 100. Flush whenever the pending buffer reaches this count. */
  flushBatchSize?: number;
  /** Default 250. Flush whenever a buffer's age exceeds this many ms. */
  flushIntervalMs?: number;
  /** Default 10_000. Per-owner buffer ceiling; backpressure drops further tool spans. */
  maxBufferPerOwner?: number;
}

interface Subscriber {
  traceId: string;
  ownerId: string;
  push(event: TraceLiveEvent): void;
  done(): void;
}

export class InMemoryTraceRegistry implements TraceRegistry {
  private store: TraceStore;
  private flushBatchSize: number;
  private flushIntervalMs: number;
  private maxBufferPerOwner: number;

  // Active spans by spanId — used by getInProgress and span-end patches.
  private active = new Map<string, Span>();
  // Per-owner pending buffer for batched writes.
  private pendingByOwner = new Map<string, Span[]>();
  // Timer per owner to honour flushIntervalMs.
  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Pending flush promise so waitForFlush() can await it.
  private inflightFlushes: Promise<void>[] = [];
  // Subscribers keyed by `${traceId}::${ownerId}`.
  private subscribers = new Map<string, Set<Subscriber>>();
  // Traces that have been registered but may not yet have any active spans.
  // Keyed by `${traceId}::${ownerId}`. Cleared on traceDone.
  private registered = new Set<string>();

  constructor(opts: InMemoryTraceRegistryOptions) {
    this.store = opts.store;
    this.flushBatchSize = opts.flushBatchSize ?? 100;
    this.flushIntervalMs = opts.flushIntervalMs ?? 250;
    this.maxBufferPerOwner = opts.maxBufferPerOwner ?? 10_000;
  }

  register(traceId: string, ownerId: string): void {
    this.registered.add(`${traceId}::${ownerId}`);
  }

  spanStart(span: Span): void {
    // Backpressure: count active + pending spans for this owner; drop tool spans when at cap.
    const pending = this.pendingByOwner.get(span.ownerId);
    const pendingCount = pending ? pending.length : 0;
    let activeCount = 0;
    for (const s of this.active.values()) {
      if (s.ownerId === span.ownerId) activeCount++;
    }
    if (activeCount + pendingCount >= this.maxBufferPerOwner && span.kind === "tool") {
      // Drop silently — best-effort under load. Could log here.
      return;
    }
    this.active.set(span.spanId, { ...span });
    this.broadcast(span.traceId, span.ownerId, { type: "span-start", span });
  }

  spanEnd(spanId: string, patch: Partial<Span>): void {
    const existing = this.active.get(spanId);
    if (!existing) return; // span-end without span-start — ignore
    const merged: Span = { ...existing, ...patch, spanId };
    this.active.delete(spanId);
    this.enqueue(merged);
    this.broadcast(existing.traceId, existing.ownerId, {
      type: "span-end",
      spanId,
      patch,
    });
  }

  traceDone(traceId: string, ownerId: string, summary: TraceSummary): void {
    // Write the summary immediately (not batched — small, infrequent).
    this.inflightFlushes.push(this.store.upsertSummary(summary).catch(() => {}));
    this.broadcast(traceId, ownerId, { type: "trace-done", summary });
    // Close out subscribers for this trace.
    const key = `${traceId}::${ownerId}`;
    const subs = this.subscribers.get(key);
    if (subs) {
      for (const sub of subs) sub.done();
      this.subscribers.delete(key);
    }
    this.registered.delete(key);
    // Drain pending buffer for this owner so all spans land before subscribers see trace-done finished writing.
    this.scheduleFlush(ownerId, /*immediate*/ true);
  }

  subscribe(traceId: string, ownerId: string): AsyncIterable<TraceLiveEvent> {
    const key = `${traceId}::${ownerId}`;
    let resolveNext: ((value: IteratorResult<TraceLiveEvent>) => void) | null = null;
    const queue: TraceLiveEvent[] = [];
    let closed = false;

    const sub: Subscriber = {
      traceId,
      ownerId,
      push: (event) => {
        if (closed) return;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: event, done: false });
        } else {
          queue.push(event);
        }
      },
      done: () => {
        closed = true;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: undefined as unknown as TraceLiveEvent, done: true });
        }
      },
    };

    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(sub);

    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<TraceLiveEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (closed) {
              return Promise.resolve({ value: undefined as unknown as TraceLiveEvent, done: true });
            }
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
          return(): Promise<IteratorResult<TraceLiveEvent>> {
            sub.done();
            set!.delete(sub);
            return Promise.resolve({ value: undefined as unknown as TraceLiveEvent, done: true });
          },
        };
      },
    };
  }

  getInProgress(traceId: string, ownerId: string): Span[] | null {
    const out: Span[] = [];
    for (const s of this.active.values()) {
      if (s.traceId === traceId && s.ownerId === ownerId) out.push({ ...s });
    }
    if (out.length > 0) return out;
    return this.registered.has(`${traceId}::${ownerId}`) ? [] : null;
  }

  async waitForFlush(): Promise<void> {
    // Move any active (started-but-not-ended) spans into pending so they are flushed.
    for (const span of this.active.values()) {
      let pending = this.pendingByOwner.get(span.ownerId);
      if (!pending) {
        pending = [];
        this.pendingByOwner.set(span.ownerId, pending);
      }
      pending.push({ ...span });
    }
    // Flush all owners immediately and await pending writes.
    for (const ownerId of this.pendingByOwner.keys()) {
      this.scheduleFlush(ownerId, true);
    }
    await Promise.all(this.inflightFlushes.splice(0));
  }

  // ───── internals ─────

  private enqueue(span: Span): void {
    let pending = this.pendingByOwner.get(span.ownerId);
    if (!pending) {
      pending = [];
      this.pendingByOwner.set(span.ownerId, pending);
    }
    pending.push(span);
    if (pending.length >= this.flushBatchSize) {
      this.scheduleFlush(span.ownerId, true);
    } else if (!this.flushTimers.has(span.ownerId)) {
      const t = setTimeout(() => this.scheduleFlush(span.ownerId, true), this.flushIntervalMs);
      this.flushTimers.set(span.ownerId, t);
    }
  }

  private scheduleFlush(ownerId: string, immediate: boolean): void {
    const timer = this.flushTimers.get(ownerId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(ownerId);
    }
    if (!immediate) return;
    const pending = this.pendingByOwner.get(ownerId);
    if (!pending || pending.length === 0) return;
    const batch = pending.splice(0);
    const flushP = this.store.insertSpansBatch(batch).catch(() => {});
    this.inflightFlushes.push(flushP);
  }

  private broadcast(traceId: string, ownerId: string, event: TraceLiveEvent): void {
    const subs = this.subscribers.get(`${traceId}::${ownerId}`);
    if (!subs) return;
    for (const sub of subs) sub.push(event);
  }
}
