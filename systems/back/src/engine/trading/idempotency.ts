import type { Pool, PoolClient } from "pg";

import {
  claimIdempotencyRecord,
  completeIdempotencyRecord as completeSharedIdempotencyRecord
} from "../../shared/idempotency-records";
import { TradeServiceError } from "./trade-errors";
import type { TradeResponse } from "./trade-types";

export type TradeStatusResult =
  | { status: "executed"; receipt: TradeStatusReceipt }
  | { status: "not_found" };

export type TradeStatusReceipt = {
  side: TradeResponse["side"];
  outcomeKey: string;
  cashAmount: string;
  createdAt: string;
};

function buildReceipt(response: TradeResponse): TradeStatusReceipt {
  return {
    side: response.side,
    outcomeKey: response.outcomeKey,
    cashAmount: response.side === "buy" ? response.cashSpent : response.proceedsReceived,
    createdAt: response.executedAt
  };
}

export async function claimIdempotencyScope(
  client: PoolClient,
  actorId: string,
  idempotencyKey: string,
  requestHash: string
): Promise<{ recordId: string; completedResponse: TradeResponse | null }> {
  return claimIdempotencyRecord<TradeResponse>(client, {
    scope: "trade",
    recordIdPrefix: "idempotency_trade",
    actorId,
    idempotencyKey,
    requestHash,
    disappearedMessage: "Idempotency record disappeared during trade execution",
    conflictError: () => new TradeServiceError(
      409,
      "idempotency_conflict",
      "Idempotency key was already used with a different trade payload."
    ),
    inProgressError: () => new TradeServiceError(
      409,
      "idempotency_in_progress",
      "Trade with this idempotency key is already in progress."
    )
  });
}

export async function completeIdempotencyRecord(
  client: PoolClient,
  recordId: string,
  tradeId: string,
  response: TradeResponse
): Promise<void> {
  await completeSharedIdempotencyRecord(client, {
    recordId,
    resourceType: "trade",
    resourceId: tradeId,
    response
  });
}

// Read-only lookup for the network-drop trust probe: the client re-sends the
// idempotency key it originally submitted with the trade, and this answers
// definitely whether that trade executed for THIS actor — never another
// user's. Scoped by (scope='trade', actor_id, idempotency_key), which is
// exactly `uq_idempotency_records_scope_actor_key` (migration 005) — no new
// index needed. Only a 'completed' row with a response_snapshot counts as
// executed; 'in_progress'/'failed'/absent all read as not_found (the caller
// is asking "did it go through", not "does a record exist").
export async function readTradeStatusByIdempotencyKey(
  pool: Pool,
  actorId: string,
  idempotencyKey: string
): Promise<TradeStatusResult> {
  const result = await pool.query<{
    status: "in_progress" | "completed" | "failed";
    response_snapshot: TradeResponse | null;
  }>(
    `
      select status, response_snapshot
      from idempotency_records
      where scope = 'trade'
        and actor_id = $1
        and idempotency_key = $2
      limit 1
    `,
    [actorId, idempotencyKey]
  );

  const row = result.rows[0];
  if (!row || row.status !== "completed" || !row.response_snapshot) {
    return { status: "not_found" };
  }

  return { status: "executed", receipt: buildReceipt(row.response_snapshot) };
}
