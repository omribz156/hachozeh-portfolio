import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { Queryable } from "../db/client/pool";
import type { MarketWatchNotifier } from "./notifier";
import {
  detectShowOfficialKeywordSignals,
  type MarketWatchSignal
} from "./show-official-keyword-detector";

export { detectShowOfficialKeywordSignals } from "./show-official-keyword-detector";
export type { MarketWatchSignal } from "./show-official-keyword-detector";

export type MarketWatchCheckerKind = "show_official_keywords";

export type MarketWatchPlan = {
  id: string;
  marketId: string | null;
  eventId: string | null;
  checkerKind: MarketWatchCheckerKind;
  enabled: boolean;
  timezone: string;
  runPolicy: Record<string, unknown>;
  nextRunAt: string | null;
  sourceUrls: string[];
  entities: string[];
  keywords: string[];
  lastCheckedAt: string | null;
  lastAlertFingerprint: string | null;
  note: string | null;
};

export type MarketWatchCasePromotionResult =
  | {
      status: "promoted";
      marketId: string;
      oracleCaseId: string;
    }
  | {
      status: "not_actionable";
      code: string;
    }
  | {
      status: "blocked";
      code: string;
      detail: string;
    };

export type MarketWatchCasePromoter = (input: {
  signalId: string;
  plan: Pick<MarketWatchPlan, "marketId" | "eventId">;
  signal: MarketWatchSignal;
}) => Promise<MarketWatchCasePromotionResult>;

export type MarketWatchScanResult = {
  objectType: "market_watch_scan_result";
  generatedAt: string;
  duePlanCount: number;
  checkedPlanCount: number;
  fetchedUrlCount: number;
  createdSignalCount: number;
  sentCount: number;
  failedSendCount: number;
  skippedDuplicateCount: number;
  promotedCaseCount: number;
  caseBridgeBlockedCount: number;
  planResults: MarketWatchPlanResult[];
};

export type MarketWatchPlanResult = {
  planId: string;
  checkerKind: string;
  sourceUrlCount: number;
  candidateSignalCount: number;
  createdSignalCount: number;
  skippedDuplicateCount: number;
  sentCount: number;
  failedSendCount: number;
  promotedCaseCount: number;
  caseBridgeBlockedCount: number;
  nextRunAt: string | null;
  errors: string[];
};

export type MarketWatchFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text: string;
}>;

type MarketWatchFetchOptions = {
  timeoutMs?: number;
  now?: () => number;
  lookup?: (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>;
};

type MarketWatchPlanRow = {
  id: string;
  market_id: string | null;
  event_id: string | null;
  checker_kind: string;
  enabled: boolean;
  timezone: string;
  run_policy: Record<string, unknown> | null;
  next_run_at: Date | string | null;
  source_urls: unknown;
  entities: unknown;
  keywords: unknown;
  last_checked_at: Date | string | null;
  last_alert_fingerprint: string | null;
  note: string | null;
};

type InsertedSignalRow = {
  id: string;
  fingerprint: string;
  status: "new" | "dismissed" | "promoted";
  oracle_case_id: string | null;
};

const DEFAULT_FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_FETCH_MAX_BYTES = 1_000_000;
const DEFAULT_FETCH_MAX_REDIRECTS = 5;
const defaultMarketWatchLookup = (
  hostname: string,
  options: { all: true }
): Promise<Array<{ address: string; family: number }>> => {
  return lookup(hostname, options);
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function rowToPlan(row: MarketWatchPlanRow): MarketWatchPlan {
  return {
    id: row.id,
    marketId: row.market_id,
    eventId: row.event_id,
    checkerKind: row.checker_kind as MarketWatchCheckerKind,
    enabled: row.enabled,
    timezone: row.timezone,
    runPolicy: row.run_policy ?? {},
    nextRunAt: asIso(row.next_run_at),
    sourceUrls: asStringArray(row.source_urls),
    entities: asStringArray(row.entities),
    keywords: asStringArray(row.keywords),
    lastCheckedAt: asIso(row.last_checked_at),
    lastAlertFingerprint: row.last_alert_fingerprint,
    note: row.note
  };
}

export async function defaultMarketWatchFetch(
  url: string,
  options: MarketWatchFetchOptions = {}
): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await safeMarketWatchFetch(url, {
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    ...options
  });

  return {
    ok: response.ok,
    status: response.status,
    text: await readLimitedResponseText(response, DEFAULT_FETCH_MAX_BYTES)
  };
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

function assertSafeMarketWatchUrl(rawUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Market Watch fetch URL is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Market Watch fetch URL must use https.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Market Watch fetch URL must not include credentials.");
  }

  if (!parsed.hostname) {
    throw new Error("Market Watch fetch URL must include a hostname.");
  }

  const ipHostname = normalizeIpHost(parsed.hostname);
  if (isIP(ipHostname) && isBlockedIpAddress(ipHostname)) {
    throw new Error("Market Watch fetch URL points to a blocked network address.");
  }

  return parsed;
}

async function assertMarketWatchHostIsPublic(
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
    "Market Watch fetch request timed out."
  );

  if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new Error("Market Watch fetch URL resolves to a blocked network address.");
  }
}

