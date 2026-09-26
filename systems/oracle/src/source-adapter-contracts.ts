import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { OracleSourcePolicy } from "./contracts";

export type OracleLifecycleMarketStatus = "draft" | "open" | "closed" | "resolved" | "voided";

export type OracleContractCapabilityStatus =
  | "supported_full_cycle"
  | "supported_final_only"
  | "credible_reporting"
  | "manual_resolution_required"
  | "blocked";

export type OracleMarketContractV1 = {
  objectType: "market_contract_v1";
  marketKindId?: string;
  measurement?: string;
  measurementKind?: string;
  resultShape?: string;
  oracleCapability?: OracleContractCapabilityStatus;
  trustDisplayUrl?: string;
  machineResolutionEndpoint?: string;
  lifecycleFit?:
    | "event_full_cycle"
    | "scheduled_measurement"
    | "credible_reporting"
    | "manual_exception";
  allowFallbackResolution?: boolean;
  fallbackEvidenceStandard?: string;
  resolutionSource?: {
    label?: string;
    url?: string | null;
    sourceIds?: string[];
  };
  resolutionRule?: string;
  resolutionAuthorityType?: "official" | "canonical-data" | "credible-reporting" | "platform-defined";
  credibleReporting?: {
    minimumIndependentSources?: number;
    approvedSourceIds?: string[];
    conflictPolicy?: string;
    correctionWindow?: string;
    requiresHumanReview?: boolean;
    allowSingleSourceEvidence?: boolean;
  };
  timeline?: {
    closeAt?: string | null;
    expectedResolutionAt?: string | null;
    [key: string]: unknown;
  };
  outcomeMap?: Array<{
    outcomeLabel?: string;
    evidenceKey?: string;
    resolutionPath?: string;
  }>;
};

export type OracleLifecycleSourceContext = {
  marketId: string;
  marketTitle: string;
  marketStatus: OracleLifecycleMarketStatus;
  closeAt: string;
  closeOnEventCompletion: boolean;
  eventCompletionCloseRequiresHumanApproval: boolean;
  resolutionSource: string;
  resolutionRules: string;
  oracleSourcePolicy: OracleSourcePolicy | null;
  marketContract: OracleMarketContractV1 | null;
  outcomes: Array<{
    outcomeId: string;
    outcomeKey: string;
    label: string;
  }>;
};

export type OracleSourceEventStatus =
  | "not_started"
  | "live"
  | "final"
  | "postponed"
  | "suspended"
  | "unknown";

export type OracleSourceWinnerKind = "home" | "away" | "draw" | "named" | "unknown";

export type OracleSourceInspection = {
  objectType: "oracle_source_inspection";
  sourceFamily: string;
  sourceUrl: string;
  status: OracleSourceEventStatus;
  closeConditionSatisfied: boolean;
  resolutionAvailable: boolean;
  evidenceKey?: string;
  winnerKind?: OracleSourceWinnerKind;
  winnerLabel?: string;
  score?: {
    home?: number;
    away?: number;
    [key: string]: number | undefined;
  };
  officialJsonUrl?: string | null;
  fetchedAt: string;
  rawHash: string;
  normalizedSnapshot: Record<string, unknown>;
  claimSummary: string;
  confidence: "low" | "medium" | "high";
  blockers: string[];
};

export type OracleSourceAdapterFetchers = {
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<string>;
  now?: Date;
};

export type OracleAdapterFetchOptions = {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: BodyInit;
  allowedHosts?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  nullOnNoContent?: boolean;
  nullOnEmptyBody?: boolean;
  now?: () => number;
  lookup?: (hostname: string, options: { all: true }) => Promise<
    Array<{ address: string; family: number }>
  >;
};

const DEFAULT_ADAPTER_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_ADAPTER_FETCH_MAX_BYTES = 2_000_000;
const DEFAULT_ADAPTER_FETCH_MAX_REDIRECTS = 5;
const defaultOracleAdapterLookup = (
  hostname: string,
  options: { all: true }
): Promise<Array<{ address: string; family: number }>> => {
  return lookup(hostname, options);
};

