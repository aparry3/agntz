import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/sqlite.js";

describe("SqliteStore NamespaceRootStore", () => {
	let store: SqliteStore;

	beforeEach(() => {
		store = new SqliteStore(":memory:");
	});

	afterEach(() => {
		store.close();
	});

	it("adds, lists (sorted), dedupes, and removes roots per user", async () => {
		expect(await store.listNamespaceRoots("u1")).toEqual([]);

		await store.addNamespaceRoot("u1", "gymtext");
		await store.addNamespaceRoot("u1", "gymtext"); // idempotent
		await store.addNamespaceRoot("u1", "acme/team");
		await store.addNamespaceRoot("u2", "other");

		expect(await store.listNamespaceRoots("u1")).toEqual([
			"acme/team",
			"gymtext",
		]);
		expect(await store.listNamespaceRoots("u2")).toEqual(["other"]);

		await store.removeNamespaceRoot("u1", "gymtext");
		expect(await store.listNamespaceRoots("u1")).toEqual(["acme/team"]);

		// Removing a non-existent root is a no-op.
		await store.removeNamespaceRoot("u1", "nope");
		expect(await store.listNamespaceRoots("u1")).toEqual(["acme/team"]);
	});

	it("rejects malformed roots via normalizeNamespaceGrant", async () => {
		await expect(store.addNamespaceRoot("u1", "/bad/")).rejects.toThrow();
		expect(await store.listNamespaceRoots("u1")).toEqual([]);
	});
});