function createMarketWatchSignal(deadlineMs: number, now: () => number): AbortSignal {
  const remainingMs = deadlineMs - now();
  if (remainingMs <= 0) {
    throw new Error("Market Watch fetch request timed out.");
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

async function readLimitedResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers?.get?.("content-length") ?? null;

  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    throw new Error("Market Watch fetch response is too large.");
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
      throw new Error("Market Watch fetch response is too large.");
    }

    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

function cancelRedirectResponseBody(response: Response): Promise<void> | void {
  if (response.body) {
    return response.body.cancel();
  }
}

async function safeMarketWatchFetch(url: string, options: MarketWatchFetchOptions): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const deadlineMs = now() + timeoutMs;
  const lookupHost = options.lookup ?? defaultMarketWatchLookup;
  let redirects = 0;

  let currentUrl = assertSafeMarketWatchUrl(url);

  while (true) {
    await assertMarketWatchHostIsPublic(currentUrl, deadlineMs, now, lookupHost);

    const response = await fetch(currentUrl, {
      headers: {
        "user-agent": "HachozehMarketWatch/1.0 (+https://hachozeh.com)"
      },
      redirect: "manual",
      signal: createMarketWatchSignal(deadlineMs, now)
    });

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      await cancelRedirectResponseBody(response);
      throw new Error("Market Watch fetch response is missing redirect location.");
    }

    if (redirects >= DEFAULT_FETCH_MAX_REDIRECTS) {
      await cancelRedirectResponseBody(response);
      throw new Error("Market Watch fetch exceeded redirect limit.");
    }

    await cancelRedirectResponseBody(response);

    redirects += 1;
    currentUrl = new URL(location, currentUrl);
    currentUrl = assertSafeMarketWatchUrl(currentUrl.toString());
  }
}

export async function readDueMarketWatchPlans(
  db: Queryable,
  options?: {
    now?: string;
    limit?: number;
  }
): Promise<MarketWatchPlan[]> {
  const result = await db.query<MarketWatchPlanRow>(
    `
      select
        id,
        market_id,
        event_id,
        checker_kind,
        enabled,
        timezone,
        run_policy,
        next_run_at,
        source_urls,
        entities,
        keywords,
        last_checked_at,
        last_alert_fingerprint,
        note
      from market_watch_plans
      where enabled = true
        and next_run_at is not null
        and next_run_at <= coalesce($1::timestamptz, now())
      order by next_run_at asc, id asc
      limit $2
    `,
    [options?.now ?? null, options?.limit ?? 25]
  );

  return result.rows.map(rowToPlan);
}