export type OracleLifecycleSourceAdapter = {
  sourceFamily: string;
  sourceLabel: string;
  sourceIds: string[];
  measurementKinds: string[];
  resultShapes: string[];
  routes?: Array<{
    measurementKind: string;
    resultShape: string;
  }>;
  requiredEnvVars?: string[];
  capabilities: {
    closeCondition: boolean;
    resolution: boolean;
  };
  supportsSource(context: OracleLifecycleSourceContext): boolean;
  inspectCloseCondition(
    context: OracleLifecycleSourceContext,
    fetchers: OracleSourceAdapterFetchers
  ): Promise<OracleSourceInspection>;
  inspectResolution(
    context: OracleLifecycleSourceContext,
    fetchers: OracleSourceAdapterFetchers
  ): Promise<OracleSourceInspection>;
};

export function stableJson(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function hashRawSnapshot(value: unknown): string {
  const raw = typeof value === "string" ? value : stableJson(value);
  return createHash("sha256").update(raw).digest("hex");
}

function normalizeIpv4Address(address: string): string {
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

function normalizeIpHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isBlockedIpv4Address(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  );
}

function isBlockedIpv6Address(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    return isBlockedIpv4Address(normalizeIpv4Address(normalized));
  }

  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

function isBlockedIpAddress(address: string): boolean {
  const normalized = normalizeIpv4Address(address);
  const ipVersion = isIP(normalized);

  if (ipVersion === 4) {
    return isBlockedIpv4Address(normalized);
  }

  if (ipVersion === 6) {
    return isBlockedIpv6Address(normalized);
  }

  return true;
}

export function isAllowedOracleAdapterHost(hostname: string, allowedHosts?: string[]): boolean {
  if (!allowedHosts || allowedHosts.length === 0) {
    return true;
  }

  const normalizedHostname = hostname.toLowerCase();

  return allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = allowedHost.trim().toLowerCase();

    if (!normalizedAllowedHost) {
      return false;
    }

    if (normalizedAllowedHost.startsWith(".")) {
      const suffix = normalizedAllowedHost.slice(1);
      return normalizedHostname === suffix || normalizedHostname.endsWith(normalizedAllowedHost);
    }

    return normalizedHostname === normalizedAllowedHost;
  });
}

export function assertSafeOracleAdapterUrl(rawUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Oracle adapter fetch URL is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Oracle adapter fetch URL must use https.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Oracle adapter fetch URL must not include credentials.");
  }

  if (!parsed.hostname) {
    throw new Error("Oracle adapter fetch URL must include a hostname.");
  }

  const ipHostname = normalizeIpHost(parsed.hostname);

  if (isIP(ipHostname) && isBlockedIpAddress(ipHostname)) {
    throw new Error("Oracle adapter fetch URL points to a blocked network address.");
  }

  return parsed;
}

async function assertOracleAdapterHostIsPublic(
  parsedUrl: URL,
  deadlineMs: number,
  now: () => number,
  resolvePublicHost: (hostname: string, options: { all: true }) => Promise<
    Array<{ address: string; family: number }>
  >
): Promise<void> {
  const ipHostname = normalizeIpHost(parsedUrl.hostname);

  if (isIP(ipHostname)) {
    return;
  }

  const addresses = await raceAgainstDeadline(
    resolvePublicHost(parsedUrl.hostname, { all: true }),
    deadlineMs,
    now,
    "Oracle adapter fetch request timed out."
  );

  if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new Error("Oracle adapter fetch URL resolves to a blocked network address.");
  }
}

async function readLimitedResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers?.get?.("content-length") ?? null;

  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    throw new Error("Oracle adapter fetch response is too large.");
  }

  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("Oracle adapter fetch response is too large.");
    }

    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

function cancelOracleAdapterRedirectResponseBody(response: Response): Promise<void> | void {
  if (response.body) {
    return response.body.cancel();
  }
}

function createOracleAdapterFetchSignal(deadlineMs: number, now: () => number): AbortSignal {
  const remainingMs = deadlineMs - now();
  if (remainingMs <= 0) {
    throw new Error("Oracle adapter fetch request timed out.");
  }

  return AbortSignal.timeout(remainingMs);
}

