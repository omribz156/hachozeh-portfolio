import type { Queryable } from "../db/client/pool";
import {
  buildCacheOptionsKey,
  readCachedMarketApiPayload
} from "./market-api/cache";
export { clearMarketApiReadCacheForTest } from "./market-api/cache";
export { readMarketCatalog } from "./market-api/catalog-read-service";
export {
  readMarketHistory,
  readMarketPriceHistoryCompatibility as readMarketPriceHistory
} from "./market-history/market-history-service";
export { readMarketLifecycleEvents } from "./market-lifecycle-events-read-service";
import {
  clampLimit,
  DEFAULT_POSITION_LIMIT,
  DEFAULT_TRADE_LIMIT,
  MAX_POSITION_LIMIT,
  MAX_TRADE_LIMIT,
  normalizeContractSide,
  normalizeSide,
} from "./market-api/normalizers";
import {
  buildEmptyCommunityBoard,
  buildMarketDetail,
  buildPositionEntry,
  buildPublicUserIdentity,
  buildPublicUserLabel,
  mergePositionEntries,
  readExecutionLegs
} from "./market-api/presenters";
import { readOutcomeKey } from "./market-api/identity";
import { readMarketRows } from "./market-api/market-row-reader";
import { readPositionRows } from "./market-api/position-row-reader";
import { readTradeRows } from "./market-api/trade-row-reader";

export async function readMarket(db: Queryable, marketKey: string) {
  const rows = await readMarketRows(db, marketKey);
  const market = buildMarketDetail(rows);

  if (!market) {
    return null;
  }

  return readCachedMarketApiPayload(
    `market:${market.marketId}:${market.marketStateVersion}`,
    async () => ({ market })
  );
}

export async function readMarketPrices(db: Queryable, marketKey: string) {
  const rows = await readMarketRows(db, marketKey);
  const market = buildMarketDetail(rows);

  if (!market) {
    return null;
  }

  return readCachedMarketApiPayload(
    `prices:${market.marketId}:${market.marketStateVersion}`,
    async () => ({
      marketKey: market.marketKey,
      marketId: market.marketId,
      asOf: market.updatedAt,
      marketStatus: market.marketStatus,
      settlementStatus: market.settlementStatus,
      resolvedAt: market.resolvedAt,
      winner: market.winner,
      result: market.result,
      lifecycle: market.lifecycle,
      marketStateVersion: market.marketStateVersion,
      // volume rides the snapshot so live consumers (event ladder rows, market
      // chrome) can update נפח without a refetch — it wasn't here, so volume was
      // frozen at SSR until a full page reload. Keyed by marketStateVersion (bumps
      // on every trade), so the cached payload refreshes when volume moves.
      volume: market.volume,
      prices: market.outcomes.map((outcome) => ({
        outcomeKey: outcome.outcomeKey,
        outcomeId: outcome.outcomeId,
        label: outcome.label,
        price: outcome.lastPrice
      }))
    })
  );
}

export async function readMarketTrades(
  db: Queryable,
  marketKey: string,
  options?: {
    limit?: string | null;
    cursor?: string | null;
    side?: string | null;
    contractSide?: string | null;
    outcome?: string | null;
  }
) {
  const rows = await readMarketRows(db, marketKey);
  const market = buildMarketDetail(rows);

  if (!market) {
    return null;
  }

  return readCachedMarketApiPayload(
    `trades:${market.marketId}:${market.marketStateVersion}:${buildCacheOptionsKey(options ?? {})}`,
    async () => {
      const limit = clampLimit(options?.limit ?? null, DEFAULT_TRADE_LIMIT, MAX_TRADE_LIMIT);
      const tradeRows = await readTradeRows(db, marketKey, options);
      const side = normalizeSide(options?.side ?? null);
      const contractSide = normalizeContractSide(options?.contractSide ?? null);
      const outcomeKey = options?.outcome?.trim() || null;
      const userLabels = new Map<string, string>();
      const trades = tradeRows.map((row) => {
        let fallbackLabel = userLabels.get(row.user_id);

        if (!fallbackLabel) {
          fallbackLabel = buildPublicUserLabel(`סוחר ${userLabels.size + 1}`);
          userLabels.set(row.user_id, fallbackLabel);
        }

        const userIdentity = buildPublicUserIdentity(row, fallbackLabel);

        return {
          tradeId: row.trade_id,
          userLabel: userIdentity.userLabel,
          userHandle: userIdentity.userHandle,
          avatarLabel: userIdentity.avatarLabel,
          avatarUrl: userIdentity.avatarUrl,
          createdAt: row.created_at.toISOString(),
          side: row.side,
          contractSide: row.contract_side,
          requestedOutcomeKey: readOutcomeKey(row.requested_outcome_key),
          outcomeKey: readOutcomeKey(row.outcome_id),
          outcomeId: row.outcome_id,
          outcomeLabel: row.outcome_label,
          cashAmount: row.cash_amount,
          shareAmount: row.share_amount,
          avgPrice: row.avg_price,
          priceBefore: row.price_before,
          priceAfter: row.price_after,
          executionLegs: readExecutionLegs(row.execution_legs).map((leg) => ({
            outcomeKey: readOutcomeKey(leg.outcome_id),
            outcomeId: leg.outcome_id,
            shareAmount: leg.share_amount
          }))
        };
      });

      return {
        marketKey: market.marketKey,
        marketId: market.marketId,
        filters: {
          side,
          contractSide,
          outcomeKey
        },
        trades,
        pagination: {
          limit,
          nextCursor: trades.length === limit ? trades.at(-1)?.tradeId ?? null : null
        }
      };
    }
  );
}

