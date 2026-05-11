import { describe, beforeAll, beforeEach, afterAll } from "vitest";
import { PostgresStore } from "../src/postgres-store.js";
import { runTraceStoreConformance } from "../../core/src/__tests__/trace-store-conformance.js";

const url = process.env.DATABASE_URL;
const hasDb = !!url;

describe.skipIf(!hasDb)("PostgresStore trace tests", () => {
  let admin: PostgresStore;
  const prefix = `art_traces_${Date.now()}_`;

  beforeAll(async () => {
    admin = new PostgresStore({ connection: url!, tablePrefix: prefix });
    // Wait for migration to complete so tables exist before beforeEach truncation.
    // insertSpansBatch with empty array is a no-op that still calls ensureMigrated.
    await (admin as unknown as import("@agntz/core").TraceStore).insertSpansBatch([]);
  });

  beforeEach(async () => {
    // Truncate between conformance tests so fixed trace IDs don't leak.
    try {
      await admin.pgPool.query(`TRUNCATE ${prefix}spans, ${prefix}trace_summaries`);
    } catch {
      // Tables may not exist yet on the very first run — safe to ignore.
    }
  });

  afterAll(async () => {
    try {
      await admin.pgPool.query(`DROP TABLE IF EXISTS ${prefix}spans CASCADE`);
      await admin.pgPool.query(`DROP TABLE IF EXISTS ${prefix}trace_summaries CASCADE`);
    } catch {
      // ignore
    }
    await admin.close();
  });

  runTraceStoreConformance("PostgresStore (integration)", async () => {
    return admin as unknown as import("@agntz/core").TraceStore;
  });
});
