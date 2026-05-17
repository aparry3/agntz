import type {
  InvokeResult,
  MultiplexedEvent,
  PendingChildResult,
  Run,
  RunRegistry,
  RunStatus,
  SpawnRunOptions,
} from "./types.js";
import type { SpanEmitter, RunSpan } from "./telemetry.js";
import { generateRunId } from "./utils/id.js";
import { InvocationCancelledError } from "./errors.js";

const DEFAULT_REPLAY_BUFFER_SIZE = 1000;
const DEFAULT_GRACE_PERIOD_MS = 5 * 60 * 1000;

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
  /**
   * Optional persistence callback. Fired on every Run state transition
   * (create, start, complete, fail, cancel). The callback is responsible
   * for any user-scoping the underlying store requires — the registry only
   * provides the `Run` record, not a userId-aware store handle.
   *
   * Errors are swallowed to keep in-process execution running. Hook this
   * up to logging on your end if you want visibility.
   */
  persistRun?: (run: Run) => void | Promise<void>;
  /**
   * How long to keep a Run resident in memory after it reaches a terminal
   * state. After this window, the Run's entry, replay buffer, and any
   * lingering subscribers are evicted. Subsequent `get`/`subscribe` calls
   * for this id will miss the registry — readers should fall back to the
   * durable RunStore (or accept a 404).
   *
   * Default: 300_000 (5 minutes). Set to 0 to evict synchronously on
   * terminal (useful for tests). Set to Infinity to never evict (not
   * recommended for long-running processes).
   */
  gracePeriodMs?: number;
}

/**
 * In-process Run registry. Holds the AbortController tree, replay buffers,
 * and the pending-child-result queue. Designed to be wired into a `Runner`
 * by passing it as `runRegistry` in `InvokeOptions`.
 *
 * Process-wide use: one instance per worker, with `persistRun` routing each
 * Run to the appropriate user-scoped store. The registry doesn't know about
 * users — callers filter on ownership at the route layer.
 */
export class InMemoryRunRegistry implements RunRegistry {
  private runs = new Map<string, RunInternal>();
  private childrenByParent = new Map<string, Set<string>>();
  private pending = new Map<string, PendingChildResult[]>();
  private waiters = new Map<string, Waiter[]>();
  private replayBuffers = new Map<string, MultiplexedEvent[]>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private seqCounters = new Map<string, number>();
  private evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private replayBufferSize: number;
  private runEmitters?: Map<string, SpanEmitter>;
  private runSpans?: Map<string, RunSpan>;
  private gracePeriodMs: number;
  private persistRun?: (run: Run) => void | Promise<void>;
  /**
   * sessionId → runId of the currently in-flight Run for that session. Only
   * one entry per session at a time. Maintained by start() (set) and
   * completeRun/failRun (delete if the cleared runId still matches). Used by
   * findActiveBySession to power cancel-and-replace.
   */
  private sessionToActiveRun = new Map<string, string>();
  /**
   * Per-session mutex chains. Each entry is the tail Promise of the queue;
   * acquireSessionLock awaits it then publishes a fresh tail. Entries are
   * deleted when their queue drains so we don't accumulate dead sessions.
   */
  private sessionLocks = new Map<string, Promise<void>>();
  /**
   * Per-run terminal waiters. Resolved by completeRun/failRun when the run
   * transitions to a terminal status.
   */
  private terminalWaiters = new Map<string, Array<() => void>>();

