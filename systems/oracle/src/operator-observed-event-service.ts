import type { Pool } from "pg";

import { insertLifecycleEvent } from "../../back/src/platform-surface/oracle";
import { resolveMarketIdFromInput } from "./inspect-market-service";

export type OperatorObservedEventRequest = {
  marketId: string;
  summary: string;
  observedAt?: string | null;
  observedOutcomeKey?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
};

export type OperatorObservedEventResult = {
  objectType: "oracle_operator_observed_event_result";
  marketId: string;
  eventType: "operator_observed_outcome";
  lifecycleEventId: string | null;
  deduped: boolean;
  observedAt: string;
  summary: string;
  settlementAllowed: false;
  nextAction: "context_only";
};

function readRequiredText(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }

  return trimmed;
}

function normalizeObservedAt(value: string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("observedAt must be an ISO timestamp.");
  }

  return parsed.toISOString();
}

function normalizeOptionalHttpsUrl(value: string | null | undefined, fieldName: string): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // fall through to shared error below
  }

  throw new Error(`${fieldName} must be an HTTPS URL.`);
}

async function assertMarketExists(dbPool: Pool, marketId: string): Promise<void> {
  const result = await dbPool.query<{ id: string }>(
    `
      select id
      from markets
      where id = $1
      limit 1
    `,
    [marketId]
  );

  if (!result.rows[0]) {
    throw new Error(`Market not found: ${marketId}`);
  }
}

export async function recordOperatorObservedEvent(
  dbPool: Pool,
  actor: { actorId: string },
  request: OperatorObservedEventRequest
): Promise<OperatorObservedEventResult> {
  const marketId = resolveMarketIdFromInput(readRequiredText(request.marketId, "marketId"));
  const summary = readRequiredText(request.summary, "summary");
  const observedAt = normalizeObservedAt(request.observedAt);
  const sourceUrl = normalizeOptionalHttpsUrl(request.sourceUrl, "sourceUrl");

  await assertMarketExists(dbPool, marketId);

  const idempotencyKey = request.idempotencyKey?.trim() || `${observedAt}:${summary}`;
  const dedupeKey = `operator_observed_outcome:${marketId}:${idempotencyKey}`;
  const lifecycleEventId = await insertLifecycleEvent(dbPool, {
    marketId,
    eventType: "operator_observed_outcome",
    sourceSystem: "admin",
    actorId: actor.actorId,
    occurredAt: observedAt,
    correlationId: request.idempotencyKey?.trim() || null,
    dedupeKey,
    payload: {
      objectType: "operator_observed_outcome_payload",
      tier: "operator_observed",
      summary,
      observedOutcomeKey: request.observedOutcomeKey?.trim() || null,
      sourceUrl,
      sourceLabel: request.sourceLabel?.trim() || null,
      note: request.note?.trim() || null,
      settlementAllowed: false,
      createsResolutionCase: false,
      settlementPolicy:
        "context_only_no_settlement; official/fallback resolution still requires a separate approved Oracle case"
    }
  });

  return {
    objectType: "oracle_operator_observed_event_result",
    marketId,
    eventType: "operator_observed_outcome",
    lifecycleEventId,
    deduped: lifecycleEventId === null,
    observedAt,
    summary,
    settlementAllowed: false,
    nextAction: "context_only"
  };
}
