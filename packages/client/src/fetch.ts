import { AgntzError, AuthenticationError, NotFoundError } from "./errors.js";

export interface RequestArgs {
  baseUrl: string;
  path: string;
  method: "GET" | "POST" | "DELETE";
  apiKey?: string;
  body?: unknown;
  signal?: AbortSignal;
  accept?: string;
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
  const headers: Record<string, string> = {};
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

async function toError(res: Response): Promise<AgntzError> {
  const message = await readErrorMessage(res);
  const init = { status: res.status };
  if (res.status === 401) return new AuthenticationError(message, init);
  if (res.status === 404) return new NotFoundError(message, init);
  return new AgntzError(message, init);
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // fall through
  }
  return `HTTP ${res.status}`;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}
