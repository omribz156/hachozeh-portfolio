/**
 * backfill-base-candles — one-time populate of market_base_candles from the
 * existing trades, so markets created before migration 048 immediately have a
 * base series (instead of falling back to a fresh trade-replay until their next
 * trade appends a base row). Idempotent: re-running upserts the same minute
 * buckets. Trades maintain the base incrementally from here on
 * (trade-service.ts → appendBaseCandleFromState).
 *
 *   node --import tsx src/scripts/backfill-base-candles.ts
 */
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { readMarketRows } from "../markets/market-api/market-row-reader";
import { readAllHistoryTradeRows } from "../markets/market-api/trade-row-reader";
import { buildHistoryPoints, resolveHistoryAsOf } from "../markets/market-api/history-builder";
import { buildMarketDetail } from "../markets/market-api/presenters";
import { resolveCanonicalMarketKeyById } from "../shared/market-identity";
import { upsertBaseCandle } from "../markets/market-history/base-candle-store";

const MINUTE_MS = 60_000;

async function main(): Promise<void> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  let markets = 0;
  let buckets = 0;

  try {
    const tradedMarkets = await pool.query<{ market_id: string }>(
      `select distinct market_id from trades`
    );

    for (const { market_id } of tradedMarkets.rows) {
      const marketKey = resolveCanonicalMarketKeyById(market_id) ?? market_id;
      const rows = await readMarketRows(pool, marketKey);
      const market = buildMarketDetail(rows);
      if (!market) {
        continue;
      }

      const tradeRows = await readAllHistoryTradeRows(pool, marketKey);
      if (!tradeRows.length) {
        continue;
      }

      const asOf = resolveHistoryAsOf(rows, null);
      const points = buildHistoryPoints(rows, tradeRows, { asOf, truncated: false });

      // Collapse the replayed points to one row per minute (last value in the
      // minute = its close); points come out ascending, so the last write wins.
      const byMinute = new Map<number, Record<string, number>>();
      for (const point of points) {
        const ms = Number.isFinite(point.t) ? point.t * 1000 : Date.parse(point.at);
        if (!Number.isFinite(ms)) {
          continue;
        }
        byMinute.set(Math.floor(ms / MINUTE_MS) * MINUTE_MS, point.values);
      }

      for (const [bucketMs, values] of byMinute) {
        await upsertBaseCandle(pool, market.marketId, bucketMs, values);
        buckets += 1;
      }
      markets += 1;
      if (markets % 25 === 0) {
        console.log(`… ${markets} markets, ${buckets} buckets`);
      }
    }

    console.log(`backfill complete: ${markets} markets, ${buckets} base buckets`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("backfill-base-candles failed:", error);
  process.exit(1);
});
