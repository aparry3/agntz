import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyOutputMapping,
  createInitialState,
  getStateKey,
  interpolate,
  parseManifest,
} from "../src/index.js";

const CONTRACTS = join(process.cwd(), "..", "..", "contracts", "python-port");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(CONTRACTS, path), "utf8")) as T;
}

function readManifest(filename: string) {
  return parseManifest(readFileSync(join(CONTRACTS, "manifests", filename), "utf8"));
}

describe("python port contract fixtures", () => {
  it("parses shared manifest kind fixtures", () => {
    const expectations = readJson<
      Record<
        string,
        {
          id: string;
          kind: string;
          stateKey: string;
          model?: { provider: string; name: string };
          outputSchema?: Record<string, unknown>;
          toolKind?: string;
          stepKeys?: string[];
          branchKeys?: string[];
        }
      >
    >("expectations/manifest-kinds.json");

    for (const [filename, expected] of Object.entries(expectations)) {
      const manifest = readManifest(filename);
      expect(manifest.id).toBe(expected.id);
      expect(manifest.kind).toBe(expected.kind);
      expect(manifest.stateKey ?? manifest.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()))
        .toBe(expected.stateKey);

      if (expected.model) {
        expect(manifest.kind).toBe("llm");
        if (manifest.kind === "llm") {
          expect(manifest.model.provider).toBe(expected.model.provider);
          expect(manifest.model.name).toBe(expected.model.name);
        }
      }

      if (expected.outputSchema) {
        expect(manifest.kind).toBe("llm");
        if (manifest.kind === "llm") expect(manifest.outputSchema).toEqual(expected.outputSchema);
      }

      if (expected.toolKind) {
        expect(manifest.kind).toBe("tool");
        if (manifest.kind === "tool") expect(manifest.tool.kind).toBe(expected.toolKind);
      }

      if (expected.stepKeys) {
        expect(manifest.kind).toBe("sequential");
        if (manifest.kind === "sequential") {
          expect(manifest.steps.map((step) => getStateKey(step))).toEqual(expected.stepKeys);
        }
      }

      if (expected.branchKeys) {
        expect(manifest.kind).toBe("parallel");
        if (manifest.kind === "parallel") {
          expect(manifest.branches.map((branch) => getStateKey(branch))).toEqual(
            expected.branchKeys,
          );
        }
      }
    }
  });

  it("matches shared state, template, and output mapping fixtures", () => {
    const contract = readJson<{
      initialInput: Record<string, unknown>;
      initialState: Record<string, unknown>;
      templates: Record<string, { template: string; value: unknown }>;
      outputMapping: {
        mapping: Record<string, unknown>;
        state: Record<string, unknown>;
        value: Record<string, unknown>;
      };
    }>("expectations/state-template.json");

    const state = createInitialState(contract.initialInput, { userQuery: "string" });

    expect(state).toEqual(contract.initialState);
    expect(interpolate(contract.templates.simpleReference.template, state)).toBe(
      contract.templates.simpleReference.value,
    );
    expect(interpolate(contract.templates.interpolated.template, state)).toBe(
      contract.templates.interpolated.value,
    );
    expect(interpolate(contract.templates.missingValue.template, state)).toBe(
      contract.templates.missingValue.value,
    );
    expect(applyOutputMapping(contract.outputMapping.mapping, contract.outputMapping.state))
      .toEqual(contract.outputMapping.value);
  });
});
