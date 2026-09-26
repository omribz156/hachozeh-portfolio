import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import type { ContractSide } from "../contract-side-normalization";
import type { TradeSide } from "./trade-types";

export async function insertTradeRecord(
  client: PoolClient,
  tradeId: string,
  marketId: string,
  requestedOutcomeKey: string,
  outcomeId: string,
  actorId: string,
  side: TradeSide,
  contractSide: ContractSide,
  cashAmount: string,
  shareAmount: string,
  averagePrice: string,
  priceBefore: string,
  priceAfter: string,
  idempotencyKey: string,
  marketStateVersionAfter: number
): Promise<void> {
  await client.query(
    `
      insert into trades (
        id,
        market_id,
        requested_outcome_key,
        outcome_id,
        user_id,
        side,
        contract_side,
        cash_amount,
        share_amount,
        avg_price,
        price_before,
        price_after,
        idempotency_key,
        market_state_version,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
    `,
    [
      tradeId,
      marketId,
      requestedOutcomeKey,
      outcomeId,
      actorId,
      side,
      contractSide,
      cashAmount,
      shareAmount,
      averagePrice,
      priceBefore,
      priceAfter,
      idempotencyKey,
      marketStateVersionAfter
    ]
  );
}

export async function insertTradeExecutionLegs(
  client: PoolClient,
  tradeId: string,
  executionLegs: readonly {
    outcomeId: string;
    shareAmount: string;
  }[]
): Promise<void> {
  for (let index = 0; index < executionLegs.length; index += 1) {
    const leg = executionLegs[index];
    await client.query(
      `
        insert into trade_execution_legs (
          id,
          trade_id,
          outcome_id,
          share_amount,
          sort_order,
          created_at
        )
        values ($1, $2, $3, $4, $5, now())
      `,
      [`trade_leg_${randomUUID()}`, tradeId, leg.outcomeId, leg.shareAmount, index]
    );
  }
}

export async function insertRealizationEvent(
  client: PoolClient,
  actorId: string,
  marketId: string,
  outcomeId: string,
  tradeId: string,
  sharesClosed: string,
  proceeds: string,
  removedCostBasis: string,
  realizedPnl: string
): Promise<void> {
  await client.query(
    `
      insert into realization_events (
        id,
        user_id,
        market_id,
        outcome_id,
        type,
        shares_closed,
        proceeds,
        removed_cost_basis,
        realized_pnl,
        trade_id,
        created_at
      )
      values ($1, $2, $3, $4, 'sell', $5, $6, $7, $8, $9, now())
    `,
    [
      `realization_${randomUUID()}`,
      actorId,
      marketId,
      outcomeId,
      sharesClosed,
      proceeds,
      removedCostBasis,
      realizedPnl,
      tradeId
    ]
  );
}

export async function insertAuditEvent(
  client: PoolClient,
  actorId: string,
  entityId: string,
  payload: unknown
): Promise<void> {
  await client.query(
    `
      insert into audit_events (id, actor_id, action, entity_type, entity_id, payload, created_at)
      values ($1, $2, 'trade_executed', 'trade', $3, $4::jsonb, now())
    `,
    [`audit_${randomUUID()}`, actorId, entityId, JSON.stringify(payload)]
  );
}
