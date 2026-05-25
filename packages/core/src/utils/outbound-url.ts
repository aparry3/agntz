/**
 * Shared outbound URL policy for server-side fetches that may include
 * user-controlled targets. It blocks localhost, private/link-local networks,
 * cloud metadata addresses, and unsafe redirect targets.
 */

const DEFAULT_MAX_REDIRECTS = 5;

const LOCALHOST_NAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
]);

export class OutboundUrlPolicyError extends Error {
  readonly code: string;
  readonly url?: string;

  constructor(message: string, opts?: { code?: string; url?: string; cause?: unknown }) {
    super(message);
    this.name = "OutboundUrlPolicyError";
    this.code = opts?.code ?? "outbound_url_rejected";
    this.url = opts?.url;
    if (opts?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export interface OutboundUrlPolicyOptions {
  /**
   * Permit private, loopback, link-local, and metadata hosts. Defaults false.
   * Intended for trusted local SDK use and tests, not hosted multi-tenant use.
   */
  allowPrivateNetwork?: boolean;
  /** Permit http:// URLs. Defaults true because many MCP/http integrations use HTTP. */
  allowHttp?: boolean;
  /** Skip DNS resolution checks and only validate literal hosts. Defaults false. */
  skipDnsResolution?: boolean;
  /** Override DNS resolution in tests. Return all A/AAAA addresses for hostname. */
  resolveHostname?: (hostname: string) => Promise<string[]> | string[];
}

export interface FetchWithOutboundPolicyOptions {
  fetchImpl?: typeof fetch;
  policy?: OutboundUrlPolicyOptions;
  maxRedirects?: number;
}

export function validateOutboundUrl(
  input: string | URL,
  options: OutboundUrlPolicyOptions = {},
): URL {
  let parsed: URL;
  const raw = input instanceof URL ? input.toString() : input;
  try {
    parsed = input instanceof URL ? new URL(input.toString()) : new URL(input);
  } catch (cause) {
    throw new OutboundUrlPolicyError(`Invalid outbound URL: ${raw}`, {
      code: "invalid_url",
      url: raw,
      cause,
    });
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "https:" && !(options.allowHttp !== false && protocol === "http:")) {
    throw new OutboundUrlPolicyError(`Disallowed URL scheme: ${parsed.protocol}`, {
      code: "disallowed_scheme",
      url: raw,
    });
  }

  if (!parsed.hostname) {
    throw new OutboundUrlPolicyError("Outbound URL must include a hostname", {
      code: "missing_host",
      url: raw,
    });
  }

  assertHostAllowed(parsed.hostname, raw, options);
  return parsed;
}

export async function assertOutboundUrlAllowed(
  input: string | URL,
  options: OutboundUrlPolicyOptions = {},
): Promise<URL> {
  const parsed = validateOutboundUrl(input, options);
  if (options.allowPrivateNetwork || options.skipDnsResolution) {
    return parsed;
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isIpLiteral(hostname)) {
    return parsed;
  }

  const addresses = await resolveHostname(hostname, options);
  if (addresses.length === 0) {
    throw new OutboundUrlPolicyError(`Hostname did not resolve: ${hostname}`, {
      code: "dns_no_records",
      url: parsed.toString(),
    });
  }

  for (const address of addresses) {
    assertHostAllowed(address, parsed.toString(), options);
  }

  return parsed;
}

export async function fetchWithOutboundPolicy(
  input: string | URL,
  init: RequestInit = {},
  options: FetchWithOutboundPolicyOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new OutboundUrlPolicyError("No fetch implementation available", {
      code: "no_fetch",
      url: input instanceof URL ? input.toString() : input,
    });
  }

  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = await assertOutboundUrlAllowed(input, options.policy);
  let currentInit: RequestInit = { ...init, redirect: "manual" };

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const response = await fetchImpl(currentUrl.toString(), currentInit);
    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    if (redirects === maxRedirects) {
      throw new OutboundUrlPolicyError(`Too many redirects; max is ${maxRedirects}`, {
        code: "too_many_redirects",
        url: currentUrl.toString(),
      });
    }

    const nextUrl = await assertOutboundUrlAllowed(
      new URL(location, currentUrl),
      options.policy,
    );
    if (nextUrl.origin !== currentUrl.origin) {
      throw new OutboundUrlPolicyError(
        `Cross-origin redirects are not allowed: ${currentUrl.origin} -> ${nextUrl.origin}`,
        { code: "cross_origin_redirect", url: currentUrl.toString() },
      );
    }

    currentInit = redirectInit(currentInit, response.status);
    currentUrl = nextUrl;
  }

  throw new OutboundUrlPolicyError(`Too many redirects; max is ${maxRedirects}`, {
    code: "too_many_redirects",
    url: currentUrl.toString(),
  });
}

function assertHostAllowed(
  hostname: string,
  url: string,
  options: OutboundUrlPolicyOptions,
): void {
  if (options.allowPrivateNetwork) return;

  const host = normalizeHostname(hostname);
  if (LOCALHOST_NAMES.has(host) || host.endsWith(".localhost")) {
    throw new OutboundUrlPolicyError(`Disallowed hostname: ${host}`, {
      code: "disallowed_host",
      url,
    });
  }

  if (host.includes(":")) {
    if (isDisallowedIPv6(host)) {
      throw new OutboundUrlPolicyError(`Disallowed IP address: ${host}`, {
        code: "disallowed_host",
        url,
      });
    }
    return;
  }

  const ipv4 = parseIPv4(host);
  if (ipv4) {
    if (isDisallowedIPv4(ipv4)) {
      throw new OutboundUrlPolicyError(`Disallowed IP address: ${host}`, {
        code: "disallowed_host",
        url,
      });
    }
  }
}

function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  return host;
}

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(":") || parseIPv4(hostname) != null;
}

