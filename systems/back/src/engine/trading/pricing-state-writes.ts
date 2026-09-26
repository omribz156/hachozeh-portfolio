import type { PoolClient } from "pg";

import { calculateLmsrPrices } from "../pricing";

export async function updateOutcomeStatePrices(
  client: PoolClient,
  marketId: string,
  outcomeIds: readonly string[],
  nextQShares: readonly string[],
  liquidityB: string
): Promise<void> {
  const nextPrices = calculateLmsrPrices({
    liquidityB,
    qShares: nextQShares
  });

  for (let index = 0; index < outcomeIds.length; index += 1) {
    await client.query(
      `
        update market_outcome_state
        set q_shares = $3,
            last_price = $4,
            updated_at = now()
        where market_id = $1
          and outcome_id = $2
      `,
      [marketId, outcomeIds[index], nextQShares[index], nextPrices[index]]
    );
  }
}

export async function updateMarketPricingState(
  client: PoolClient,
  marketId: string,
  cashVolumeDelta: string
): Promise<void> {
  // total_volume rides the version-bump UPDATE that every trade already
  // issues — denormalized trade volume (buy cashSpent + sell proceeds,
  // both positive, matching sum(trades.cash_amount)) at zero added
  // round trips. Drift guard: npm run audit:total-volume.
  await client.query(
    `
      update market_pricing_state
      set version = version + 1,
          total_volume = total_volume + $2::numeric(20, 6),
          updated_at = now()
      where market_id = $1
    `,
    [marketId, cashVolumeDelta]
  );
}
