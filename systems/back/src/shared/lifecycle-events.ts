import { randomUUID } from "node:crypto";

import type { Queryable } from "../db/client/pool";

export type LifecycleEventType =
  | "market_published"
  | "market_closed"
  | "official_source_not_ready"
  | "source_snapshot_captured"
  | "operator_observed_outcome"
  | "resolution_case_created"
  | "resolution_approved"
  | "resolution_cascade_completed"
  | "resolution_cascade_failed"
  | "market_resolved"
  | "market_voided"
  | "settlement_completed";

export type LifecycleEventSourceSystem =
  | "back"
  | "horizon"
  | "oracle"
  | "seer"
  | "admin"
  | "runtime";

export type InsertLifecycleEventInput = {
  marketId: string;
  eventType: LifecycleEventType;
  sourceSystem: LifecycleEventSourceSystem;
  actorId: string;
  occurredAt?: string;
  correlationId?: string | null;
  dedupeKey?: string | null;
  auditEventId?: string | null;
  oracleCaseId?: string | null;
  resolutionId?: string | null;
  payload?: unknown;
};

export async function insertLifecycleEvent(
  db: Queryable,
  input: InsertLifecycleEventInput
): Promise<string | null> {
  const eventId = `lifevt_${randomUUID()}`;
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  const result = await db.query<{ id: string }>(
    `
      insert into lifecycle_events (
        id,
        market_id,
        event_type,
        source_system,
        actor_id,
        occurred_at,
        correlation_id,
        dedupe_key,
        audit_event_id,
        oracle_case_id,
        resolution_id,
        payload,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
      on conflict (dedupe_key) where dedupe_key is not null do nothing
      returning id
    `,
    [
      eventId,
      input.marketId,
      input.eventType,
      input.sourceSystem,
      input.actorId,
      occurredAt,
      input.correlationId ?? null,
      input.dedupeKey ?? null,
      input.auditEventId ?? null,
      input.oracleCaseId ?? null,
      input.resolutionId ?? null,
      JSON.stringify(input.payload ?? {})
    ]
  );

  return result.rows[0]?.id ?? null;
}
