import { defineTool } from "@agent-runner/core";
import { validateManifest } from "@agent-runner/manifest";
import { z } from "zod";

/**
 * Local tool: validate_manifest
 * Validates a YAML agent manifest and returns the validation result.
 */
export const validateManifestTool = defineTool({
  name: "validate_manifest",
  description:
    "Validate a YAML agent manifest. Returns { valid, errors, warnings }. " +
    "Use this to check if a generated manifest is correct before returning it.",
  input: z.object({
    yaml: z.string().describe("The YAML manifest string to validate"),
  }),
  async execute(input: { yaml: string }) {
    const result = validateManifest(input.yaml);
    return {
      valid: result.valid,
      errors: result.errors.map((e) => ({
        level: e.level,
        path: e.path,
        message: e.message,
      })),
      warnings: result.warnings.map((w) => ({
        path: w.path,
        message: w.message,
      })),
    };
  },
});
