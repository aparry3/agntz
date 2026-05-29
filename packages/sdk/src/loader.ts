import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { parseManifest, validateManifest } from "@agntz/manifest";
import type { AgentManifest } from "@agntz/manifest";

/**
 * Loads agent manifests from a directory of `.yaml`/`.yml` files.
 * Synchronous semantics from the caller's perspective: scan once at init,
 * fail fast on any structural or reference error so misconfigurations
 * surface immediately rather than at first invocation.
 *
 * Subdirectories are walked recursively. Non-YAML files are ignored.
 * Multiple manifests sharing the same `id` raise an error.
 */
export async function loadManifestsFromDir(
	dir: string,
): Promise<Map<string, AgentManifest>> {
	const absDir = resolve(dir);
	const manifests = new Map<string, AgentManifest>();
	const files = await collectYamlFiles(absDir);

	for (const file of files) {
		const text = await readFile(file, "utf8");
		const result = validateManifest(text);
		if (!result.valid || !result.manifest) {
			const lines = result.errors
				.map((e) => `  - ${e.path || "(root)"}: ${e.message}`)
				.join("\n");
			throw new Error(`Invalid agent manifest at ${file}:\n${lines}`);
		}
		const manifest = result.manifest;
		if (manifests.has(manifest.id)) {
			throw new Error(
				`Duplicate agent id '${manifest.id}' — defined in ${file} and another file in ${absDir}`,
			);
		}
		manifests.set(manifest.id, manifest);
	}
	return manifests;
}

/** Loads a single YAML file. Useful for tests and one-off agents. */
export async function loadManifestFromFile(
	file: string,
): Promise<AgentManifest> {
	const text = await readFile(file, "utf8");
	const result = validateManifest(text);
	if (!result.valid || !result.manifest) {
		const lines = result.errors
			.map((e) => `  - ${e.path || "(root)"}: ${e.message}`)
			.join("\n");
		throw new Error(`Invalid agent manifest at ${file}:\n${lines}`);
	}
	return result.manifest;
}

/** Parses a YAML string directly. Exposed for programmatic use. */
export function parseManifestString(text: string): AgentManifest {
	const manifest = parseManifest(text);
	if (!manifest) {
		throw new Error("Could not parse agent manifest from string");
	}
	return manifest;
}

async function collectYamlFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (e) {
		const err = e as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			throw new Error(`Agent directory does not exist: ${dir}`);
		}
		throw e;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		const st = await stat(full);
		if (st.isDirectory()) {
			out.push(...(await collectYamlFiles(full)));
		} else if (st.isFile()) {
			const ext = extname(entry).toLowerCase();
			if (ext === ".yaml" || ext === ".yml") {
				out.push(full);
			}
		}
	}
	return out.sort();
}