  constructor(opts: InMemoryRunRegistryOptions = {}) {
    this.replayBufferSize = opts.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE;
    this.gracePeriodMs = opts.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
    this.persistRun = opts.persistRun;
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
      agentVersion: opts.agentVersion,
      requestedAgentVersion: opts.requestedAgentVersion,
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
    // Top-level Runs (no parent) index on session immediately — they don't
    // necessarily go through start() (the runner's top-level invoke calls
    // create() and then notifyCompleted/notifyFailed directly). Child Runs
    // skip session indexing entirely: cancel-and-replace is a top-level
    // concern, and a child sharing a sessionId with its parent must not
    // collide on the index slot.
    if (opts.sessionId && !opts.parentRunId) {
      this.sessionToActiveRun.set(opts.sessionId, id);
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
    // Belt-and-braces session indexing. Top-level runs are already indexed
    // by create(), but if a caller drives create()+start() on a child whose
    // parent isn't known to the registry, we still want this run findable.
    if (internal.sessionId && !internal.parentId) {
      const indexed = this.sessionToActiveRun.get(internal.sessionId);
      if (!indexed) {
        this.sessionToActiveRun.set(internal.sessionId, internal.id);
      }
    }
    void this.persist(internal);

    const emitter = this.runEmitters?.get(run.id);
    if (emitter) {
      this.runSpans ??= new Map();
      this.runSpans.set(run.id, emitter.startRun({
        ownerId: run.userId ?? "",
        runId: run.id,
        sessionId: run.sessionId,
        agentId: run.agentId,
        requestedVersion: internal.requestedAgentVersion,
        resolvedVersion: internal.agentVersion,
        resolvedVia: internal.agentVersion
          ? (internal.requestedAgentVersion === "latest"
              ? "latest"
              : internal.requestedAgentVersion
                ? "exact"
                : "activated")
          : "registered",
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

  /**
   * Return the AbortSignal of the Run's internal controller. Used by the
   * runner so that top-level invokes (which don't go through start()) can
   * still react to `cancel(runId)` mid-loop — without this, cancel-and-replace
   * couldn't stop an in-flight model call on the superseded run.
   */
  getAbortSignal(runId: string): AbortSignal | undefined {
    return this.runs.get(runId)?.abortController.signal;
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

    // Auto-close subscribers when the root run reaches a terminal event,
    // then schedule eviction of the entire subtree after the grace period.
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
      this.scheduleEviction(rootId);
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

  // ─── Session indexing + per-session mutex ──────────────────────────────

  findActiveBySession(sessionId: string): string | undefined {
    const runId = this.sessionToActiveRun.get(sessionId);
    if (!runId) return undefined;
    const run = this.runs.get(runId);
    // Defensive: if the indexed run vanished or is terminal, treat as none.
    if (!run || isTerminal(run.status)) {
      this.sessionToActiveRun.delete(sessionId);
      return undefined;
    }
    return runId;
  }

  /**
   * FIFO mutex per sessionId. Returned function releases the lock. The
   * implementation chains promises so all acquirers serialize. We also
   * delete the chain entry when its tail resolves to avoid leaking
   * Map entries for sessions that never touch concurrency again.
   */
  acquireSessionLock(sessionId: string): Promise<() => void> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = () => {
        // On release, if no later acquirer chained onto this lock, drop
        // the map entry so empty sessions don't accumulate.
        if (this.sessionLocks.get(sessionId) === next) {
          this.sessionLocks.delete(sessionId);
        }
        resolve();
      };
    });
    this.sessionLocks.set(sessionId, next);
    return previous.then(() => release);
  }

  waitForTerminal(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return Promise.resolve();
    if (isTerminal(run.status)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const list = this.terminalWaiters.get(runId) ?? [];
      list.push(resolve);
      this.terminalWaiters.set(runId, list);
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private completeRun(runId: string, result: InvokeResult): void {
    const run = this.runs.get(runId);
    if (!run || isTerminal(run.status)) return;
    run.status = "completed";
    run.result = result;
    run.endedAt = Date.now();
    this.clearSessionIndex(run);
    this.emit(run.rootId, { type: "run-complete", runId, result, seq: 0 });
    void this.persist(run);
    this.deliverToParent(run, {
      ok: true,
      output: result.output,
      usage: result.usage,
    });
    this.resolveTerminalWaiters(runId);
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
    this.clearSessionIndex(run);

    if (cancelled) {
      this.emit(run.rootId, { type: "run-cancelled", runId, seq: 0 });
    } else {
      this.emit(run.rootId, { type: "run-error", runId, error: errorMsg, seq: 0 });
    }
    void this.persist(run);
    this.deliverToParent(run, { ok: false, error: errorMsg, cancelled });
    this.resolveTerminalWaiters(runId);
  }

  /**
   * Drop the sessionToActiveRun entry for this run iff this run is still
   * the indexed one. Skipping the equality check would race with a
   * cancel-and-replace where the replacing run has already claimed the
   * slot via start().
   */
  private clearSessionIndex(run: RunInternal): void {
    if (!run.sessionId) return;
    const indexed = this.sessionToActiveRun.get(run.sessionId);
    if (indexed === run.id) {
      this.sessionToActiveRun.delete(run.sessionId);
    }
  }

  private resolveTerminalWaiters(runId: string): void {
    const waiters = this.terminalWaiters.get(runId);
    if (!waiters) return;
    this.terminalWaiters.delete(runId);
    for (const w of waiters) {
      try { w(); } catch {}
    }
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
    const cb = this.persistRun;
    if (!cb) return Promise.resolve();
    return Promise.resolve()
      .then(() => cb(toExternal(run)))
      .catch(() => {
        // Persistence failures should not break in-process execution.
      });
  }

  /**
   * Schedule eviction of an entire terminal subtree after the grace period.
   * Should only be called with a rootId. Replay buffer + per-run entries +
   * subscribers are dropped at that point; readers fall back to the durable
   * store.
   */
  private scheduleEviction(rootId: string): void {
    const grace = this.gracePeriodMs;
    if (!Number.isFinite(grace)) return;
    if (this.evictionTimers.has(rootId)) return;

    const sweep = () => this.evictSubtree(rootId);
    if (grace <= 0) {
      // Defer one turn so any synchronously-attached subscribers can read
      // the terminal replay buffer first.
      queueMicrotask(sweep);
      return;
    }
    const timer = setTimeout(sweep, grace);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    this.evictionTimers.set(rootId, timer);
  }

  /**
   * Drop all in-memory state for a root's entire subtree. Safe to call
   * manually (used by tests). No-op if the root isn't terminal — eviction
   * during execution would orphan still-running children.
   */
  private evictSubtree(rootId: string): void {
    const root = this.runs.get(rootId);
    if (!root) {
      // Already gone, but still clean up shared-key state.
      this.replayBuffers.delete(rootId);
      this.seqCounters.delete(rootId);
      this.subscribers.delete(rootId);
      this.evictionTimers.delete(rootId);
      return;
    }
    if (!isTerminal(root.status)) return;

    // Collect every descendant via BFS over childrenByParent.
    const toRemove: string[] = [rootId];
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const kids = this.childrenByParent.get(id);
      if (!kids) continue;
      for (const childId of kids) {
        toRemove.push(childId);
        queue.push(childId);
      }
    }

    for (const id of toRemove) {
      const ev = this.runs.get(id);
      if (ev && ev.sessionId) {
        // Defensive: only clear the index if it still points at this run.
        const indexed = this.sessionToActiveRun.get(ev.sessionId);
        if (indexed === id) this.sessionToActiveRun.delete(ev.sessionId);
      }
      this.runs.delete(id);
      this.pending.delete(id);
      this.waiters.delete(id);
      this.childrenByParent.delete(id);
      this.terminalWaiters.delete(id);
    }
    // Root-keyed bookkeeping
    this.replayBuffers.delete(rootId);
    this.seqCounters.delete(rootId);
    this.subscribers.delete(rootId);
    this.evictionTimers.delete(rootId);
  }
}

function isTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function toExternal(run: RunInternal): Run {
  const { abortController: _abort, ...rest } = run;
  return rest;
}
