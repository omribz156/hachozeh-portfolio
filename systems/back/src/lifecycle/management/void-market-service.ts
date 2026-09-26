import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { RequestActor } from "../../auth/actor-resolver";
import { withTransaction } from "../../db/tx/with-transaction";
import {
  insertEconomyTransferLedgerTransaction
} from "../../economy/economy-ledger";
import { insertAuditEvent } from "../../shared/audit-events";
import { quantizeMoney, toDecimal } from "../../shared/decimals";
import {
  claimIdempotencyRecord,
  completeIdempotencyRecord
} from "../../shared/idempotency-records";
import { insertLifecycleEvent } from "../../shared/lifecycle-events";
import {
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "../../shared/zod-request-body";

type VoidableMarketStatus = "draft" | "open" | "closed" | "resolved" | "voided";

type MarketVoidRow = {
  id: string;
  status: VoidableMarketStatus;
  closed_at: Date | null;
  resolved_at: Date | null;
  market_treasury_account_id: string | null;
};

type VoidPositionRow = {
  user_id: string;
  outcome_id: string;
  shares: string;
  cost_basis: string;
  user_cash_account_id: string;
};

type AccountBalanceRow = {
  id: string;
  balance_cached: string;
};

export type VoidMarketRequest = {
  reason: string;
  note: string | null;
  idempotencyKey: string;
  requestedAt?: string;
};

export type VoidMarketResponse = {
  marketId: string;
  previousStatus: Exclude<VoidableMarketStatus, "voided">;
  status: "voided";
  voidedAt: string;
  auditEventId: string;
  refundedPositionCount: number;
  refundedAmount: string;
  sweptAmount: string;
};

export class VoidMarketServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "VoidMarketServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const createVoidRequestError = (message: string) =>
  new VoidMarketServiceError(400, "invalid_request", message);

export function parseVoidMarketRequest(body: unknown): VoidMarketRequest {
  const candidate = parseObjectBody(body, "Void request body must be an object.", createVoidRequestError);

  return {
    reason: parseRequiredStringField(candidate, "reason", createVoidRequestError),
    note: parseNullableStringField(candidate, "note", createVoidRequestError),
    idempotencyKey: parseRequiredStringField(candidate, "idempotencyKey", createVoidRequestError),
    requestedAt: parseNullableStringField(candidate, "requestedAt", createVoidRequestError) ?? undefined
  };
}

function buildRequestHash(marketId: string, request: VoidMarketRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        marketId,
        ...request
      })
    )
    .digest("hex");
}

