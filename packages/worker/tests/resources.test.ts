import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadResourcesModule() {
	vi.resetModules();
	return import("../src/resources.js");
}

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	vi.resetModules();
});

describe("worker resource providers", () => {
	it("registers memrez memory when MEMREZ_STORE=memory", async () => {
		process.env.MEMREZ_STORE = "memory";
		const { describeResourceProviders, getResourceProviders } =
			await loadResourcesModule();

		const resources = getResourceProviders();

		expect(Object.keys(resources)).toEqual(["memory"]);
		expect(describeResourceProviders(resources)).toBe("memory");
	});

	it("can disable memrez with MEMREZ_STORE=disabled", async () => {
		process.env.MEMREZ_STORE = "disabled";
		const { describeResourceProviders, getResourceProviders } =
			await loadResourcesModule();

		const resources = getResourceProviders();

		expect(resources).toEqual({});
		expect(describeResourceProviders(resources)).toBe("none");
	});

	it("requires a connection string for the postgres memrez store", async () => {
		process.env.MEMREZ_STORE = "postgres";
		Reflect.deleteProperty(process.env, "MEMREZ_DATABASE_URL");
		Reflect.deleteProperty(process.env, "DATABASE_URL");
		const { getResourceProviders } = await loadResourcesModule();

		expect(() => getResourceProviders()).toThrow(/DATABASE_URL/);
	});
});
