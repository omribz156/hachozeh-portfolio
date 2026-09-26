import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import type { Queryable } from "../../back/src/platform-surface/oracle";

export type MarketRow = {
  id: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  settlement_status: "pending" | "processing" | "completed" | null;
  market_treasury_account_id: string | null;
  resolved_at: Date | null;
};

export type OutcomeRow = {
  id: string;
  market_id: string;
  is_winner: boolean | null;
};

export type PositionRow = {
  user_id: string;
  outcome_id: string;
  shares: string;
  cost_basis: string;
  user_cash_account_id: string;
  user_cash_balance: string;
};

export async function readLockedMarket(
  client: PoolClient,
  marketId: string
): Promise<MarketRow | null> {
  const result = await client.query<MarketRow>(
    `
      select
        id,
        status,
        settlement_status,
        market_treasury_account_id,
        resolved_at
      from markets
      where id = $1
      limit 1
      for update
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

export async function readMarketOutcomes(
  client: PoolClient,
  marketId: string
): Promise<OutcomeRow[]> {
  const result = await client.query<OutcomeRow>(
    `
      select id, market_id, is_winner
      from market_outcomes
      where market_id = $1
      order by sort_order
      for update
    `,
    [marketId]
  );

  return result.rows;
}

export async function readLockedPositions(
  client: PoolClient,
  marketId: string
): Promise<PositionRow[]> {
  const result = await client.query<PositionRow>(
    `
      select
        p.user_id,
        p.outcome_id,
        p.shares,
        p.cost_basis,
        a.id as user_cash_account_id,
        a.balance_cached as user_cash_balance
      from positions p
      join accounts a
        on a.owner_id = p.user_id
       and a.type = 'user_cash'
      where p.market_id = $1
      order by p.user_id, p.outcome_id
      for update of p, a
    `,
    [marketId]
  );

  return result.rows;
}

export async function insertResolutionRecord(
  client: Queryable,
  input: {
    resolutionId: string;
    marketId: string;
    winningOutcomeId: string;
    actorId: string;
    sourceUrl: string;
    notes: string;
    resolvedAt: string;
  }
): Promise<void> {
  await client.query(
    `
      insert into market_resolutions (
        id,
        market_id,
        winning_outcome_id,
        resolved_by,
        source_url,
        notes,
        resolved_at
      )
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      input.resolutionId,
      input.marketId,
      input.winningOutcomeId,
      input.actorId,
      input.sourceUrl,
      input.notes,
      input.resolvedAt
    ]
  );
}

export async function markWinningOutcome(
  client: Queryable,
  marketId: string,
  winningOutcomeId: string
): Promise<void> {
  await client.query(
    `
      update market_outcomes
      set is_winner = (id = $2),
          updated_at = now()
      where market_id = $1
    `,
    [marketId, winningOutcomeId]
  );
}

export async function updateMarketResolved(
  client: Queryable,
  marketId: string,
  resolvedAt: string,
  settlementStatus: "processing" | "completed"
): Promise<void> {
  await client.query(
    `
      update markets
      set status = 'resolved',
          resolved_at = $2,
          settlement_status = $3,
          updated_at = now()
      where id = $1
    `,
    [marketId, resolvedAt, settlementStatus]
  );
}

export async function deletePosition(
  client: Queryable,
  userId: string,
  marketId: string,
  outcomeId: string
): Promise<void> {
  await client.query(
    `
      delete from positions
      where user_id = $1
        and market_id = $2
        and outcome_id = $3
    `,
    [userId, marketId, outcomeId]
  );
}

export async function settleContractPositions(
  client: Queryable,
  marketId: string,
  settledAt: string
): Promise<void> {
  await client.query(
    `
      update contract_positions
      set settled_at = $2,
          updated_at = now()
      where market_id = $1
        and settled_at is null
    `,
    [marketId, settledAt]
  );
}

export async function insertRealizationEvent(
  client: Queryable,
  input: {
    userId: string;
    marketId: string;
    outcomeId: string;
    resolutionId: string;
    type: "resolution_win" | "resolution_loss";
    claimStatus: "pending" | "not_applicable";
    sharesClosed: string;
    proceeds: string;
    removedCostBasis: string;
    realizedPnl: string;
  }
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
        claim_status,
        resolution_id,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
    `,
    [
      `realization_${randomUUID()}`,
      input.userId,
      input.marketId,
      input.outcomeId,
      input.type,
      input.sharesClosed,
      input.proceeds,
      input.removedCostBasis,
      input.realizedPnl,
      input.claimStatus,
      input.resolutionId
    ]
  );
}
