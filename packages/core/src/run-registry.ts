import type {
  InvokeResult,
  MultiplexedEvent,
  PendingChildResult,
  Run,
  RunRegistry,
  RunStatus,
  RunStore,
  SpawnRunOptions,
} from "./types.js";
import type { SpanEmitter, RunSpan } from "./telemetry.js";
import { generateRunId } from "./utils/id.js";
import { InvocationCancelledError } from "./errors.js";

const DEFAULT_REPLAY_BUFFER_SIZE = 1000;

interface RunInternal extends Run {
  abortController: AbortController;
}

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  onAbort?: () => void;
}

interface Subscriber {
  push(event: MultiplexedEvent): void;
  close(): void;
}

export type RunExecutor = (signal: AbortSignal) => Promise<InvokeResult>;

export interface InMemoryRunRegistryOptions {
  /** Max events buffered per root for replay on late subscribe (default 1000). */
  replayBufferSize?: number;
  /** Optional persistence layer. */
  store?: RunStore;
}

/**
 * In-process Run registry. Holds the AbortController tree, replay buffers,
 * and the pending-child-result queue. Designed to be wired into a `Runner`
 * by passing it as `runRegistry` in `InvokeOptions`.
 */
export class InMemoryRunRegistry implements RunRegistry {
  readonly store?: RunStore;

  private runs = new Map<string, RunInternal>();
  private childrenByParent = new Map<string, Set<string>>();
  private pending = new Map<string, PendingChildResult[]>();
  private waiters = new Map<string, Waiter[]>();
  private replayBuffers = new Map<string, MultiplexedEvent[]>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private seqCounters = new Map<string, number>();
  private replayBufferSize: number;
  private runEmitters?: Map<string, SpanEmitter>;
  private runSpans?: Map<string, RunSpan>;

