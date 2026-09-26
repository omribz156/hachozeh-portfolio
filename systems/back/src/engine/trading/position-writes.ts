import type { PoolClient } from "pg";

import type { ContractSide } from "../contract-side-normalization";

export async function upsertPosition(
  client: PoolClient,
  actorId: string,
  marketId: string,
  outcomeId: string,
  shares: string,
  costBasis: string,
  realizedPnl: string
): Promise<void> {
  await client.query(
    `
      insert into positions (
        user_id,
        market_id,
        outcome_id,
        shares,
        cost_basis,
        realized_pnl,
        created_at,
        updated_at,
        last_trade_at
      )
      values ($1, $2, $3, $4, $5, $6, now(), now(), now())
      on conflict (user_id, market_id, outcome_id)
      do update set
        shares = excluded.shares,
        cost_basis = excluded.cost_basis,
        realized_pnl = excluded.realized_pnl,
        updated_at = now(),
        last_trade_at = now()
    `,
    [actorId, marketId, outcomeId, shares, costBasis, realizedPnl]
  );
}

export async function deletePosition(
  client: PoolClient,
  actorId: string,
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
    [actorId, marketId, outcomeId]
  );
}

export async function upsertContractPosition(
  client: PoolClient,
  actorId: string,
  marketId: string,
  requestedOutcomeId: string,
  requestedOutcomeKey: string,
  contractSide: ContractSide,
  shares: string,
  costBasis: string,
  realizedPnl: string
): Promise<void> {
  await client.query(
    `
      insert into contract_positions (
        user_id,
        market_id,
        requested_outcome_id,
        requested_outcome_key,
        contract_side,
        shares,
        cost_basis,
        realized_pnl,
        created_at,
        updated_at,
        last_trade_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())
      on conflict (user_id, market_id, requested_outcome_id, contract_side)
      do update set
        requested_outcome_key = excluded.requested_outcome_key,
        shares = excluded.shares,
        cost_basis = excluded.cost_basis,
        realized_pnl = excluded.realized_pnl,
        settled_at = null,
        updated_at = now(),
        last_trade_at = now()
    `,
    [
      actorId,
      marketId,
      requestedOutcomeId,
      requestedOutcomeKey,
      contractSide,
      shares,
      costBasis,
      realizedPnl
    ]
  );
}

export async function deleteContractPosition(
  client: PoolClient,
  actorId: string,
  marketId: string,
  requestedOutcomeId: string,
  contractSide: ContractSide
): Promise<void> {
  await client.query(
    `
      delete from contract_positions
      where user_id = $1
        and market_id = $2
        and requested_outcome_id = $3
        and contract_side = $4
    `,
    [actorId, marketId, requestedOutcomeId, contractSide]
  );
}
