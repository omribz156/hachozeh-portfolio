import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import type { RequestActor } from "../../auth/actor-resolver";
import { withTransaction } from "../../db/tx/with-transaction";
import { insertAuditEvent } from "../../shared/audit-events";
import { updateAccountBalance } from "../../shared/account-balances";
import {
  readLockedAccountById,
  readLockedPlatformTreasury
} from "../../shared/account-records";
import { parseDecimalString, quantizeMoney, toDecimal } from "../../shared/decimals";
import { insertLifecycleEvent } from "../../shared/lifecycle-events";
import { PublishMarketServiceError } from "./publish-market/errors";
import { buildRequestHash } from "./publish-market/hashing";
import {
  claimIdempotencyScope,
  completeIdempotencyRecord
} from "./publish-market/idempotency";
import { insertLedgerTransactionWithEntries } from "./publish-market/ledger-seed";
import {
  createMarketTreasuryAccount,
  readLockedMarket,
  readLockedOutcomes,
  updateMarketPublished
} from "./publish-market/market-records";
import {
  insertInitialOutcomeState,
  insertInitialPricingState
} from "./publish-market/pricing-state";
import { calculateLmsrReserveFloor } from "./publish-market/reserve-policy";
import { appendBaseCandleFromState } from "../../markets/market-history/base-candle-store";
import { upsertSuggestedMarketTags } from "../../markets/market-tags/tag-writes";
import { pingMarketIndexNow } from "../../seo/market-indexnow-service";
import type { MarketRow, PublishMarketRequest, PublishMarketResponse } from "./publish-market/types";

export { PublishMarketServiceError } from "./publish-market/errors";
export { parsePublishMarketRequest } from "./publish-market/request-parser";
export type { PublishMarketRequest, PublishMarketResponse } from "./publish-market/types";

type PublishFamilyGate = {
  measurementKind: string;
  resultShape: string;
  sourceIds: string[];
  lifecycleFit?: string;
  allowFallbackResolution?: boolean;
  fallbackEvidenceStandard?: string;
  oracleCapability:
    | "supported_full_cycle"
    | "supported_final_only"
    | "credible_reporting"
    | "manual_resolution_required";
};

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => readString(item))
        .filter((item): item is string => item !== null)
    : [];
}

function readNestedString(
  payload: Record<string, unknown> | null,
  path: string[]
): string | null {
  let cursor: unknown = payload;

  for (const key of path) {
    const object = readObject(cursor);

    if (!object) {
      return null;
    }

    cursor = object[key];
  }

  return readString(cursor);
}

function readCloseTimingMetadata(
  request: PublishMarketRequest,
  contract: unknown
): {
  eventStartAt: string | null;
  eventCategory: string | null;
} {
  const payload = readObject(contract);
  const eventStartAt =
    readString(request.eventStartAt) ??
    readString(payload?.eventStartAt) ??
    readNestedString(payload, ["event", "startAt"]) ??
    readNestedString(payload, ["scheduledEvent", "startAt"]);
  const eventCategory =
    readString(payload?.eventCategory) ??
    readString(payload?.category) ??
    readString(payload?.marketCategory) ??
    readString(payload?.lifecycleFit) ??
    readNestedString(payload, ["event", "category"]) ??
    readNestedString(payload, ["scheduledEvent", "category"]) ??
    readString(request.eventCategory);

  return { eventStartAt, eventCategory };
}

function isScheduledEventCategory(category: string | null): boolean {
  if (!category) {
    return false;
  }

  const normalized = category.trim().toLowerCase().replace(/[\s-]+/g, "_");

  return (
    normalized.includes("scheduled_event") ||
    normalized.includes("event_full_cycle") ||
    normalized.includes("sports_fixture") ||
    normalized.includes("fixture") ||
    normalized.includes("match") ||
    normalized.includes("game")
  );
}

function assertMarketClosesBeforeKnownEventStart(
  market: MarketRow,
  request: PublishMarketRequest
): void {
  const { eventStartAt, eventCategory } = readCloseTimingMetadata(request, market.market_contract);

  if (!eventStartAt || !isScheduledEventCategory(eventCategory)) {
    return;
  }

  const eventStartMs = Date.parse(eventStartAt);

  if (!Number.isFinite(eventStartMs)) {
    throw new PublishMarketServiceError(
      400,
      "invalid_request",
      "eventStartAt must be a valid ISO timestamp."
    );
  }

  if (market.close_at.getTime() >= eventStartMs) {
    throw new PublishMarketServiceError(
      409,
      "close_after_event_start",
      "Scheduled-event markets must close before the known event start."
    );
  }
}

function resolvePublishedAt(request: PublishMarketRequest, market: MarketRow): string {
  const publishedAt = request.publishAt ?? new Date().toISOString();
  const publishedAtMs = Date.parse(publishedAt);

  if (!Number.isFinite(publishedAtMs)) {
    throw new PublishMarketServiceError(
      400,
      "invalid_request",
      "publishAt must be a valid ISO timestamp."
    );
  }

  if (publishedAtMs >= market.close_at.getTime()) {
    throw new PublishMarketServiceError(
      409,
      "publish_after_close",
      "Market publish time must be before closeAt."
    );
  }

  return new Date(publishedAtMs).toISOString();
}