  constructor(opts: InMemoryRunRegistryOptions = {}) {
    this.replayBufferSize = opts.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE;
    this.store = opts.store;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  create(opts: SpawnRunOptions): Run {
    const id = generateRunId();
    const parent = opts.parentRunId ? this.runs.get(opts.parentRunId) : undefined;
    const rootId = parent?.rootId ?? id;
    const depth = parent ? parent.depth + 1 : 0;

    const abortController = new AbortController();
    if (parent) {
      const parentSig = parent.abortController.signal;
      if (parentSig.aborted) {
        abortController.abort(parentSig.reason);
      } else {
        parentSig.addEventListener(
          "abort",
          () => abortController.abort(parentSig.reason),
          { once: true },
        );
      }
    }

    const run: RunInternal = {
      id,
      rootId,
      parentId: opts.parentRunId,
      agentId: opts.agentId,
      userId: opts.userId,
      sessionId: opts.sessionId,
      spawnToolUseId: opts.spawnToolUseId,
      input: opts.input,
      status: "pending",
      startedAt: Date.now(),
      depth,
      abortController,
    };

    this.runs.set(id, run);
    if (parent) {
      const set = this.childrenByParent.get(parent.id) ?? new Set<string>();
      set.add(id);
      this.childrenByParent.set(parent.id, set);
    }

    this.emit(rootId, {
      type: "run-spawn",
      runId: id,
      parentId: parent?.id,
      agentId: opts.agentId,
      seq: 0,
    });

    void this.persist(run);

    if (opts.spanEmitter) {
      this.runEmitters ??= new Map();
      this.runEmitters.set(run.id, opts.spanEmitter);
    }

    return toExternal(run);
  }

  start(run: Run, executor: RunExecutor): void {
    const internal = this.runs.get(run.id);
    if (!internal) {
      throw new Error(`Run ${run.id} not found in registry`);
    }
    if (internal.status !== "pending") {
      // Already started or settled — no-op
      return;
    }
    internal.status = "running";
    void this.persist(internal);

    const emitter = this.runEmitters?.get(run.id);
    if (emitter) {
      this.runSpans ??= new Map();
      this.runSpans.set(run.id, emitter.startRun({
        ownerId: run.userId ?? "",
        runId: run.id,
        sessionId: run.sessionId,
        agentId: run.agentId,
      }));
    }

    const promise = (async () => executor(internal.abortController.signal))();
    promise.then(
      (result) => this.completeRun(run.id, result),
      (err) => this.failRun(run.id, err),
    );
  }

  cancel(runId: string, reason?: string): void {
    const run = this.runs.get(runId);
    if (!run || isTerminal(run.status)) return;

    run.abortController.abort(reason ?? "cancelled");

    const childIds = this.childrenByParent.get(runId);
    if (childIds) {
      for (const childId of childIds) {
        this.cancel(childId, reason);
      }
    }
    // Status is finalized in failRun() when the executor's promise rejects.
  }

  // ─── Reads ─────────────────────────────────────────────────────────────

  get(runId: string): Run | undefined {
    const run = this.runs.get(runId);
    return run ? toExternal(run) : undefined;
  }

  children(parentRunId: string): Run[] {
    const ids = this.childrenByParent.get(parentRunId);
    if (!ids) return [];
    const out: Run[] = [];
    for (const id of ids) {
      const r = this.runs.get(id);
      if (r) out.push(toExternal(r));
    }
    return out;
  }

  outstandingChildrenCount(parentRunId: string): number {
    const ids = this.childrenByParent.get(parentRunId);
    if (!ids) return 0;
    let count = 0;
    for (const id of ids) {
      const child = this.runs.get(id);
      if (child && !isTerminal(child.status)) count++;
    }
    return count;
  }

  // ─── Pending queue + draining ──────────────────────────────────────────

  consumePending(parentRunId: string): PendingChildResult[] {
    const queue = this.pending.get(parentRunId);
    if (!queue || queue.length === 0) return [];
    this.pending.delete(parentRunId);
    return queue;
  }

  awaitNextSettled(parentRunId: string, signal?: AbortSignal): Promise<void> {
    if ((this.pending.get(parentRunId) ?? []).length > 0) {
      return Promise.resolve();
    }
    if (this.outstandingChildrenCount(parentRunId) === 0) {
      return Promise.resolve();
    }
    if (signal?.aborted) {
      return Promise.reject(new InvocationCancelledError());
    }

    return new Promise<void>((resolve, reject) => {
      const list = this.waiters.get(parentRunId) ?? [];
      const waiter: Waiter = { resolve, reject };
      list.push(waiter);
      this.waiters.set(parentRunId, list);

      if (signal) {
        const onAbort = () => {
          const idx = list.indexOf(waiter);
          if (idx >= 0) list.splice(idx, 1);
          reject(new InvocationCancelledError());
        };
        waiter.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  async drain(parentRunId: string, signal?: AbortSignal): Promise<void> {
    while (this.outstandingChildrenCount(parentRunId) > 0) {
      if (signal?.aborted) throw new InvocationCancelledError();
      await this.awaitNextSettled(parentRunId, signal);
    }
  }

  // ─── Multiplexed events ────────────────────────────────────────────────

  emit(rootId: string, event: MultiplexedEvent): void {
    const seq = (this.seqCounters.get(rootId) ?? 0) + 1;
    this.seqCounters.set(rootId, seq);
    const stamped: MultiplexedEvent = { ...event, seq };

    const buf = this.replayBuffers.get(rootId) ?? [];
    buf.push(stamped);
    if (buf.length > this.replayBufferSize) buf.shift();
    this.replayBuffers.set(rootId, buf);

    const subs = this.subscribers.get(rootId);
    if (subs) {
      for (const sub of subs) sub.push(stamped);
    }

    // Auto-close subscribers when the root run reaches a terminal event.
    if (
      stamped.runId === rootId &&
      (stamped.type === "run-complete" ||
        stamped.type === "run-error" ||
        stamped.type === "run-cancelled")
    ) {
      queueMicrotask(() => {
        const subs2 = this.subscribers.get(rootId);
        if (subs2) {
          for (const sub of subs2) sub.close();
        }
      });
    }
  }

  async *subscribe(
    rootId: string,
    sinceSeq?: number,
  ): AsyncIterable<MultiplexedEvent> {
    const queue: MultiplexedEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let closed = false;

    const sub: Subscriber = {
      push(event) {
        queue.push(event);
        const r = resolveNext;
        resolveNext = null;
        r?.();
      },
      close() {
        closed = true;
        const r = resolveNext;
        resolveNext = null;
        r?.();
      },
    };

    const subs = this.subscribers.get(rootId) ?? new Set<Subscriber>();
    subs.add(sub);
    this.subscribers.set(rootId, subs);

    try {
      // Replay buffered events first (best-effort; may overlap with live).
      const buffered = this.replayBuffers.get(rootId) ?? [];
      for (const e of buffered) {
        if (sinceSeq === undefined || e.seq > sinceSeq) yield e;
      }

      while (!closed || queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((r) => {
          resolveNext = r;
        });
      }
    } finally {
      subs.delete(sub);
      if (subs.size === 0) this.subscribers.delete(rootId);
    }
  }

  // ─── Public settlement ────────────────────────────────────────────────

  notifyCompleted(runId: string, result: InvokeResult): void {
    this.completeRun(runId, result);
    this.runSpans?.get(runId)?.end();
    this.runSpans?.delete(runId);
    this.runEmitters?.delete(runId);
  }

  notifyFailed(runId: string, err: unknown): void {
    this.failRun(runId, err);
    const message = err instanceof Error ? err.message : String(err);
    this.runSpans?.get(runId)?.error(message);
    this.runSpans?.delete(runId);
    this.runEmitters?.delete(runId);
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private completeRun(runId: string, result: InvokeResult): void {
    const run = this.runs.get(runId);
    if (!run || isTerminal(run.status)) return;
    run.status = "completed";
    run.result = result;
    run.endedAt = Date.now();
    this.emit(run.rootId, { type: "run-complete", runId, result, seq: 0 });
    void this.persist(run);
    this.deliverToParent(run, {
      ok: true,
      output: result.output,
      usage: result.usage,
    });
  }

  private failRun(runId: string, err: unknown): void {
    const run = this.runs.get(runId);
    if (!run || isTerminal(run.status)) return;
    const cancelled =
      err instanceof InvocationCancelledError ||
      run.abortController.signal.aborted;
    const errorMsg = err instanceof Error ? err.message : String(err);
    run.status = cancelled ? "cancelled" : "failed";
    run.error = errorMsg;
    run.endedAt = Date.now();

    if (cancelled) {
      this.emit(run.rootId, { type: "run-cancelled", runId, seq: 0 });
    } else {
      this.emit(run.rootId, { type: "run-error", runId, error: errorMsg, seq: 0 });
    }
    void this.persist(run);
    this.deliverToParent(run, { ok: false, error: errorMsg, cancelled });
  }

  private deliverToParent(
    run: RunInternal,
    payload: PendingChildResult["payload"],
  ): void {
    if (!run.parentId) return;
    const queue = this.pending.get(run.parentId) ?? [];
    queue.push({
      parentRunId: run.parentId,
      childRunId: run.id,
      toolUseId: run.spawnToolUseId,
      agentId: run.agentId,
      payload,
    });
    this.pending.set(run.parentId, queue);

    const list = this.waiters.get(run.parentId);
    const w = list?.shift();
    if (w) w.resolve();
  }

  private persist(run: RunInternal): Promise<void> {
    const store = this.store;
    if (!store) return Promise.resolve();
    return Promise.resolve()
      .then(() => store.putRun(toExternal(run)))
      .catch(() => {
        // RunStore failures should not break in-process execution.
      });
  }
}

function isTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function toExternal(run: RunInternal): Run {
  const { abortController: _abort, ...rest } = run;
  return rest;
}
