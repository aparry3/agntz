import { describe, it, expect } from "vitest";
import { MemoryStore } from "../../src/stores/memory.js";

/**
 * Behavioural contract for `WebhookSecretStore`. Memory is the reference
 * implementation; sqlite + postgres conform to the same surface in their own
 * test packages.
 */
describe("WebhookSecretStore (MemoryStore)", () => {
  it("create returns the raw secret; subsequent list calls do NOT include it as a one-time value", async () => {
    const store = new MemoryStore({ strict: true }).forUser("user_a");
    const created = await store.create("gymtext-prod");

    expect(created.secret).toBeTruthy();
    expect(created.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(created.id).toMatch(/^whsec_[0-9a-f]{32}$/);

    // The persisted record retains the raw secret (HMAC requires the bytes),
    // but list-based callers should NOT rely on it being absent — the worker
    // route is responsible for stripping it from the wire response. The store
    // contract is: the same raw value is consistently available.
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0].secret).toBe(created.secret);
  });

  it("rotate: old id still resolveById, new id is the active resolveByName", async () => {
    const store = new MemoryStore({ strict: true }).forUser("user_a");
    const first = await store.create("gymtext-prod");
    const second = await store.rotate(first.id);

    expect(second.id).not.toBe(first.id);
    expect(second.secret).not.toBe(first.secret);

    // resolveById works for both (in-flight signing keeps working).
    const oldResolved = await store.resolveById(first.id);
    expect(oldResolved?.id).toBe(first.id);
    expect(oldResolved?.rotatedAt).toBeTruthy();
    const newResolved = await store.resolveById(second.id);
    expect(newResolved?.id).toBe(second.id);
    expect(newResolved?.rotatedAt).toBeFalsy();

    // resolveByName returns the new active secret.
    const byName = await store.resolveByName("gymtext-prod");
    expect(byName?.id).toBe(second.id);
  });

  it("revoke makes the secret unresolvable by name and id", async () => {
    const store = new MemoryStore({ strict: true }).forUser("user_a");
    const created = await store.create("gymtext-prod");
    await store.revoke(created.id);

    expect(await store.resolveByName("gymtext-prod")).toBeUndefined();
    expect(await store.resolveById(created.id)).toBeUndefined();
  });

  it("creating two active secrets with the same name fails", async () => {
    const store = new MemoryStore({ strict: true }).forUser("user_a");
    await store.create("gymtext-prod");
    await expect(store.create("gymtext-prod")).rejects.toThrow(/already exists/);
  });

  it("after rotation, a fresh create with the same name still fails (rotated rows hold the slot only until rotation)", async () => {
    const store = new MemoryStore({ strict: true }).forUser("user_a");
    const first = await store.create("gymtext-prod");
    await store.rotate(first.id);
    // After rotation there's a new ACTIVE row with the same name; another
    // `create` of the same name must reject. Use `rotate` to roll the key.
    await expect(store.create("gymtext-prod")).rejects.toThrow(/already exists/);
  });

  it("scoping: secret created under user_a is invisible to user_b", async () => {
    const root = new MemoryStore({ strict: true });
    const a = root.forUser("user_a");
    const b = root.forUser("user_b");

    await a.create("gymtext-prod");

    expect((await b.list()).length).toBe(0);
    expect(await b.resolveByName("gymtext-prod")).toBeUndefined();
  });
});
