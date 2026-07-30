export interface ImportedDatasetItem {
	id: string;
	name?: string;
	input: unknown;
	metadata?: Record<string, unknown>;
}

export async function importDatasetFile(
	file: File,
	options: { name?: string; datasetId?: string } = {},
): Promise<{ id: string; name: string; itemCount: number }> {
	const text = await file.text();
	const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "jsonl";
	const items =
		format === "csv" ? parseCsvDataset(text) : parseJsonlDataset(text);
	if (items.length === 0)
		throw new Error("The selected file contains no items");
	const created = await jsonRequest("/api/dataset-imports", {
		method: "POST",
		body: JSON.stringify({
			datasetId: options.datasetId,
			name: options.name ?? file.name.replace(/\.(csv|jsonl)$/i, ""),
		}),
	});
	try {
		for (let offset = 0; offset < items.length; offset += 1_000) {
			await jsonRequest(
				`/api/dataset-imports/${encodeURIComponent(created.id)}/items`,
				{
					method: "POST",
					body: JSON.stringify({ items: items.slice(offset, offset + 1_000) }),
				},
			);
		}
		const dataset = await jsonRequest(
			`/api/dataset-imports/${encodeURIComponent(created.id)}/complete`,
			{ method: "POST", body: "{}" },
		);
		return {
			id: dataset.id,
			name: dataset.name,
			itemCount: dataset.itemCount ?? items.length,
		};
	} catch (error) {
		await fetch(`/api/dataset-imports/${encodeURIComponent(created.id)}`, {
			method: "DELETE",
		}).catch(() => {});
		throw error;
	}
}

function parseJsonlDataset(text: string): ImportedDatasetItem[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line, index) => {
			const value = JSON.parse(line) as unknown;
			if (isRecord(value) && "input" in value) {
				return {
					id:
						typeof value.id === "string"
							? value.id
							: `row_${String(index + 1).padStart(6, "0")}`,
					name: typeof value.name === "string" ? value.name : undefined,
					input: value.input,
					metadata: isRecord(value.metadata) ? value.metadata : undefined,
				};
			}
			return {
				id: `row_${String(index + 1).padStart(6, "0")}`,
				input: value,
			};
		});
}

function parseCsvDataset(text: string): ImportedDatasetItem[] {
	const rows = parseCsvRows(text);
	const headers = rows.shift();
	if (!headers?.length) return [];
	return rows
		.filter((row) => row.some(Boolean))
		.map((row, index) => {
			const record = Object.fromEntries(
				headers.map((header, column) => [header, row[column] ?? ""]),
			);
			const rawInput = record.input;
			const metadata = Object.fromEntries(
				Object.entries(record).filter(
					([key]) => !["id", "name", "input"].includes(key),
				),
			);
			return {
				id: record.id?.trim() || `row_${String(index + 1).padStart(6, "0")}`,
				name: record.name?.trim() || undefined,
				input:
					rawInput === undefined
						? Object.fromEntries(
								Object.entries(record).filter(([key]) => key !== "id"),
							)
						: parseMaybeJson(rawInput),
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		});
}

function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (character === '"') {
			if (quoted && text[index + 1] === '"') {
				cell += '"';
				index++;
			} else quoted = !quoted;
		} else if (character === "," && !quoted) {
			row.push(cell);
			cell = "";
		} else if ((character === "\n" || character === "\r") && !quoted) {
			if (character === "\r" && text[index + 1] === "\n") index++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += character;
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

function parseMaybeJson(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			return JSON.parse(trimmed) as unknown;
		} catch {
			// Keep the cell as text.
		}
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function jsonRequest(url: string, init: RequestInit) {
	const response = await fetch(url, {
		...init,
		headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok)
		throw new Error(body.error ?? `Request failed (${response.status})`);
	return body;
}
