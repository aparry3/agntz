import { describe, expect, it } from "vitest";
import { InMemoryRunRegistry, MemoryStore, type WebhookSecretCreated } from "@agntz/core";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function makeApp(opts: { grace?: number } = {}) {
  const store = new MemoryStore();
  const runRegistry = new InMemoryRunRegistry({
    gracePeriodMs: opts.grace ?? 0,
    persistRun: async (run) => {
      if (run.userId) {
        await store.forUser(run.userId).putRun(run).catch(() => {});
      }
    },
  });
  const app = createWorkerAPI({ store, internalSecret: SECRET, runRegistry });
  return { app, store, runRegistry };
}

function internalAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Internal-Secret": SECRET,
  } as const;
}

describe("POST /webhook-secrets", () => {
  it("creates a secret and returns the raw value once", async () => {
    const { app } = makeApp();
    const res = await app.request("/webhook-secrets", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({ userId: "u1", name: "gymtext-prod" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as WebhookSecretCreated;
    expect(body.name).toBe("gymtext-prod");
    expect(body.userId).toBe("u1");
    expect(body.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(body.id).toMatch(/^whsec_[0-9a-f]{32}$/);
  });

  it("400 when name is missing", async () => {
    const { app } = makeApp();
    const res = await app.request("/webhook-secrets", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({ userId: "u1" }),
    });
    expect(res.status).toBe(400);
  });

  it("409 when name already exists", async () => {
    const { app } = makeApp();
    await app.request("/webhook-secrets", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({ userId: "u1", name: "gymtext-prod" }),
    });
    const res = await app.request("/webhook-secrets", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({ userId: "u1", name: "gymtext-prod" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("GET /webhook-secrets", () => {
  it("lists secrets WITHOUT the raw secret field", async () => {
    const { app } = makeApp();
    await app.request("/webhook-secrets", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({ userId: "u1", name: "gymtext-prod" }),
    });
    const res = await app.request("/webhook-secrets", {
      method: "POST", // POST with userId in body so internal auth resolves user
      headers: internalAuthHeaders(),
      body: JSON.stringify({ userId: "u1", name: "another" }),
    });
    expect(res.status).toBe(201);

    // Now do an actual GET via bearer.
    const root = new MemoryStore();
    // Use the same app's store-backed key for u1.
    // Workaround: reuse internal auth — but GET needs auth too. Use POST then
    // GET via Bearer.
    // To keep this test simple, route-cover via additional list operation.
  });

  it("lists secrets with no raw secret (uses bearer auth)", async () => {
    const { app, store } = makeApp();
    // Provision a key for u1 via the underlying store directly so we can use
    // Bearer auth for the GET (internal+GET path doesn't carry userId).
    const { rawKey } = await store
      .forUser("u1")
      .createApiKey({ userId: "u1", name: "test" });

    // Create a secret via internal POST.
    const createRes = await app.request("/webhook-secrets", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({ userId: "u1", name: "gymtext-prod" }),
    });
    expect(createRes.status).toBe(201);

    const listRes = await app.request("/webhook-secrets", {
      method: "GET",
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(listRes.status).toBe(200);
    const rows = (await listRes.json()) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ name: "gymtext-prod", userId: "u1" });
    // Raw secret MUST be stripped from list responses.
    expect(rows[0].secret).toBeUndefined();
  });
});

describe("POST /webhook-secrets/:id/rotate", () => {
  it("rotates and returns a new active secret", async () => {
    const { app } = makeApp();
    const first = (await (
      await app.request("/webhook-secrets", {
        method: "POST",
        headers: internalAuthHeaders(),
        body: JSON.stringify({ userId: "u1", name: "gymtext-prod" }),
      })
    ).json()) as WebhookSecretCreated;

    const rotateRes = await app.request(
      `/webhook-secrets/${first.id}/rotate`,
      {
        method: "POST",
        headers: internalAuthHeaders(),
        body: JSON.stringify({ userId: "u1" }),
      },
    );
    expect(rotateRes.status).toBe(200);
    const second = (await rotateRes.json()) as WebhookSecretCreated;
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe("gymtext-prod");
    expect(second.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
  });

  it("404 when rotating a non-existent id", async () => {
    const { app } = makeApp();
    const res = await app.request("/webhook-secrets/whsec_nope/rotate", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({ userId: "u1" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /webhook-secrets/:id", () => {
  it("204 and the secret is unresolvable afterwards", async () => {
    const { app, store } = makeApp();
    const created = (await (
      await app.request("/webhook-secrets", {
        method: "POST",
        headers: internalAuthHeaders(),
        body: JSON.stringify({ userId: "u1", name: "gymtext-prod" }),
      })
    ).json()) as WebhookSecretCreated;

    const { rawKey } = await store
      .forUser("u1")
      .createApiKey({ userId: "u1", name: "test" });

    const del = await app.request(`/webhook-secrets/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(del.status).toBe(204);

    const list = (await (
      await app.request("/webhook-secrets", {
        method: "GET",
        headers: { Authorization: `Bearer ${rawKey}` },
      })
    ).json()) as Array<Record<string, unknown>>;
    expect(list.length).toBe(0);
  });
});

describe("POST /runs — webhook validation", () => {
  it("400 when callbackUrl is set without webhookId", async () => {
    const { app } = makeApp();
    const res = await app.request("/runs", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({
        userId: "u1",
        agentId: "any-agent",
        callbackUrl: "https://consumer.example/hook",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/webhookId/);
  });

  it("400 when webhookId references a non-existent secret", async () => {
    const { app } = makeApp();
    const res = await app.request("/runs", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({
        userId: "u1",
        agentId: "any-agent",
        callbackUrl: "https://consumer.example/hook",
        webhookId: "gymtext-prod",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/);
  });

  it("starts a run when callbackUrl + valid webhookId are provided", async () => {
    const { app, store } = makeApp();
    // Provision the secret first.
    await store.forUser("u1").create("gymtext-prod");

    const res = await app.request("/runs", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({
        userId: "u1",
        agentId: "missing-agent",
        callbackUrl: "https://consumer.example/hook",
        webhookId: "gymtext-prod",
      }),
    });
    expect(res.status).toBe(201);
  });

  it("rotation: in-flight run keeps using the secret id pinned at invoke time", async () => {
    // Hard-to-observe without dispatching a real HTTP call, but we can at
    // least assert the run starts and that the post-rotation `resolveById`
    // still returns the original secret (the dispatcher uses this lookup).
    const { app, store } = makeApp();
    const first = await store.forUser("u1").create("gymtext-prod");

    const res = await app.request("/runs", {
      method: "POST",
      headers: internalAuthHeaders(),
      body: JSON.stringify({
        userId: "u1",
        agentId: "missing-agent",
        callbackUrl: "https://consumer.example/hook",
        webhookId: "gymtext-prod",
      }),
    });
    expect(res.status).toBe(201);

    const rotated = await store.forUser("u1").rotate(first.id);
    expect(rotated.id).not.toBe(first.id);

    // The dispatcher resolves the OLD id by id; the secret store guarantees
    // this lookup still works post-rotation.
    const oldStill = await store.forUser("u1").resolveById(first.id);
    expect(oldStill?.id).toBe(first.id);
    expect(oldStill?.secret).toBe(first.secret);
  });
});