function readPublishFamilyGate(contract: unknown): PublishFamilyGate {
  const payload = readObject(contract);

  if (!payload || readString(payload.objectType) !== "market_contract_v1") {
    throw new PublishMarketServiceError(
      409,
      "market_family_not_classified",
      "Market publish requires a market_contract_v1 family contract."
    );
  }

  const resolutionSource = readObject(payload.resolutionSource);
  const sourceIds = readStringArray(resolutionSource?.sourceIds);
  const measurementKind = readString(payload.measurementKind);
  const resultShape = readString(payload.resultShape);
  const oracleCapability = readString(payload.oracleCapability);
  const lifecycleFit = readString(payload.lifecycleFit) ?? undefined;
  const allowFallbackResolution = payload.allowFallbackResolution === true;
  const fallbackEvidenceStandard = readString(payload.fallbackEvidenceStandard) ?? undefined;

  if (!measurementKind || !resultShape || sourceIds.length === 0) {
    throw new PublishMarketServiceError(
      409,
      "market_family_not_classified",
      "Market publish requires sourceIds, measurementKind, and resultShape."
    );
  }

  if (
    oracleCapability === "supported_full_cycle" ||
    oracleCapability === "supported_final_only" ||
    oracleCapability === "credible_reporting" ||
    oracleCapability === "manual_resolution_required"
  ) {
    if (allowFallbackResolution && !fallbackEvidenceStandard) {
      throw new PublishMarketServiceError(
        409,
        "market_fallback_policy_incomplete",
        "Fallback resolution requires fallbackEvidenceStandard."
      );
    }

    if (
      sourceIds.includes("src_ifa_fixtures_results") &&
      oracleCapability !== "manual_resolution_required" &&
      !allowFallbackResolution
    ) {
      throw new PublishMarketServiceError(
        409,
        "market_fallback_policy_required",
        "IFA markets require an explicit fallback policy because the official site can block backend fetches."
      );
    }

    return {
      measurementKind,
      resultShape,
      sourceIds,
      lifecycleFit,
      allowFallbackResolution: allowFallbackResolution || undefined,
      fallbackEvidenceStandard,
      oracleCapability
    };
  }

  throw new PublishMarketServiceError(
    409,
    "market_family_not_classified",
    oracleCapability === "blocked"
      ? "Market source family is blocked and cannot be published."
      : "Market publish requires an explicit Oracle family capability."
  );
}

