import type { Queryable } from "../../db/client/pool";
import {
  buildCacheOptionsKey,
  readCachedMarketApiPayload
} from "../market-api/cache";
import {
  appendSettlementHistoryPoint,
  buildHistoryMovementByOutcome,
  buildHistoryPoints,
  buildHistorySeriesByOutcome,
  resolveHistoryAsOf,
  scopeHistoryPointsToRange
} from "../market-api/history-builder";
import {
  clampLimit,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  normalizeFidelityMinutes,
  normalizeHistoryInterval,
  normalizeHistoryRange,
  normalizeUnixSeconds
} from "../market-api/normalizers";
import { buildMarketDetail } from "../market-api/presenters";
import { readMarketRows } from "../market-api/market-row-reader";
import {
  readAllHistoryTradeRows,
  readHistoryTradeRows
} from "../market-api/trade-row-reader";
import { canUsePersistedHistory } from "./history-candle-store";
import { buildSampledHistoryPoints } from "./history-sampler";
import { readSampledBaseHistory } from "./base-candle-store";

// /history responses are cached this briefly to coalesce request bursts. The
// data underneath derives from the always-current base series (migration 048),
// so this is a request-coalescing window, not a staleness source.
const OPEN_MARKET_CANDLE_MAX_AGE_MS = 15_000;

// Cap on the un-backfilled-market fallback (readAllHistoryTradeRows), which
// replays every matched trade in JS with no persisted-candle shortcut. On dev,
// every traded market already has base candles (migration 048 backfill ran
// clean) — this path should be effectively dead there. It stays load-bearing
// for prod edge cases: a market that trades before its first
// appendBaseCandleFromState write, or a restore/replay that predates the
// backfill. Reuses MAX_HISTORY_LIMIT (20000) — the same ceiling the bounded
// readHistoryTradeRows path already treats as "as far as a trade replay ever
// goes" — rather than inventing a second cap to keep in sync.
// PLASTER: if hit, the chart's earliest history is truncated to this many
// trades (see `truncated` below) instead of the market's true open. Deletable
// once every traded market is guaranteed to have base candles at write time
// (i.e. once we're confident appendBaseCandleFromState never lags behind
// first trade) — at that point this whole fallback branch can go.
export const FALLBACK_TRADE_REPLAY_CAP = MAX_HISTORY_LIMIT;

// Pure so the cap-hit decision is unit-testable without standing up a real
// Queryable: row count hitting the cap is the only signal we have that the
// replay was truncated (the query has no separate "were there more?" flag).
export function isFallbackReplayTruncated(
  tradeRowCount: number,
  cap: number = FALLBACK_TRADE_REPLAY_CAP
): boolean {
  return tradeRowCount >= cap;
}

export type MarketHistoryReadOptions = {
  range?: string | null;
  interval?: string | null;
  startTs?: string | null;
  endTs?: string | null;
  fidelity?: string | null;
  limit?: string | null;
};

function normalizeHistoryOptions(options?: MarketHistoryReadOptions) {
  const range = normalizeHistoryRange(options?.range ?? options?.interval ?? null);
  const interval = normalizeHistoryInterval(range, options?.interval ?? null);
  const intervalWasExplicit = interval === options?.interval?.trim();

  return {
    range,
    interval,
    intervalWasExplicit,
    startTs: normalizeUnixSeconds(options?.startTs ?? null),
    endTs: normalizeUnixSeconds(options?.endTs ?? null),
    fidelityMinutes: normalizeFidelityMinutes(options?.fidelity ?? null),
    limit: clampLimit(options?.limit ?? null, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT)
  };
}

function buildOutcomeOrder(market: NonNullable<ReturnType<typeof buildMarketDetail>>) {
  return market.outcomes.map((outcome) => ({
    outcomeKey: outcome.outcomeKey,
    outcomeId: outcome.outcomeId,
    label: outcome.label,
    shortLabel: outcome.shortLabel,
    sortOrder: outcome.sortOrder
  }));
}