function computeNextRunAt(runPolicy: Record<string, unknown>, nowIso: string): string | null {
  const nowMs = Date.parse(nowIso);
  const runAt = asStringArray(runPolicy.runAt);
  const futureRunAt = runAt
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()) && date.getTime() > nowMs + 1000)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  if (futureRunAt) {
    return futureRunAt.toISOString();
  }

  const intervalMinutes = runPolicy.intervalMinutes;
  if (typeof intervalMinutes === "number" && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    return new Date(nowMs + Math.round(intervalMinutes * 60_000)).toISOString();
  }

  return null;
}

async function updatePlanAfterRun(
  db: Queryable,
  plan: MarketWatchPlan,
  input: {
    checkedAt: string;
    nextRunAt: string | null;
    lastAlertFingerprint: string | null;
  }
): Promise<void> {
  await db.query(
    `
      update market_watch_plans
      set last_checked_at = $2,
          next_run_at = $3,
          enabled = case when $3::timestamptz is null then false else enabled end,
          last_alert_fingerprint = coalesce($4, last_alert_fingerprint),
          updated_at = now()
      where id = $1
    `,
    [plan.id, input.checkedAt, input.nextRunAt, input.lastAlertFingerprint]
  );
}

async function insertSignal(
  db: Queryable,
  plan: MarketWatchPlan,
  signal: MarketWatchSignal
): Promise<InsertedSignalRow | null> {
  const result = await db.query<InsertedSignalRow>(
    `
      insert into market_watch_signals (
        id,
        watch_plan_id,
        market_id,
        event_id,
        signal_kind,
        matched_entity,
        matched_keyword,
        source_url,
        source_title,
        summary,
        fingerprint,
        observed_at,
        payload_snapshot
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
      on conflict (watch_plan_id, fingerprint) do nothing
      returning id, fingerprint, status, oracle_case_id
    `,
    [
      `mws_${randomUUID()}`,
      plan.id,
      plan.marketId,
      plan.eventId,
      signal.signalKind,
      signal.matchedEntity,
      signal.matchedKeyword,
      signal.sourceUrl,
      signal.sourceTitle,
      signal.summary,
      signal.fingerprint,
      signal.observedAt,
      JSON.stringify(signal.payload)
    ]
  );

  return result.rows[0] ?? null;
}

async function readExistingSignal(
  db: Queryable,
  planId: string,
  fingerprint: string
): Promise<InsertedSignalRow | null> {
  const result = await db.query<InsertedSignalRow>(
    `
      select id, fingerprint, status, oracle_case_id
      from market_watch_signals
      where watch_plan_id = $1
        and fingerprint = $2
      limit 1
    `,
    [planId, fingerprint]
  );

  return result.rows[0] ?? null;
}

async function updateSignalPromotion(
  db: Queryable,
  signalId: string,
  input: {
    oracleCaseId?: string | null;
    promotionError?: string | null;
  }
): Promise<void> {
  await db.query(
    `
      update market_watch_signals
      set status = case when $2::text is not null then 'promoted' else status end,
          oracle_case_id = $2,
          promotion_error = $3,
          updated_at = now()
      where id = $1
    `,
    [signalId, input.oracleCaseId ?? null, input.promotionError ?? null]
  );
}

async function updateSignalDelivery(
  db: Queryable,
  signalId: string,
  input: {
    deliveryStatus: "sent" | "failed" | "skipped";
    deliveryError?: string | null;
  }
): Promise<void> {
  await db.query(
    `
      update market_watch_signals
      set delivery_status = $2,
          delivery_error = $3,
          updated_at = now()
      where id = $1
    `,
    [signalId, input.deliveryStatus, input.deliveryError ?? null]
  );
}