export async function publishMarket(
  dbPool: Pool,
  marketId: string,
  request: PublishMarketRequest,
  actor: RequestActor
): Promise<PublishMarketResponse> {
  const requestHash = buildRequestHash(marketId, request);

  const result = await withTransaction(dbPool, async (client) => {
    const idempotency = await claimIdempotencyScope(
      client,
      actor.actorId,
      request.idempotencyKey,
      requestHash
    );

    if (idempotency.completedResponse) {
      return idempotency.completedResponse;
    }

    const market = await readLockedMarket(client, marketId);

    if (!market) {
      throw new PublishMarketServiceError(404, "market_not_found", "Requested market was not found.");
    }

    if (market.status !== "draft") {
      throw new PublishMarketServiceError(
        409,
        "market_not_publishable",
        "Market must be in draft status before publish."
      );
    }

    if (market.open_at.getTime() >= market.close_at.getTime()) {
      throw new PublishMarketServiceError(
        409,
        "market_not_publishable",
        "Market open/close window is invalid."
      );
    }

    assertMarketClosesBeforeKnownEventStart(market, request);

    const outcomes = await readLockedOutcomes(client, marketId);

    if (outcomes.length < 2) {
      throw new PublishMarketServiceError(
        409,
        "market_not_publishable",
        "Market requires at least two outcomes before publish."
      );
    }

    const familyGate = readPublishFamilyGate(market.market_contract);
    const seedAmount = parseDecimalString(request.seedAmount, {
      fieldName: "seedAmount",
      allowNegative: false,
      allowZero: false,
      maxScale: 6
    });
    const platformTreasury = await readLockedPlatformTreasury(client);

    if (!platformTreasury || platformTreasury.status !== "active") {
      throw new PublishMarketServiceError(
        409,
        "market_not_publishable",
        "Platform treasury account is unavailable."
      );
    }

    const currentPlatformBalance = toDecimal(platformTreasury.balance_cached);

    if (currentPlatformBalance.lessThan(seedAmount)) {
      throw new PublishMarketServiceError(
        409,
        "insufficient_funds",
        "Platform treasury has insufficient funds for market seed."
      );
    }

    const marketTreasuryAccountId = market.market_treasury_account_id ?? `account_${marketId}_treasury`;
    let marketTreasury = await readLockedAccountById(client, marketTreasuryAccountId);

    if (!marketTreasury) {
      await createMarketTreasuryAccount(client, marketId, marketTreasuryAccountId);
      marketTreasury = await readLockedAccountById(client, marketTreasuryAccountId);
    }

    if (!marketTreasury || marketTreasury.status !== "active") {
      throw new PublishMarketServiceError(
        409,
        "market_not_publishable",
        "Market treasury account is unavailable."
      );
    }

    const requiredReserve = calculateLmsrReserveFloor({
      liquidityB: market.liquidity_b,
      outcomeCount: outcomes.length
    });
    const marketTreasuryBalanceBefore = quantizeMoney(marketTreasury.balance_cached);
    const marketTreasuryBalanceAfter = quantizeMoney(
      toDecimal(marketTreasury.balance_cached).plus(seedAmount)
    );

    if (toDecimal(marketTreasuryBalanceAfter).lessThan(requiredReserve)) {
      throw new PublishMarketServiceError(
        409,
        "market_reserve_underfunded",
        `Market publish requires at least V₪ ${requiredReserve} reserve for liquidity_b=${market.liquidity_b} and ${outcomes.length} outcomes.`
      );
    }

    const publishedAt = resolvePublishedAt(request, market);
    const nextPlatformBalance = quantizeMoney(currentPlatformBalance.minus(seedAmount));
    const seedTransactionId = `ledger_tx_${randomUUID()}`;
    const reserveCheck = {
      policy: "lmsr_reserve_floor" as const,
      liquidityB: market.liquidity_b,
      outcomeCount: outcomes.length,
      requiredReserve,
      seedAmount: quantizeMoney(seedAmount),
      marketTreasuryBalanceBefore,
      marketTreasuryBalanceAfter,
      platformTreasuryBalanceBefore: quantizeMoney(currentPlatformBalance),
      platformTreasuryBalanceAfter: nextPlatformBalance,
      coverageStatus: "covered" as const
    };

    await updateAccountBalance(client, platformTreasury.id, nextPlatformBalance);
    await updateAccountBalance(client, marketTreasury.id, marketTreasuryBalanceAfter);
    await insertLedgerTransactionWithEntries(client, {
      transactionId: seedTransactionId,
      idempotencyKey: request.idempotencyKey,
      actorId: actor.actorId,
      marketId,
      amount: quantizeMoney(seedAmount),
      platformTreasuryAccountId: platformTreasury.id,
      marketTreasuryAccountId: marketTreasury.id
    });

    await insertInitialPricingState(client, marketId, market.liquidity_b);
    await insertInitialOutcomeState(
      client,
      marketId,
      outcomes.map((outcome) => outcome.id),
      market.liquidity_b
    );
    // Seed the opening base candle from the just-written initial prices (1/N per
    // outcome, or seeded odds) stamped at the effective publish/open time. The
    // draft open_at may be provisional; updateMarketPublished will normalize the
    // market row to publishedAt, and the chart seed must use that same timestamp.
    await appendBaseCandleFromState(client, marketId, Date.parse(publishedAt));
    await updateMarketPublished(client, marketId, publishedAt, marketTreasury.id);
    const relatedTags = await upsertSuggestedMarketTags(client, {
      id: market.id,
      title: market.title,
      category_key: market.category_key,
      market_family_key: market.market_family_key
    });

    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "market_published",
      entityType: "market",
      entityId: marketId,
      payload: {
        command: {
          marketId,
          ...request
        },
        result: {
          status: "open",
          publishedAt,
          marketTreasuryAccountId: marketTreasury.id,
          seedTransactionId,
          reserveCheck,
          relatedTags: relatedTags.map((tag) => ({
            slug: tag.def.slug,
            label: tag.def.label,
            kind: tag.def.kind ?? null,
            weight: tag.weight
          }))
        }
      }
    });

    await insertLifecycleEvent(client, {
      marketId,
      eventType: "market_published",
      sourceSystem: "back",
      actorId: actor.actorId,
      occurredAt: publishedAt,
      correlationId: request.idempotencyKey,
      dedupeKey: `market_published:${marketId}:${request.idempotencyKey}`,
      auditEventId,
      payload: {
        status: "open",
        publishedAt,
        marketTreasuryAccountId: marketTreasury.id,
        seedTransactionId,
        seedAmount: quantizeMoney(seedAmount),
        reserveCheck,
        relatedTags: relatedTags.map((tag) => ({
          slug: tag.def.slug,
          label: tag.def.label,
          kind: tag.def.kind ?? null,
          weight: tag.weight
        })),
        familyGate
      }
    });

    const response: PublishMarketResponse = {
      marketId,
      status: "open",
      publishedAt,
      marketTreasuryAccountId: marketTreasury.id,
      seedTransactionId,
      reserveCheck,
      marketStateVersion: 0,
      auditEventId
    };

    await completeIdempotencyRecord(client, idempotency.recordId, marketId, response);

    return response;
  });

  pingMarketIndexNow(dbPool, marketId);
  return result;
}
