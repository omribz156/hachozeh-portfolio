import type { Queryable } from "../../../db/client/pool";
import { calculateLmsrPrices } from "../../../engine/pricing";
import { PRICE_SCALE, quantizePrice, quantizeShares, toDecimal } from "../../../shared/decimals";

export async function insertInitialPricingState(
  client: Queryable,
  marketId: string,
  liquidityB: string
): Promise<void> {
  await client.query(
    `
      insert into market_pricing_state (market_id, version, liquidity_b, updated_at)
      values ($1, 0, $2, now())
      on conflict (market_id) do update
      set version = 0,
          liquidity_b = excluded.liquidity_b,
          updated_at = now()
    `,
    [marketId, liquidityB]
  );
}

export async function insertInitialOutcomeState(
  client: Queryable,
  marketId: string,
  outcomeIds: readonly string[],
  liquidityB: string
): Promise<void> {
  const qShares = outcomeIds.map(() => "0.000000");
  const prices = calculateLmsrPrices({
    liquidityB,
    qShares
  });

  for (let index = 0; index < outcomeIds.length; index += 1) {
    await client.query(
      `
        insert into market_outcome_state (market_id, outcome_id, q_shares, last_price, updated_at)
        values ($1, $2, $3, $4, now())
        on conflict (market_id, outcome_id) do update
        set q_shares = excluded.q_shares,
            last_price = excluded.last_price,
            updated_at = now()
      `,
      [
        marketId,
        outcomeIds[index],
        quantizeShares(0),
        prices[index] ?? quantizePrice(toDecimal(1).div(outcomeIds.length), PRICE_SCALE)
      ]
    );
  }
}
