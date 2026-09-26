import type { Pool } from "pg";

import { toPublicResolutionSourceUrl } from "../../../shared/public-source";

export type MarketDetailEventUpdate = {
  id: string;
  eventType: string;
  tier: string;
  summary: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  observedAt: string;
  createdBy: string;
  linksToCaseId: string | null;
};

type MarketEventUpdateRow = {
  id: string;
  event_type: string;
  source_system: string;
  actor_id: string;
  occurred_at: Date;
  oracle_case_id: string | null;
  payload: unknown;
};

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readTier(row: MarketEventUpdateRow): string {
  if (row.event_type === "official_source_not_ready") {
    return "system_status";
  }

  if (row.event_type === "operator_observed_outcome") {
    return "operator_observed";
  }

  return row.source_system;
}

function readPublicCreator(row: MarketEventUpdateRow): string {
  if (row.actor_id.startsWith("system:")) {
    return row.actor_id.replace(/^system:/, "") || "system";
  }

  if (row.source_system === "admin") {
    return "operator";
  }

  return row.source_system || "system";
}

export async function readMarketEventUpdates(
  pool: Pool,
  marketId: string
): Promise<MarketDetailEventUpdate[]> {
  const result = await pool.query<MarketEventUpdateRow>(
    `
      select
        id,
        event_type,
        source_system,
        actor_id,
        occurred_at,
        oracle_case_id,
        payload
      from lifecycle_events
      where market_id = $1
        and event_type in (
          'official_source_not_ready',
          'operator_observed_outcome',
          'market_closed',
          'resolution_case_created',
          'resolution_approved',
          'market_resolved',
          'settlement_completed'
        )
      order by occurred_at desc, created_at desc
      limit 10
    `,
    [marketId]
  );

  return result.rows
    .filter(
      (row) =>
        typeof row.id === "string" &&
        typeof row.event_type === "string" &&
        typeof row.source_system === "string" &&
        row.occurred_at instanceof Date &&
        typeof row.actor_id === "string"
    )
    .map((row) => {
      const payload = readObject(row.payload);

      return {
        id: row.id,
        eventType: row.event_type,
        tier: readTier(row),
        summary:
          readString(payload.summary) ??
          readString(payload.reason) ??
          row.event_type,
        sourceUrl: toPublicResolutionSourceUrl(readString(payload.sourceUrl)),
        sourceLabel: readString(payload.sourceLabel),
        observedAt: row.occurred_at.toISOString(),
        createdBy: readPublicCreator(row),
        linksToCaseId: null
      };
    });
}
