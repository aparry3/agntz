import { randomUUID } from "node:crypto";
import {
  assertWritableScope,
  normalizeGrants,
  normalizeWritePolicy,
  visibleScopes,
} from "./grants.js";
import { InMemoryMemoryStore } from "./store.js";
import { createMemoryResourceProvider } from "./provider.js";
import type {
  CurateOptions,
  CurateReport,
  EntryType,
  MemrezOptions,
  MemrezReasoner,
  MemoryEntry,
  MemoryStore,
  NamespaceGrant,
  ReadOptions,
  ScanOptions,
  TaggerInput,
  TaggerResult,
  TopicSummary,
  WriteOptions,
} from "./types.js";
import type { ResourceProvider } from "@agntz/core";

export class Memrez {
  readonly store: MemoryStore;
  readonly reasoner: MemrezReasoner;

  constructor(options: MemrezOptions = {}) {
    this.store = options.store ?? new InMemoryMemoryStore();
    this.reasoner = options.reasoner ?? new DeterministicReasoner();
  }

  provider(): ResourceProvider {
    return createMemoryResourceProvider(this);
  }

  async scan(
    grants: NamespaceGrant[],
    opts: ScanOptions = {},
  ): Promise<{ grants: NamespaceGrant[]; topics: TopicSummary[] }> {
    const normalized = normalizeGrants(grants);
    const scopes = visibleScopes(normalized, opts.includeAncestors ?? true);
    const topics = await this.store.listTopics(scopes);
    return {
      grants: normalized,
      topics: opts.topicLimit ? topics.slice(0, opts.topicLimit) : topics,
    };
  }

  async read(
    grants: NamespaceGrant[],
    topic: string,
    opts: ReadOptions = {},
  ): Promise<MemoryEntry[]> {
    const normalized = normalizeGrants(grants);
    const scopes = visibleScopes(normalized, opts.includeAncestors ?? true);
    return this.store.getByTopic(scopes, topic, opts.limit);
  }

  async write(
    grants: NamespaceGrant[],
    content: string,
    opts: WriteOptions = {},
  ): Promise<{ entry: MemoryEntry; action: "appended" | "superseded" | "deduped" }> {
    const normalized = normalizeGrants(grants);
    const writePolicy = normalizeWritePolicy(opts.writePolicy);
    const existingTopics = (await this.scan(normalized)).topics.map((topic) => topic.topic);
    const tag = await this.reasoner.tag({
      grants: normalized,
      content,
      existingTopics,
      topicsHint: opts.topicsHint,
      writePolicy,
      source: opts.source,
    });
    const scope = assertWritableScope(normalized, tag.namespace, writePolicy);

    if (tag.duplicateOf) {
      const duplicate = await this.store.getEntry(tag.duplicateOf);
      if (duplicate) return { entry: duplicate, action: "deduped" };
    }

    const exactDuplicate = await this.findExactDuplicate(scope, tag.normalizedContent);
    if (exactDuplicate) {
      return { entry: exactDuplicate, action: "deduped" };
    }

    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: `mem_${randomUUID()}`,
      scope,
      content: tag.normalizedContent,
      topics: normalizeTopics(tag.topics),
      type: opts.type ?? tag.type,
      source: opts.source,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.putEntry(entry);
    return { entry, action: "appended" };
  }

  async curate(grants: NamespaceGrant[], opts: CurateOptions = {}): Promise<CurateReport> {
    const normalized = normalizeGrants(grants);
    const scopePaths = opts.includeDescendants ? normalized : visibleScopes(normalized, true);
    const entries = await this.store.listScopeSlice(scopePaths, { topics: opts.topics });
    const ops = this.reasoner.curate
      ? await this.reasoner.curate({ grants: normalized, scopePaths, entries, topics: opts.topics })
      : [];

    const report: CurateReport = {
      scanned: entries.length,
      superseded: 0,
      created: 0,
      blurbsUpdated: 0,
    };

    for (const op of ops) {
      if (op.type === "setBlurb") {
        await this.store.setTopicMeta(op.scope, op.topic, {
          blurb: op.blurb,
          lastUpdatedAt: new Date().toISOString(),
        });
        report.blurbsUpdated += 1;
      } else if (op.type === "supersede") {
        const scope = assertWritableScope(normalized, op.replacement.namespace, normalizeWritePolicy(undefined));
        const now = new Date().toISOString();
        const replacement: MemoryEntry = {
          id: `mem_${randomUUID()}`,
          scope,
          content: op.replacement.content,
          topics: normalizeTopics(op.replacement.topics),
          type: op.replacement.entryType ?? "fact",
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
        await this.store.putEntry(replacement);
        await this.store.supersede(op.ids, replacement.id);
        report.created += 1;
        report.superseded += op.ids.length;
      }
    }

    return report;
  }

  private async findExactDuplicate(scope: string, content: string): Promise<MemoryEntry | null> {
    const entries = await this.store.listScopeSlice([scope]);
    return entries.find((entry) => entry.content === content && entry.status === "active") ?? null;
  }
}

export function createMemrez(options: MemrezOptions = {}): Memrez {
  return new Memrez(options);
}

class DeterministicReasoner implements MemrezReasoner {
  async tag(input: TaggerInput): Promise<TaggerResult> {
    return {
      namespace: input.grants[0],
      topics: normalizeTopics(input.topicsHint?.length ? input.topicsHint : ["general"]),
      type: "fact",
      normalizedContent: input.content.trim(),
    };
  }
}

function normalizeTopics(topics: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of topics) {
    const normalized = topic.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.length > 0 ? out : ["general"];
}
