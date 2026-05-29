import type { MemoryEntry, MemoryStore, TopicSummary } from "./types.js";

interface TopicMeta {
  blurb?: string;
  lastUpdatedAt?: string;
}

export class InMemoryMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>();
  private topicMeta = new Map<string, TopicMeta>();

  async putEntry(entry: MemoryEntry): Promise<void> {
    this.entries.set(entry.id, { ...entry, topics: [...entry.topics] });
  }

  async getEntry(id: string): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    return entry ? cloneEntry(entry) : null;
  }

  async supersede(ids: string[], byId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      this.entries.set(id, {
        ...entry,
        status: "superseded",
        supersededBy: byId,
        updatedAt: now,
      });
    }
  }

  async listTopics(scopePaths: string[]): Promise<TopicSummary[]> {
    const scopes = new Set(scopePaths);
    const counts = new Map<string, { count: number; lastUpdatedAt: string; hasUncuratedWrites: boolean }>();
    for (const entry of this.entries.values()) {
      if (entry.status !== "active" || !scopes.has(entry.scope)) continue;
      for (const topic of entry.topics) {
        const current = counts.get(topic);
        if (!current) {
          counts.set(topic, {
            count: 1,
            lastUpdatedAt: entry.updatedAt,
            hasUncuratedWrites: true,
          });
        } else {
          current.count += 1;
          if (entry.updatedAt > current.lastUpdatedAt) current.lastUpdatedAt = entry.updatedAt;
          current.hasUncuratedWrites = true;
        }
      }
    }
    return Array.from(counts.entries())
      .map(([topic, summary]) => {
        const meta = this.findTopicMeta(scopePaths, topic);
        return {
          topic,
          count: summary.count,
          blurb: meta?.blurb,
          lastUpdatedAt: meta?.lastUpdatedAt ?? summary.lastUpdatedAt,
          hasUncuratedWrites: summary.hasUncuratedWrites,
        };
      })
      .sort((a, b) => a.topic.localeCompare(b.topic));
  }

  async getByTopic(scopePaths: string[], topic: string, limit = 20): Promise<MemoryEntry[]> {
    const scopes = new Set(scopePaths);
    return Array.from(this.entries.values())
      .filter((entry) =>
        entry.status === "active" &&
        scopes.has(entry.scope) &&
        entry.topics.includes(topic),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(cloneEntry);
  }

  async getTopicMeta(scope: string, topic: string): Promise<Omit<TopicSummary, "count"> | null> {
    const meta = this.topicMeta.get(metaKey(scope, topic));
    return meta
      ? {
          topic,
          blurb: meta.blurb,
          lastUpdatedAt: meta.lastUpdatedAt ?? new Date(0).toISOString(),
          hasUncuratedWrites: false,
        }
      : null;
  }

  async setTopicMeta(scope: string, topic: string, meta: { blurb?: string; lastUpdatedAt?: string }): Promise<void> {
    this.topicMeta.set(metaKey(scope, topic), {
      blurb: meta.blurb,
      lastUpdatedAt: meta.lastUpdatedAt ?? new Date().toISOString(),
    });
  }

  async listScopeSlice(scopePaths: string[], opts: { topics?: string[]; includeSuperseded?: boolean } = {}): Promise<MemoryEntry[]> {
    const scopes = new Set(scopePaths);
    const topics = opts.topics ? new Set(opts.topics) : undefined;
    return Array.from(this.entries.values())
      .filter((entry) => {
        if (!scopes.has(entry.scope)) return false;
        if (!opts.includeSuperseded && entry.status !== "active") return false;
        if (topics && !entry.topics.some((topic) => topics.has(topic))) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(cloneEntry);
  }

  private findTopicMeta(scopePaths: string[], topic: string): TopicMeta | undefined {
    for (let i = scopePaths.length - 1; i >= 0; i--) {
      const meta = this.topicMeta.get(metaKey(scopePaths[i], topic));
      if (meta) return meta;
    }
    return undefined;
  }
}

function metaKey(scope: string, topic: string): string {
  return `${scope}\u0000${topic}`;
}

function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return { ...entry, topics: [...entry.topics], source: entry.source ? { ...entry.source } : undefined };
}
