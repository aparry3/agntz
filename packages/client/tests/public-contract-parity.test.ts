import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	AgentsResource,
	ArtifactsResource,
	RunsResource,
} from "../src/index.js";

interface ParityContract {
	version: number;
	resources: Record<string, string[]>;
	agentKinds: string[];
	retentionModes: string[];
	contentBlockTypes: string[];
}

const contract = JSON.parse(
	readFileSync(
		resolve(process.cwd(), "../../contracts/hosted-client-parity.json"),
		"utf8",
	),
) as ParityContract;

describe("hosted client public-contract parity", () => {
	it("keeps the migration-critical resource surface available", () => {
		const resources: Record<string, object> = {
			agents: AgentsResource.prototype,
			artifacts: ArtifactsResource.prototype,
			runs: RunsResource.prototype,
		};

		for (const [resource, methods] of Object.entries(contract.resources)) {
			for (const method of methods) {
				expect(
					typeof (resources[resource] as Record<string, unknown>)[method],
					`${resource}.${method}`,
				).toBe("function");
			}
		}
	});

	it("pins the cross-language content and retention vocabulary", () => {
		expect(contract.version).toBe(2);
		expect(contract.retentionModes).toEqual(["none", "result", "session"]);
		expect(contract.contentBlockTypes).toEqual(["text", "image", "audio"]);
		expect(contract.agentKinds).toEqual([
			"llm",
			"tool",
			"sequential",
			"parallel",
			"transcription",
			"image",
		]);
	});
});
