import type { Pool } from "pg";

import type { MarketPriceTradeRow } from "./types";

export async function readMarketPriceTrades(
  pool: Pool,
  marketId: string
): Promise<MarketPriceTradeRow[]> {
  const result = await pool.query<MarketPriceTradeRow>(
    `
      select
        id,
        outcome_id,
        side,
        cash_amount::text as cash_amount,
        share_amount::text as share_amount,
        created_at,
        price_before,
        price_after,
        coalesce(execution_legs.execution_legs, '[]'::json) as execution_legs
      from trades
      left join (
        select
          trade_id,
          json_agg(
            json_build_object(
              'outcome_id', outcome_id,
              'share_amount', share_amount::text
            )
            order by sort_order
          ) as execution_legs
        from trade_execution_legs
        group by trade_id
      ) execution_legs
        on execution_legs.trade_id = trades.id
      where market_id = $1
      order by created_at asc, id asc
    `,
    [marketId]
  );

  return result.rows;
}
