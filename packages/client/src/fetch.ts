import { AgntzError, AuthenticationError, NotFoundError } from "./errors.js";

export interface RequestArgs {
	baseUrl: string;
	path: string;
	method: "GET" | "POST" | "PUT" | "DELETE";
	apiKey?: string;
	body?: unknown;
	signal?: AbortSignal;
	accept?: string;
	headers?: Record<string, string>;
	fetchImpl: typeof fetch;
}

export function composeSignal(
	...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
	const present = signals.filter((s): s is AbortSignal => s !== undefined);
	if (present.length === 0) return undefined;
	if (present.length === 1) return present[0];
	const anyImpl = (
		AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }
	).any;
	if (typeof anyImpl === "function") return anyImpl(present);
	const ctrl = new AbortController();
	for (const s of present) {
		if (s.aborted) {
			ctrl.abort(s.reason);
			break;
		}
		s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
	}
	return ctrl.signal;
}

export async function sendRequest(args: RequestArgs): Promise<Response> {
	const url = joinUrl(args.baseUrl, args.path);
	const headers: Record<string, string> = { ...(args.headers ?? {}) };
	if (args.body !== undefined) headers["Content-Type"] = "application/json";
	if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`;
	if (args.accept) headers.Accept = args.accept;

	const init: RequestInit = {
		method: args.method,
		headers,
	};
	if (args.body !== undefined) init.body = JSON.stringify(args.body);
	if (args.signal) init.signal = args.signal;

	const res = await args.fetchImpl(url, init);
	if (!res.ok) throw await toError(res);
	return res;
}

export async function sendFormRequest(args: {
	baseUrl: string;
	path: string;
	method: "POST";
	apiKey?: string;
	form: FormData;
	signal?: AbortSignal;
	fetchImpl: typeof fetch;
}): Promise<Response> {
	const headers: Record<string, string> = {};
	if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`;
	const res = await args.fetchImpl(joinUrl(args.baseUrl, args.path), {
		method: args.method,
		headers,
		body: args.form,
		signal: args.signal,
	});
	if (!res.ok) throw await toError(res);
	return res;
}

async function toError(res: Response): Promise<AgntzError> {
	const { message, code } = await readError(res);
	const init = { status: res.status, code };
	if (res.status === 401) return new AuthenticationError(message, init);
	if (res.status === 404) return new NotFoundError(message, init);
	return new AgntzError(message, init);
}

async function readError(
	res: Response,
): Promise<{ message: string; code?: string }> {
	try {
		const body = (await res.json()) as { error?: unknown; code?: unknown };
		if (body && typeof body.error === "string") {
			return {
				message: body.error,
				...(typeof body.code === "string" ? { code: body.code } : {}),
			};
		}
	} catch {
		// fall through
	}
	return { message: `HTTP ${res.status}` };
}

function joinUrl(base: string, path: string): string {
	const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
	const suffix = path.startsWith("/") ? path : `/${path}`;
	return `${trimmed}${suffix}`;
}
