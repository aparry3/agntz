import { describe, expect, it } from "vitest";
import {
	findSelectionsByAgentId,
	parseManifest,
	selectManifestBlock,
	selectionKey,
} from "../src/index.js";

const yaml = `
id: root
kind: sequential
steps:
  - agent:
      id: first
      kind: llm
      model:
        provider: openai
        name: gpt-5.4
      instruction: First
  - agent:
      id: fanout
      kind: parallel
      branches:
        - agent:
            id: branch_a
            kind: tool
            tool:
              kind: local
              name: validate_manifest
              params:
                yaml: "{{yaml}}"
        - ref: reused
`;

describe("manifest selection helpers", () => {
	it("selects the root agent when no selection is provided", () => {
		const manifest = parseManifest(yaml);
		const selected = selectManifestBlock(manifest);
		expect(selected.agent?.id).toBe("root");
		expect(selected.step).toBeUndefined();
	});

	it("selects an inline nested agent and its wrapping step", () => {
		const manifest = parseManifest(yaml);
		const selected = selectManifestBlock(manifest, {
			agentPath: ["steps", 1, "agent", "branches", 0, "agent"],
			stepPath: ["steps", 1, "agent", "branches", 0],
		});
		expect(selected.agent?.id).toBe("branch_a");
		expect(selected.step?.agent?.id).toBe("branch_a");
	});

	it("finds inline and ref selections by id", () => {
		const manifest = parseManifest(yaml);
		expect(findSelectionsByAgentId(manifest, "branch_a")).toEqual([
			{
				agentPath: ["steps", 1, "agent", "branches", 0, "agent"],
			},
		]);
		expect(findSelectionsByAgentId(manifest, "reused")).toEqual([
			{
				agentPath: ["steps", 1, "agent", "branches", 1, "agent"],
				stepPath: ["steps", 1, "agent", "branches", 1],
			},
		]);
	});

	it("serializes selection keys deterministically", () => {
		expect(
			selectionKey({
				agentPath: ["steps", 0, "agent"],
				stepPath: ["steps", 0],
			}),
		).toBe('{"agentPath":["steps",0,"agent"],"stepPath":["steps",0]}');
	});
});
