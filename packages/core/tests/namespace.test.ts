import { describe, expect, it } from "vitest";
import { NamespaceGrantError } from "../src/errors.js";
import {
	isGrantNarrowedBy,
	isSameOrAncestorNamespace,
	isSameOrDescendantNamespace,
	namespaceAncestors,
	narrowNamespaceGrants,
	normalizeNamespaceGrant,
	normalizeNamespaceGrants,
	validateNamespaceGrantPolicy,
} from "../src/namespace.js";

describe("namespace grants", () => {
	it.each([
		["app", "app"],
		["app/user/u_123", "app/user/u_123"],
		["sales/org/acme/account/a_789", "sales/org/acme/account/a_789"],
	])("normalizes valid grant %s", (input, expected) => {
		expect(normalizeNamespaceGrant(input)).toBe(expected);
	});

	it.each([
		["empty", ""],
		["leading slash", "/app/user"],
		["trailing slash", "app/user/"],
		["empty segment", "app//user"],
		["current-dir traversal", "app/./user"],
		["parent traversal", "app/../user"],
		["wildcard", "app/user/*"],
		["leading whitespace", " app/user"],
		["trailing whitespace", "app/user "],
		["segment whitespace", "app/user one"],
		["non-string", 42],
	])("rejects invalid grant: %s", (_label, input) => {
		expect(() => normalizeNamespaceGrant(input)).toThrow(NamespaceGrantError);
	});

	it("deduplicates normalized grants while preserving order", () => {
		expect(normalizeNamespaceGrants(["a/b", "a/b/c", "a/b"])).toEqual([
			"a/b",
			"a/b/c",
		]);
	});

	it("returns ancestor prefixes from root to self", () => {
		expect(namespaceAncestors("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
	});

	it("distinguishes ancestors, descendants, and siblings", () => {
		expect(isSameOrAncestorNamespace("a/b", "a/b/c")).toBe(true);
		expect(isSameOrAncestorNamespace("a/b/c", "a/b/c")).toBe(true);
		expect(isSameOrAncestorNamespace("a/b/d", "a/b/c")).toBe(false);

		expect(isSameOrDescendantNamespace("a/b/c/d", "a/b/c")).toBe(true);
		expect(isSameOrDescendantNamespace("a/b/c", "a/b/c")).toBe(true);
		expect(isSameOrDescendantNamespace("a/b/d", "a/b/c")).toBe(false);
	});

	it("allows child grants that are the same as or below a parent grant", () => {
		expect(isGrantNarrowedBy("a/b", "a/b")).toBe(true);
		expect(isGrantNarrowedBy("a/b", "a/b/c")).toBe(true);
		expect(isGrantNarrowedBy("a/b", "a/c")).toBe(false);
	});

	it("inherits parent grants when no child grants are requested", () => {
		expect(narrowNamespaceGrants(["a/b", "x/y"], undefined)).toEqual([
			"a/b",
			"x/y",
		]);
	});

	it("accepts a narrowed subset and rejects widening or sideways jumps", () => {
		expect(narrowNamespaceGrants(["a/b"], ["a/b/c"])).toEqual(["a/b/c"]);
		expect(() => narrowNamespaceGrants(["a/b/c"], ["a/b"])).toThrow(
			NamespaceGrantError,
		);
		expect(() => narrowNamespaceGrants(["a/b/c"], ["a/b/d"])).toThrow(
			NamespaceGrantError,
		);
	});

	it("rejects grants that broadly cover protected namespace boundaries", () => {
		const policy = {
			protectedNamespaces: [{ namespace: "gymtext/private/users" }],
		};

		expect(() => validateNamespaceGrantPolicy(["gymtext"], policy)).toThrow(
			NamespaceGrantError,
		);
		expect(() => normalizeNamespaceGrants(["gymtext/private"], policy)).toThrow(
			NamespaceGrantError,
		);
		expect(() =>
			normalizeNamespaceGrants(["gymtext/private/users"], policy),
		).toThrow(NamespaceGrantError);
		expect(
			normalizeNamespaceGrants(["gymtext/private/users/u_123"], policy),
		).toEqual(["gymtext/private/users/u_123"]);
		expect(
			normalizeNamespaceGrants(["gymtext/public/general"], policy),
		).toEqual(["gymtext/public/general"]);
	});

	it("supports explicit privileged exceptions for protected boundaries", () => {
		expect(
			normalizeNamespaceGrants(["gymtext/private/users"], {
				protectedNamespaces: [
					{ namespace: "gymtext/private/users", allowBoundaryGrant: true },
				],
			}),
		).toEqual(["gymtext/private/users"]);

		expect(
			normalizeNamespaceGrants(["gymtext"], {
				protectedNamespaces: [
					{ namespace: "gymtext/private/users", allowAncestorGrants: true },
				],
			}),
		).toEqual(["gymtext"]);
	});
});