function raceAgainstDeadline<T>(
  operation: Promise<T>,
  deadlineMs: number,
  now: () => number,
  timeoutMessage: string
): Promise<T> {
  const remainingMs = deadlineMs - now();
  if (remainingMs <= 0) {
    throw new Error(timeoutMessage);
  }

  const timeoutController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let onTimeout: () => void = () => {};

  const timeoutPromise = new Promise<never>((_, reject) => {
    onTimeout = () => reject(new Error(timeoutMessage));
    timeoutController.signal.addEventListener("abort", onTimeout, { once: true });
    timeoutId = setTimeout(() => timeoutController.abort(), remainingMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutController.signal.removeEventListener("abort", onTimeout);
  });
}

async function safeOracleAdapterFetch(url: string, options: OracleAdapterFetchOptions): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ADAPTER_FETCH_TIMEOUT_MS;
  const maxRedirects = DEFAULT_ADAPTER_FETCH_MAX_REDIRECTS;
  const now = options.now ?? Date.now;
  const deadlineMs = now() + timeoutMs;
  const resolvePublicHost = options.lookup ?? defaultOracleAdapterLookup;
  const method = options.method ?? "GET";

  let currentUrl = assertSafeOracleAdapterUrl(url);
  let redirects = 0;

  while (true) {
    currentUrl = assertSafeOracleAdapterUrl(currentUrl.toString());

    if (!isAllowedOracleAdapterHost(currentUrl.hostname, options.allowedHosts)) {
      throw new Error("Oracle adapter fetch URL host is not allowed for this source.");
    }

    await assertOracleAdapterHostIsPublic(currentUrl, deadlineMs, now, resolvePublicHost);

    const response = await fetch(currentUrl.toString(), {
      method,
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      signal: createOracleAdapterFetchSignal(deadlineMs, now)
    });

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      await cancelOracleAdapterRedirectResponseBody(response);
      throw new Error("Oracle adapter fetch response is missing redirect location.");
    }

    if (method !== "GET" && method !== "HEAD") {
      await cancelOracleAdapterRedirectResponseBody(response);
      throw new Error("Oracle adapter fetch method does not allow redirect follow.");
    }

    if (redirects >= maxRedirects) {
      await cancelOracleAdapterRedirectResponseBody(response);
      throw new Error("Oracle adapter fetch exceeded redirect limit.");
    }

    await cancelOracleAdapterRedirectResponseBody(response);

    redirects += 1;
    currentUrl = new URL(location, currentUrl);
  }
}

export async function fetchOracleAdapterText(url: string, options: OracleAdapterFetchOptions = {}): Promise<string> {
  const response = await safeOracleAdapterFetch(url, options);

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}`);
  }

  return readLimitedResponseText(response, options.maxBytes ?? DEFAULT_ADAPTER_FETCH_MAX_BYTES);
}

export async function fetchOracleAdapterJson(url: string, options: OracleAdapterFetchOptions = {}): Promise<unknown> {
  const response = await safeOracleAdapterFetch(url, options);

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}`);
  }

  if (options.nullOnNoContent && response.status === 204) {
    return null;
  }

  if (options.nullOnEmptyBody) {
    const body = await readLimitedResponseText(response, options.maxBytes ?? DEFAULT_ADAPTER_FETCH_MAX_BYTES);
    return body.trim() ? JSON.parse(body) : null;
  }

  const body = await readLimitedResponseText(response, options.maxBytes ?? DEFAULT_ADAPTER_FETCH_MAX_BYTES);
  return JSON.parse(body);
}

export function readSourceHaystack(context: OracleLifecycleSourceContext): string {
  return [
    context.resolutionSource,
    context.resolutionRules,
    JSON.stringify(context.oracleSourcePolicy ?? {}),
    JSON.stringify(context.marketContract ?? {})
  ]
    .filter(Boolean)
    .join("\n");
}

export function readContractSourceIds(context: OracleLifecycleSourceContext): string[] {
  return [
    ...(context.marketContract?.resolutionSource?.sourceIds ?? []),
    ...(context.oracleSourcePolicy?.resolutionSourceIds ?? []),
    ...(context.oracleSourcePolicy?.preferredSourceIds ?? [])
  ].filter((value, index, values) => value.trim().length > 0 && values.indexOf(value) === index);
}

export function readContractResolutionSourceUrl(context: OracleLifecycleSourceContext): string | null {
  const url = context.marketContract?.resolutionSource?.url;
  return typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
}

export function normalizeMarketContract(value: unknown): OracleMarketContractV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as OracleMarketContractV1;
  return candidate.objectType === "market_contract_v1" ? candidate : null;
}

export function defaultFetchedAt(fetchers: OracleSourceAdapterFetchers): string {
  return (fetchers.now ?? new Date()).toISOString();
}

export function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
