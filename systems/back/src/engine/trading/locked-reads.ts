import type { PoolClient } from "pg";

import type { ContractSide } from "../contract-side-normalization";
import type {
  AccountRow,
  ContractPositionRow,
  MarketRow,
  PositionRow
} from "./trade-types";

export async function readLockedMarketRows(
  client: PoolClient,
  marketId: string
): Promise<MarketRow[]> {
  const result = await client.query<MarketRow>(
    `
      select
        m.id as market_id,
        m.status as market_status,
        m.close_at as market_close_at,
        m.event_id,
        m.market_contract,
        m.market_treasury_account_id,
        ps.version as market_state_version,
        ps.liquidity_b,
        o.id as outcome_id,
        os.q_shares,
        o.sort_order
      from markets m
      join market_pricing_state ps
        on ps.market_id = m.id
      join market_outcomes o
        on o.market_id = m.id
      join market_outcome_state os
        on os.market_id = m.id
       and os.outcome_id = o.id
      where m.id = $1
      order by o.sort_order
      for update of m, ps, os
    `,
    [marketId]
  );

  return result.rows;
}

export async function readLockedUserCashAccount(
  client: PoolClient,
  actorId: string
): Promise<AccountRow | null> {
  const result = await client.query<AccountRow>(
    `
      select id, status, balance_cached
      from accounts
      where type = 'user_cash'
        and owner_id = $1
      limit 1
      for update
    `,
    [actorId]
  );

  return result.rows[0] ?? null;
}

export async function readLockedMarketTreasuryAccount(
  client: PoolClient,
  accountId: string
): Promise<AccountRow | null> {
  const result = await client.query<AccountRow>(
    `
      select id, status, balance_cached
      from accounts
      where id = $1
      limit 1
      for update
    `,
    [accountId]
  );

  return result.rows[0] ?? null;
}

export async function readLockedPositions(
  client: PoolClient,
  actorId: string,
  marketId: string,
  outcomeIds: readonly string[]
): Promise<Map<string, PositionRow>> {
  if (!outcomeIds.length) {
    return new Map();
  }

  const result = await client.query<PositionRow>(
    `
      select user_id, market_id, outcome_id, shares, cost_basis, realized_pnl
      from positions
      where user_id = $1
        and market_id = $2
        and outcome_id = any($3::text[])
      for update
    `,
    [actorId, marketId, outcomeIds]
  );

  return new Map(result.rows.map((row) => [row.outcome_id, row]));
}

export async function readLockedContractPosition(
  client: PoolClient,
  actorId: string,
  marketId: string,
  requestedOutcomeId: string,
  contractSide: ContractSide
): Promise<ContractPositionRow | null> {
  const result = await client.query<ContractPositionRow>(
    `
      select
        user_id,
        market_id,
        requested_outcome_id,
        requested_outcome_key,
        contract_side,
        shares,
        cost_basis,
        realized_pnl
      from contract_positions
      where user_id = $1
        and market_id = $2
        and requested_outcome_id = $3
        and contract_side = $4
        and settled_at is null
      limit 1
      for update
    `,
    [actorId, marketId, requestedOutcomeId, contractSide]
  );

  return result.rows[0] ?? null;
}