export async function readMarketPositions(
  db: Queryable,
  marketKey: string,
  options?: {
    limit?: string | null;
  }
) {
  const rows = await readMarketRows(db, marketKey);
  const market = buildMarketDetail(rows);

  if (!market) {
    return null;
  }

  return readCachedMarketApiPayload(
    `positions:${market.marketId}:${market.marketStateVersion}:${buildCacheOptionsKey(options ?? {})}`,
    async () => {
      const limit = clampLimit(options?.limit ?? null, DEFAULT_POSITION_LIMIT, MAX_POSITION_LIMIT);
      // Resolved markets show the final-holdings snapshot (settlement preserves
      // shares but stamps settled_at). Live/closed markets show active holdings
      // only. Keyed off marketStatus, which is captured by marketStateVersion in
      // the cache key above, so no extra cache dimension is needed.
      const positionRows = await readPositionRows(db, marketKey, {
        ...options,
        includeSettled: market.marketStatus === "resolved"
      });
      const holdersByOutcome = buildEmptyCommunityBoard(market.outcomes);
      const positionsByOutcome = buildEmptyCommunityBoard(market.outcomes);
      const userLabels = new Map<string, string>();
      const entries = mergePositionEntries(positionRows.map((row, index) => {
        let fallbackLabel = userLabels.get(row.user_id);

        if (!fallbackLabel) {
          fallbackLabel = buildPublicUserLabel(`סוחר ${userLabels.size + 1}`);
          userLabels.set(row.user_id, fallbackLabel);
        }

        return buildPositionEntry(row, buildPublicUserIdentity(row, fallbackLabel), index);
      }));

      for (const entry of entries) {
        const holderBoard = holdersByOutcome[entry.outcomeKey];
        const positionBoard = positionsByOutcome[entry.outcomeKey];

        if (!holderBoard || !positionBoard) {
          continue;
        }

        holderBoard[entry.contractSide].push({
          userLabel: entry.userLabel,
          userHandle: entry.userHandle,
          avatarLabel: entry.avatarLabel,
          avatarUrl: entry.avatarUrl,
          avatarTone: entry.avatarTone,
          contractSide: entry.contractSide,
          outcomeKey: entry.outcomeKey,
          outcomeId: entry.outcomeId,
          outcomeLabel: entry.outcomeLabel,
          shares: entry.shares
        });
        const { userId: _userId, ...publicEntry } = entry;
        positionBoard[entry.contractSide].push(publicEntry);
      }

      return {
        marketKey: market.marketKey,
        marketId: market.marketId,
        asOf: market.updatedAt,
        marketStatus: market.marketStatus,
        settlementStatus: market.settlementStatus,
        resolvedAt: market.resolvedAt,
        winner: market.winner,
        result: market.result,
        lifecycle: market.lifecycle,
        marketStateVersion: market.marketStateVersion,
        limit,
        openPositionsCount: entries.length,
        holdersByOutcome,
        positionsByOutcome
      };
    }
  );
}