export async function readMarketHistory(
  db: Queryable,
  marketKey: string,
  options?: MarketHistoryReadOptions
) {
  return readCachedMarketApiPayload(
    `history:${marketKey}:${buildCacheOptionsKey(options ?? {})}`,
    async () => {
      const rows = await readMarketRows(db, marketKey);
      const market = buildMarketDetail(rows);

      if (!market) {
        return null;
      }

      const normalized = normalizeHistoryOptions(options);
      const asOf = resolveHistoryAsOf(rows, normalized.endTs);
      // Single always-current source: the base price series (migration 048).
      // Every range is a fresh window+downsample VIEW of it — no per-range
      // candle cache, no lazy revalidation — so ranges can't independently drift
      // stale (the old "1M/1W/6H flat/truncated while 1H moves" bug). Explicit
      // start/end windows, and markets with no base rows yet (un-backfilled or
      // pre-first-trade), fall back to a FRESH trade replay — still no persisted
      // per-range cache, so still never stale.
      const canUseBase = canUsePersistedHistory({
        startTs: normalized.startTs,
        endTs: normalized.endTs
      });

      let sampled = canUseBase
        ? await readSampledBaseHistory(db, market.marketId, {
            range: normalized.range,
            asOf,
            startTs: normalized.startTs,
            endTs: normalized.endTs
          })
        : null;

      let sourceKind: "derived_from_trades" | "persisted_candles" = "persisted_candles";
      let tradeCount = 0;
      let truncated = false;

      if (!sampled) {
        const tradeRows = canUseBase
          ? await readAllHistoryTradeRows(db, marketKey, {
              limit: FALLBACK_TRADE_REPLAY_CAP
            })
          : await readHistoryTradeRows(db, marketKey, {
              limit: String(normalized.limit)
            });

        tradeCount = tradeRows.length;
        truncated = canUseBase
          ? isFallbackReplayTruncated(tradeRows.length)
          : tradeRows.length >= normalized.limit;

        if (canUseBase && truncated) {
          // Loud because this means a market with no base candles also has
          // >= FALLBACK_TRADE_REPLAY_CAP trades — the un-backfilled-market
          // fallback is meant to cover small/edge-case markets, not this
          // volume. Should be rare-to-never; if it fires, the market needs
          // backfill-base-candles.ts run against it.
          console.error(
            "market_history.fallback_replay_capped",
            JSON.stringify({ marketKey, marketId: market.marketId, cap: FALLBACK_TRADE_REPLAY_CAP })
          );
        }

        const rawPoints = buildHistoryPoints(rows, tradeRows, {
          asOf,
          truncated
        });

        sampled = buildSampledHistoryPoints(rows, rawPoints, {
          range: normalized.range,
          interval: normalized.interval,
          startTs: normalized.startTs,
          endTs: normalized.endTs,
          asOf,
          intervalWasExplicit: normalized.intervalWasExplicit
        });
        sourceKind = "derived_from_trades";
      }

      const responsePoints = appendSettlementHistoryPoint(rows, sampled.points);

      return {
        marketKey: market.marketKey,
        marketId: market.marketId,
        range: normalized.range,
        interval: sampled.interval,
        startTs: normalized.startTs,
        endTs: normalized.endTs,
        fidelityMinutes: normalized.fidelityMinutes,
        resolutionSeconds: sampled.resolutionSeconds,
        asOf,
        marketStateVersion: market.marketStateVersion,
        source: {
          kind: sourceKind,
          persistedCandles: sourceKind === "persisted_candles",
          stale: false
        },
        sampleQuality: sampled.sampleQuality,
        pagination: {
          limit: normalized.limit,
          truncated,
          replayedTrades: tradeCount || undefined
        },
        outcomes: buildOutcomeOrder(market),
        points: responsePoints,
        seriesByOutcome: buildHistorySeriesByOutcome(rows, responsePoints),
        movementByOutcome: buildHistoryMovementByOutcome(rows, responsePoints)
      };
    },
    {
      ttlMs: OPEN_MARKET_CANDLE_MAX_AGE_MS
    }
  );
}

export async function readMarketPriceHistoryCompatibility(
  db: Queryable,
  marketKey: string,
  options?: MarketHistoryReadOptions
) {
  const rows = await readMarketRows(db, marketKey);
  const market = buildMarketDetail(rows);

  if (!market) {
    return null;
  }

  return readCachedMarketApiPayload(
    `price-history:${market.marketId}:${market.marketStateVersion}:${buildCacheOptionsKey(options ?? {})}`,
    async () => {
      const normalized = normalizeHistoryOptions(options);
      const tradeRows = await readHistoryTradeRows(db, marketKey, {
        limit: String(normalized.limit)
      });
      const asOf = resolveHistoryAsOf(rows, normalized.endTs);
      const truncated = tradeRows.length >= normalized.limit;
      const allPoints = buildHistoryPoints(rows, tradeRows, {
        asOf,
        truncated
      });
      const points = scopeHistoryPointsToRange(allPoints, normalized.range, asOf, {
        startTs: normalized.startTs,
        endTs: normalized.endTs
      });
      const responsePoints = appendSettlementHistoryPoint(rows, points);

      return {
        marketKey: market.marketKey,
        marketId: market.marketId,
        range: normalized.range,
        interval: normalized.interval,
        startTs: normalized.startTs,
        endTs: normalized.endTs,
        fidelityMinutes: normalized.fidelityMinutes,
        asOf,
        marketStateVersion: market.marketStateVersion,
        source: {
          kind: "trade_replay",
          persistedCandles: false
        },
        pagination: {
          limit: normalized.limit,
          truncated
        },
        outcomeOrder: buildOutcomeOrder(market),
        points: responsePoints,
        seriesByOutcome: buildHistorySeriesByOutcome(rows, responsePoints),
        movementByOutcome: buildHistoryMovementByOutcome(rows, responsePoints)
      };
    }
  );
}
