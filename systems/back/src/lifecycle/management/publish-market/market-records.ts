import type { PoolClient } from "pg";

import type { Queryable } from "../../../db/client/pool";
import type { MarketRow, OutcomeRow } from "./types";

export async function readLockedMarket(
  client: PoolClient,
  marketId: string
): Promise<MarketRow | null> {
  const result = await client.query<MarketRow>(
    `
      select
        id,
        status,
        title,
        category_key,
        market_family_key,
        open_at,
        close_at,
        published_at,
        liquidity_b,
        market_treasury_account_id,
        market_contract
      from markets
      where id = $1
      limit 1
      for update
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

export async function readLockedOutcomes(
  client: PoolClient,
  marketId: string
): Promise<OutcomeRow[]> {
  const result = await client.query<OutcomeRow>(
    `
      select id, market_id, sort_order
      from market_outcomes
      where market_id = $1
      order by sort_order
      for update
    `,
    [marketId]
  );

  return result.rows;
}

export async function createMarketTreasuryAccount(
  client: Queryable,
  marketId: string,
  accountId: string
): Promise<void> {
  await client.query(
    `
      insert into accounts (id, type, owner_id, status, balance_cached)
      values ($1, 'market_treasury', $2, 'active', '0.000000')
    `,
    [accountId, marketId]
  );
}

export async function updateMarketPublished(
  client: Queryable,
  marketId: string,
  publishedAt: string,
  treasuryAccountId: string
): Promise<void> {
  await client.query(
    `
      update markets
      set status = 'open',
          open_at = $2,
          published_at = $2,
          market_treasury_account_id = $3,
          updated_at = now()
      where id = $1
    `,
    [marketId, publishedAt, treasuryAccountId]
  );
}