function parseIPv4(hostname: string): [number, number, number, number] | null {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map((n) => Number.parseInt(n, 10));
  if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    throw new OutboundUrlPolicyError(`Invalid IPv4 address: ${hostname}`, {
      code: "invalid_ipv4",
      url: hostname,
    });
  }
  return octets as [number, number, number, number];
}

function isDisallowedIPv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isDisallowedIPv6(hostname: string): boolean {
  const host = hostname.toLowerCase().split("%")[0];
  const groups = expandIPv6(host);
  if (!groups) return false;

  const allZero = groups.every((group) => group === 0);
  if (allZero) return true;

  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  if (loopback) return true;

  const mappedIPv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mappedIPv4) {
    const a = groups[6] >> 8;
    const b = groups[6] & 0xff;
    const c = groups[7] >> 8;
    const d = groups[7] & 0xff;
    return isDisallowedIPv4([a, b, c, d]);
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

function expandIPv6(hostname: string): number[] | null {
  const ipv4Match = hostname.match(/(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  let host = hostname;
  let embeddedGroups: number[] = [];
  if (ipv4Match) {
    const ipv4 = parseIPv4(ipv4Match[2]);
    if (!ipv4) return null;
    embeddedGroups = [(ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]];
    host = `${ipv4Match[1]}ipv4`;
  }

  const halves = host.split("::");
  if (halves.length > 2) return null;

  const parsePart = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const groups: number[] = [];
    for (const raw of part.split(":")) {
      if (raw === "ipv4") {
        groups.push(...embeddedGroups);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(raw)) return null;
      groups.push(Number.parseInt(raw, 16));
    }
    return groups;
  };

  const left = parsePart(halves[0]);
  const right = parsePart(halves[1] ?? "");
  if (!left || !right) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

async function resolveHostname(
  hostname: string,
  options: OutboundUrlPolicyOptions,
): Promise<string[]> {
  if (options.resolveHostname) {
    return await options.resolveHostname(hostname);
  }
  try {
    const dns = await import("node:dns/promises");
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch (cause) {
    throw new OutboundUrlPolicyError(`Hostname resolution failed: ${hostname}`, {
      code: "dns_resolution_failed",
      url: hostname,
      cause,
    });
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function redirectInit(init: RequestInit, status: number): RequestInit {
  const next: RequestInit = { ...init, redirect: "manual" };
  const method = (next.method ?? "GET").toUpperCase();
  if ((status === 301 || status === 302 || status === 303) && method !== "GET" && method !== "HEAD") {
    next.method = "GET";
    delete next.body;
    const headers = new Headers(next.headers);
    headers.delete("content-length");
    headers.delete("content-type");
    next.headers = headers;
  }
  return next;
}
