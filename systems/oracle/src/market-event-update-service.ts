import type { Pool } from "pg";

import { insertLifecycleEvent } from "../../back/src/platform-surface/oracle";
import type { OracleOfficialFinalIntakeResult } from "./official-final-intake-service";
import type { OracleLifecycleSourceContext } from "./source-adapter-contracts";

export type MarketEventUpdateReceipt = {
  objectType: "market_event_update_receipt";
  id: string | null;
  marketId: string;
  eventType: "official_source_not_ready";
  tier: "system_status";
  dedupeKey: string;
  deduped: boolean;
  sourceUrl: string | null;
  observedAt: string;
  summary: string;
};

export type SourceLagEventUpdateResult = {
  objectType: "source_lag_event_update_result";
  generatedAt: string;
  upsertedCount: number;
  skippedCount: number;
  items: MarketEventUpdateReceipt[];
};

type SourceLagCandidate = {
  marketId: string;
  marketTitle: string;
  sourceUrl: string | null;
  officialStatus: string | null;
  reason: string;
  sourceFetchedAt: string | null;
  sourceRawHash: string | null;
  sourceSnapshot: unknown;
  expectedResolutionAt: string | null;
};

function readExpectedResolutionAt(context: OracleLifecycleSourceContext | undefined): string | null {
  const expectedResolutionAt = context?.marketContract?.timeline?.expectedResolutionAt;
  return typeof expectedResolutionAt === "string" && expectedResolutionAt.trim().length > 0
    ? expectedResolutionAt.trim()
    : null;
}

function hasExpectedResolutionPassed(expectedResolutionAt: string | null, now: Date): boolean {
  if (!expectedResolutionAt) {
    return false;
  }

  const parsed = Date.parse(expectedResolutionAt);
  return Number.isFinite(parsed) && parsed <= now.getTime();
}

function buildSummary(candidate: SourceLagCandidate): string {
  const statusPart = candidate.officialStatus
    ? ` official status: ${candidate.officialStatus}.`
    : "";

  return `Official source is not final yet after the expected resolution time.${statusPart} ${candidate.reason}`.trim();
}

function buildDedupeKey(candidate: SourceLagCandidate): string {
  return candidate.sourceUrl?.trim() || "official-source";
}

export async function upsertSourceLagEventUpdates(
  dbPool: Pool,
  input: {
    intakeResults: OracleOfficialFinalIntakeResult[];
    contextsByMarketId: Map<string, OracleLifecycleSourceContext>;
    now: Date;
    actorId?: string;
  }
): Promise<SourceLagEventUpdateResult> {
  const generatedAt = input.now.toISOString();
  const candidates: SourceLagCandidate[] = [];

  for (const result of input.intakeResults) {
    for (const item of result.items) {
      if (item.action !== "skipped_not_final") {
        continue;
      }

      const context = input.contextsByMarketId.get(item.marketId);
      const expectedResolutionAt = readExpectedResolutionAt(context);

      if (!hasExpectedResolutionPassed(expectedResolutionAt, input.now)) {
        continue;
      }

      candidates.push({
        marketId: item.marketId,
        marketTitle: item.marketTitle,
        sourceUrl: item.sourceUrl,
        officialStatus: item.officialStatus,
        reason: item.reason,
        sourceFetchedAt: item.sourceFetchedAt ?? null,
        sourceRawHash: item.sourceRawHash ?? null,
        sourceSnapshot: item.sourceSnapshot ?? null,
        expectedResolutionAt
      });
    }
  }

  const items: MarketEventUpdateReceipt[] = [];

  for (const candidate of candidates) {
    const dedupeKey = buildDedupeKey(candidate);
    const observedAt = candidate.sourceFetchedAt ?? generatedAt;
    const summary = buildSummary(candidate);
    const evidencePayload = {
      objectType: "source_lag_after_event_payload",
      marketTitle: candidate.marketTitle,
      expectedResolutionAt: candidate.expectedResolutionAt,
      officialStatus: candidate.officialStatus,
      sourceFetchedAt: candidate.sourceFetchedAt,
      sourceRawHash: candidate.sourceRawHash,
      sourceSnapshot: candidate.sourceSnapshot,
      reason: candidate.reason
    };
    const lifecycleEventId = await insertLifecycleEvent(dbPool, {
      marketId: candidate.marketId,
      eventType: "official_source_not_ready",
      sourceSystem: "oracle",
      actorId: input.actorId ?? "system:oracle-lifecycle",
      occurredAt: observedAt,
      dedupeKey: `official_source_not_ready:${candidate.marketId}:${dedupeKey}`,
      payload: {
        ...evidencePayload,
        summary,
        sourceUrl: candidate.sourceUrl,
        sourceLabel: "Official resolution source"
      }
    });

    items.push({
      objectType: "market_event_update_receipt",
      id: lifecycleEventId,
      marketId: candidate.marketId,
      eventType: "official_source_not_ready",
      tier: "system_status",
      dedupeKey,
      deduped: lifecycleEventId === null,
      sourceUrl: candidate.sourceUrl,
      observedAt,
      summary
    });
  }

  return {
    objectType: "source_lag_event_update_result",
    generatedAt,
    upsertedCount: items.filter((item) => !item.deduped).length,
    skippedCount: candidates.length === 0 ? 0 : candidates.length - items.length,
    items
  };
}