async function scanPlan(input: {
  db: Queryable;
  plan: MarketWatchPlan;
  observedAt: string;
  fetcher: MarketWatchFetch;
  notifier: MarketWatchNotifier | null;
  casePromoter: MarketWatchCasePromoter | null;
  dryRun?: boolean;
}): Promise<MarketWatchPlanResult> {
  const result: MarketWatchPlanResult = {
    planId: input.plan.id,
    checkerKind: input.plan.checkerKind,
    sourceUrlCount: input.plan.sourceUrls.length,
    candidateSignalCount: 0,
    createdSignalCount: 0,
    skippedDuplicateCount: 0,
    sentCount: 0,
    failedSendCount: 0,
    promotedCaseCount: 0,
    caseBridgeBlockedCount: 0,
    nextRunAt: computeNextRunAt(input.plan.runPolicy, input.observedAt),
    errors: []
  };
  let lastAlertFingerprint: string | null = null;

  for (const sourceUrl of input.plan.sourceUrls) {
    try {
      const fetched = await input.fetcher(sourceUrl);
      if (!fetched.ok) {
        result.errors.push(`${sourceUrl}: http_${fetched.status}`);
        continue;
      }

      const signals = detectShowOfficialKeywordSignals({
        plan: input.plan,
        sourceUrl,
        html: fetched.text,
        observedAt: input.observedAt
      });
      result.candidateSignalCount += signals.length;

      for (const signal of signals) {
        if (input.dryRun) {
          result.createdSignalCount += 1;
          continue;
        }

        const inserted = await insertSignal(input.db, input.plan, signal);
        const created = inserted !== null;
        const storedSignal = inserted ?? await readExistingSignal(
          input.db,
          input.plan.id,
          signal.fingerprint
        );

        if (!created) {
          result.skippedDuplicateCount += 1;
        }

        if (!storedSignal) {
          result.errors.push(`signal_not_found_after_insert: ${signal.fingerprint}`);
          continue;
        }

        if (created) {
          result.createdSignalCount += 1;
          lastAlertFingerprint = signal.fingerprint;
        }

        let notificationSummary = signal.summary;
        let suggestedHumanPrompt = `check market watch signal ${storedSignal.id}`;
        let notificationKind: "watch_signal" | "market_case_ready" = "watch_signal";
        let shouldNotify = created;

        if (
          input.casePromoter &&
          storedSignal.status === "new" &&
          !storedSignal.oracle_case_id
        ) {
          try {
            const promotion = await input.casePromoter({
              signalId: storedSignal.id,
              plan: input.plan,
              signal
            });

            if (promotion.status === "promoted") {
              await updateSignalPromotion(input.db, storedSignal.id, {
                oracleCaseId: promotion.oracleCaseId
              });
              result.promotedCaseCount += 1;
              notificationSummary = `market case ready: ${signal.matchedEntity} requires close-condition review.`;
              suggestedHumanPrompt = `review Oracle close-condition case ${promotion.oracleCaseId}`;
              notificationKind = "market_case_ready";
              shouldNotify = true;
            } else if (promotion.status === "blocked") {
              await updateSignalPromotion(input.db, storedSignal.id, {
                promotionError: `${promotion.code}: ${promotion.detail}`.slice(0, 1000)
              });
              result.caseBridgeBlockedCount += 1;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await updateSignalPromotion(input.db, storedSignal.id, {
              promotionError: message.slice(0, 1000)
            });
            result.caseBridgeBlockedCount += 1;
          }
        }

        if (!shouldNotify) {
          continue;
        }

        if (!input.notifier) {
          await updateSignalDelivery(input.db, storedSignal.id, { deliveryStatus: "skipped" });
          continue;
        }

        try {
          await input.notifier.send({
            kind: notificationKind,
            planId: input.plan.id,
            summary: notificationSummary,
            sourceUrl: signal.sourceUrl,
            suggestedHumanPrompt
          });
          await updateSignalDelivery(input.db, storedSignal.id, { deliveryStatus: "sent" });
          result.sentCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await updateSignalDelivery(input.db, storedSignal.id, {
            deliveryStatus: "failed",
            deliveryError: message.slice(0, 1000)
          });
          result.failedSendCount += 1;
        }
      }
    } catch (error) {
      result.errors.push(`${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!input.dryRun) {
    await updatePlanAfterRun(input.db, input.plan, {
      checkedAt: input.observedAt,
      nextRunAt: result.nextRunAt,
      lastAlertFingerprint
    });
  }

  return result;
}

export async function scanDueMarketWatchPlans(
  db: Queryable,
  input?: {
    now?: string;
    limit?: number;
    fetcher?: MarketWatchFetch;
    notifier?: MarketWatchNotifier | null;
    casePromoter?: MarketWatchCasePromoter | null;
    dryRun?: boolean;
  }
): Promise<MarketWatchScanResult> {
  const generatedAt = input?.now ?? new Date().toISOString();
  const plans = await readDueMarketWatchPlans(db, {
    now: generatedAt,
    limit: input?.limit
  });
  const fetcher = input?.fetcher ?? defaultMarketWatchFetch;
  const planResults: MarketWatchPlanResult[] = [];

  for (const plan of plans) {
    planResults.push(await scanPlan({
      db,
      plan,
      observedAt: generatedAt,
      fetcher,
      notifier: input?.notifier ?? null,
      casePromoter: input?.casePromoter ?? null,
      dryRun: input?.dryRun
    }));
  }

  return {
    objectType: "market_watch_scan_result",
    generatedAt,
    duePlanCount: plans.length,
    checkedPlanCount: planResults.length,
    fetchedUrlCount: planResults.reduce((sum, plan) => sum + plan.sourceUrlCount, 0),
    createdSignalCount: planResults.reduce((sum, plan) => sum + plan.createdSignalCount, 0),
    sentCount: planResults.reduce((sum, plan) => sum + plan.sentCount, 0),
    failedSendCount: planResults.reduce((sum, plan) => sum + plan.failedSendCount, 0),
    skippedDuplicateCount: planResults.reduce((sum, plan) => sum + plan.skippedDuplicateCount, 0),
    promotedCaseCount: planResults.reduce((sum, plan) => sum + plan.promotedCaseCount, 0),
    caseBridgeBlockedCount: planResults.reduce((sum, plan) => sum + plan.caseBridgeBlockedCount, 0),
    planResults
  };
}

export async function upsertMarketWatchPlan(
  db: Queryable,
  input: {
    id: string;
    marketId?: string | null;
    eventId?: string | null;
    checkerKind: MarketWatchCheckerKind;
    enabled: boolean;
    timezone: string;
    runPolicy: Record<string, unknown>;
    nextRunAt?: string | null;
    sourceUrls: string[];
    entities: string[];
    keywords: string[];
    note?: string | null;
  }
): Promise<MarketWatchPlan> {
  if (!input.marketId && !input.eventId) {
    throw new Error("marketId or eventId is required.");
  }

  const result = await db.query<MarketWatchPlanRow>(
    `
      insert into market_watch_plans (
        id,
        market_id,
        event_id,
        checker_kind,
        enabled,
        timezone,
        run_policy,
        next_run_at,
        source_urls,
        entities,
        keywords,
        note
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)
      on conflict (id)
      do update set
        market_id = excluded.market_id,
        event_id = excluded.event_id,
        checker_kind = excluded.checker_kind,
        enabled = excluded.enabled,
        timezone = excluded.timezone,
        run_policy = excluded.run_policy,
        next_run_at = excluded.next_run_at,
        source_urls = excluded.source_urls,
        entities = excluded.entities,
        keywords = excluded.keywords,
        note = excluded.note,
        updated_at = now()
      returning
        id,
        market_id,
        event_id,
        checker_kind,
        enabled,
        timezone,
        run_policy,
        next_run_at,
        source_urls,
        entities,
        keywords,
        last_checked_at,
        last_alert_fingerprint,
        note
    `,
    [
      input.id,
      input.marketId ?? null,
      input.eventId ?? null,
      input.checkerKind,
      input.enabled,
      input.timezone,
      JSON.stringify(input.runPolicy),
      input.nextRunAt ?? null,
      JSON.stringify(input.sourceUrls),
      JSON.stringify(input.entities),
      JSON.stringify(input.keywords),
      input.note ?? null
    ]
  );

  return rowToPlan(result.rows[0]!);
}