async function readMarketForVoid(
  client: PoolClient,
  marketId: string
): Promise<MarketVoidRow | null> {
  const result = await client.query<MarketVoidRow>(
    `
      select id, status, closed_at, resolved_at
           , market_treasury_account_id
      from markets
      where id = $1
      limit 1
      for update
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

async function readLockedVoidPositions(
  client: PoolClient,
  marketId: string
): Promise<VoidPositionRow[]> {
  const result = await client.query<VoidPositionRow>(
    `
      select
        p.user_id,
        p.outcome_id,
        p.shares::text as shares,
        p.cost_basis::text as cost_basis,
        a.id as user_cash_account_id
      from positions p
      join accounts a
        on a.owner_id = p.user_id
       and a.type = 'user_cash'
       and a.status = 'active'
      where p.market_id = $1
      order by p.user_id, p.outcome_id
      for update of p, a
    `,
    [marketId]
  );

  return result.rows;
}

async function readMarketTreasuryBalance(
  client: PoolClient,
  accountId: string
): Promise<AccountBalanceRow | null> {
  const result = await client.query<AccountBalanceRow>(
    `
      select id, balance_cached::text as balance_cached
      from accounts
      where id = $1
        and type = 'market_treasury'
        and status = 'active'
      limit 1
      for update
    `,
    [accountId]
  );

  return result.rows[0] ?? null;
}

async function deleteVoidPosition(
  client: PoolClient,
  position: VoidPositionRow,
  marketId: string
): Promise<void> {
  await client.query(
    `
      delete from positions
      where user_id = $1
        and market_id = $2
        and outcome_id = $3
    `,
    [position.user_id, marketId, position.outcome_id]
  );
}

async function settleVoidContractPositions(
  client: PoolClient,
  marketId: string,
  voidedAt: string
): Promise<void> {
  await client.query(
    `
      update contract_positions
      set settled_at = $2,
          updated_at = now()
      where market_id = $1
        and settled_at is null
    `,
    [marketId, voidedAt]
  );
}

async function updateMarketVoided(
  client: PoolClient,
  market: MarketVoidRow,
  voidedAt: string
): Promise<void> {
  await client.query(
    `
      update markets
      set status = 'voided',
          closed_at = coalesce(closed_at, $2),
          settlement_status = null,
          updated_at = now()
      where id = $1
    `,
    [market.id, market.closed_at ? market.closed_at.toISOString() : voidedAt]
  );
}

export async function voidMarket(
  dbPool: Pool,
  marketId: string,
  request: VoidMarketRequest,
  actor: RequestActor
): Promise<VoidMarketResponse> {
  const requestedAt = request.requestedAt ?? new Date().toISOString();
  const parsedRequestedAt = new Date(requestedAt);

  if (Number.isNaN(parsedRequestedAt.getTime())) {
    throw new VoidMarketServiceError(400, "invalid_request", "requestedAt must be an ISO timestamp.");
  }

  const voidedAt = parsedRequestedAt.toISOString();
  const requestHash = buildRequestHash(marketId, request);

  return withTransaction(dbPool, async (client) => {
    const idempotency = await claimIdempotencyRecord<VoidMarketResponse>(client, {
      scope: "void_market",
      recordIdPrefix: "idempotency_void_market",
      actorId: actor.actorId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      disappearedMessage: "Idempotency record disappeared during void execution",
      conflictError: () =>
        new VoidMarketServiceError(
          409,
          "idempotency_conflict",
          "Idempotency key was already used with a different void payload."
        ),
      inProgressError: () =>
        new VoidMarketServiceError(
          409,
          "idempotency_in_progress",
          "Void with this idempotency key is already in progress."
        )
    });

    if (idempotency.completedResponse) {
      return idempotency.completedResponse;
    }

    const market = await readMarketForVoid(client, marketId);

    if (!market) {
      throw new VoidMarketServiceError(404, "market_not_found", "Requested market was not found.");
    }

    if (market.status === "voided") {
      throw new VoidMarketServiceError(409, "market_already_voided", "Market is already voided.");
    }

    if (market.status === "resolved" || market.resolved_at) {
      throw new VoidMarketServiceError(
        409,
        "market_already_resolved",
        "Resolved markets cannot be voided through this operator path."
      );
    }

    if (!market.market_treasury_account_id) {
      throw new VoidMarketServiceError(
        409,
        "market_not_voidable",
        "Market treasury account is missing."
      );
    }

    const positions = await readLockedVoidPositions(client, marketId);
    let refundedAmount = toDecimal(0);

    for (const position of positions) {
      const refundAmount = toDecimal(position.cost_basis);
      if (refundAmount.gt(0)) {
        await insertEconomyTransferLedgerTransaction(client, {
          type: "void_refund",
          referenceType: "market",
          referenceId: `void_refund:${marketId}:${position.user_id}:${position.outcome_id}`,
          idempotencyKey: `void_refund:${marketId}:${request.idempotencyKey}:${position.user_id}:${position.outcome_id}`,
          createdBy: actor.actorId,
          triggeredBy: "admin_void",
          triggeredById: actor.actorId,
          marketId,
          outcomeId: position.outcome_id,
          sourceAccountId: market.market_treasury_account_id,
          sourceAccountType: "market_treasury",
          targetAccountId: position.user_cash_account_id,
          targetAccountType: "user_cash",
          amount: quantizeMoney(refundAmount),
          sourceEntryRole: "debit_market_treasury_void_refund",
          targetEntryRole: "credit_user_cash_void_refund"
        });
        refundedAmount = refundedAmount.plus(refundAmount);
      }

      await deleteVoidPosition(client, position, marketId);
    }

    await settleVoidContractPositions(client, marketId, voidedAt);

    const marketTreasuryAfterRefunds = await readMarketTreasuryBalance(
      client,
      market.market_treasury_account_id
    );
    if (!marketTreasuryAfterRefunds) {
      throw new VoidMarketServiceError(
        409,
        "market_not_voidable",
        "Market treasury account is unavailable."
      );
    }

    const sweepAmount = toDecimal(marketTreasuryAfterRefunds.balance_cached);
    if (sweepAmount.gt(0)) {
      await insertEconomyTransferLedgerTransaction(client, {
        type: "treasury_sweep",
        referenceType: "market",
        referenceId: `void_sweep:${marketId}`,
        idempotencyKey: `void_sweep:${marketId}:${request.idempotencyKey}`,
        createdBy: actor.actorId,
        triggeredBy: "admin_void",
        triggeredById: actor.actorId,
        marketId,
        sourceAccountId: market.market_treasury_account_id,
        sourceAccountType: "market_treasury",
        targetAccountType: "platform_treasury",
        amount: quantizeMoney(sweepAmount),
        sourceEntryRole: "debit_market_treasury_void_sweep",
        targetEntryRole: "credit_platform_treasury_void_sweep"
      });
    }

    await updateMarketVoided(client, market, voidedAt);

    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "market_voided",
      entityType: "market",
      entityId: marketId,
      payload: {
        reason: request.reason,
        note: request.note,
        previousStatus: market.status,
        voidedAt,
        refundedPositionCount: positions.length,
        refundedAmount: quantizeMoney(refundedAmount),
        sweptAmount: quantizeMoney(sweepAmount)
      }
    });

    await insertLifecycleEvent(client, {
      marketId,
      eventType: "market_voided",
      sourceSystem: "admin",
      actorId: actor.actorId,
      occurredAt: voidedAt,
      correlationId: request.idempotencyKey,
      dedupeKey: `market_voided:${marketId}:${request.idempotencyKey}`,
      auditEventId,
      payload: {
        reason: request.reason,
        note: request.note,
        previousStatus: market.status,
        voidedAt,
        refundedPositionCount: positions.length,
        refundedAmount: quantizeMoney(refundedAmount),
        sweptAmount: quantizeMoney(sweepAmount)
      }
    });

    const response: VoidMarketResponse = {
      marketId,
      previousStatus: market.status,
      status: "voided",
      voidedAt,
      auditEventId,
      refundedPositionCount: positions.length,
      refundedAmount: quantizeMoney(refundedAmount),
      sweptAmount: quantizeMoney(sweepAmount)
    };

    await completeIdempotencyRecord(client, {
      recordId: idempotency.recordId,
      resourceType: "market",
      resourceId: marketId,
      response
    });

    return response;
  });
}
