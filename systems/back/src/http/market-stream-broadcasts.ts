import type { Pool } from "pg";

import { readMarketPrices, readMarketTrades } from "../markets/market-api-read-service";
import { formatUnknownError, type Logger } from "../shared/logger";
import { DEFAULT_MARKET_STREAM_BUS } from "./default-market-stream-bus";
import type { MarketStreamBus } from "./market-stream-bus";

type BroadcastBaseOptions = {
  dbPool: Pool;
  marketStreamBus?: MarketStreamBus;
  requestLogger: Logger;
};

type BroadcastMarketSnapshotOptions = BroadcastBaseOptions & {
  marketKey: string;
  warningEventName: string;
  warningContext?: Record<string, unknown>;
};

type BroadcastMarketTradeOptions = BroadcastBaseOptions & {
  trade: {
    marketKey: string;
    tradeId: string;
  };
};

type BroadcastMarketLifecycleOptions = BroadcastBaseOptions & {
  marketKey: string;
  action: string;
  payload: unknown;
};

type BroadcastMarketCommentOptions = BroadcastBaseOptions & {
  marketKey: string;
  eventType: "comment.new" | "comment.reply" | "comment.like" | "comment.edit" | "comment.delete";
  comment?: unknown;
  payload?: Record<string, unknown>;
};

function resolveStreamBus(marketStreamBus?: MarketStreamBus): MarketStreamBus {
  return marketStreamBus ?? DEFAULT_MARKET_STREAM_BUS;
}

function broadcastMarketSnapshot(options: BroadcastMarketSnapshotOptions): void {
  const { dbPool, marketStreamBus, requestLogger, marketKey, warningEventName, warningContext } =
    options;
  const streamBus = resolveStreamBus(marketStreamBus);

  readMarketPrices(dbPool, marketKey)
    .then((snapshotPayload) => {
      if (!snapshotPayload) {
        return;
      }

      streamBus.broadcast(marketKey, "market.snapshot", {
        eventId: `snapshot:${snapshotPayload.marketStateVersion}`,
        eventType: "snapshot",
        ...snapshotPayload
      });
    })
    .catch((error) => {
      requestLogger.warn(warningEventName, {
        marketKey,
        ...warningContext,
        error: formatUnknownError(error)
      });
    });
}

export function broadcastMarketTradeEvent(options: BroadcastMarketTradeOptions): void {
  const { dbPool, marketStreamBus, requestLogger, trade } = options;
  const streamBus = resolveStreamBus(marketStreamBus);

  // Enrich the trade push with the renderable (anonymized) activity row so clients
  // can APPEND it without a refetch. We reuse readMarketTrades → the row is
  // byte-identical to a /trades fetch and carries the same public-identity
  // anonymization. Matched by tradeId (a concurrent trade can top the list);
  // row=null → the client falls back to a refetch. The event always fires, with or
  // without the row, so liveness never depends on the lookup succeeding.
  readMarketTrades(dbPool, trade.marketKey, { limit: "5" })
    .then((payload) => {
      const row = payload?.trades?.find((entry) => entry.tradeId === trade.tradeId) ?? null;
      streamBus.broadcast(trade.marketKey, "market.trade", {
        eventId: `trade:${trade.tradeId}`,
        eventType: "trade",
        trade,
        row
      });
    })
    .catch((error) => {
      requestLogger.warn("markets.stream_trade_row_failed", {
        marketKey: trade.marketKey,
        tradeId: trade.tradeId,
        error: formatUnknownError(error)
      });
      streamBus.broadcast(trade.marketKey, "market.trade", {
        eventId: `trade:${trade.tradeId}`,
        eventType: "trade",
        trade,
        row: null
      });
    });

  broadcastMarketSnapshot({
    dbPool,
    marketStreamBus,
    requestLogger,
    marketKey: trade.marketKey,
    warningEventName: "markets.stream_snapshot_broadcast_failed"
  });
}

export function broadcastMarketLifecycleEvent(
  options: BroadcastMarketLifecycleOptions
): void {
  const { dbPool, marketStreamBus, requestLogger, marketKey, action, payload } = options;
  const streamBus = resolveStreamBus(marketStreamBus);

  streamBus.broadcast(marketKey, "market.lifecycle", {
    eventId: `lifecycle:${action}:${Date.now()}`,
    eventType: "lifecycle",
    action,
    marketKey,
    payload
  });

  broadcastMarketSnapshot({
    dbPool,
    marketStreamBus,
    requestLogger,
    marketKey,
    warningEventName: "markets.stream_lifecycle_snapshot_broadcast_failed",
    warningContext: {
      action
    }
  });
}

export function broadcastMarketCommentEvent(options: BroadcastMarketCommentOptions): void {
  const { marketStreamBus, marketKey, eventType, comment, payload } = options;
  const streamBus = resolveStreamBus(marketStreamBus);
  const commentRecord = comment && typeof comment === "object"
    ? comment as Record<string, unknown>
    : {};
  const commentId = typeof commentRecord.id === "string"
    ? commentRecord.id
    : typeof payload?.commentId === "string"
      ? payload.commentId
      : "unknown";

  streamBus.broadcast(marketKey, eventType, {
    eventId: `${eventType}:${commentId}:${Date.now()}`,
    eventType,
    marketKey,
    ...(comment ? { comment } : {}),
    ...(payload ?? {})
  });
}
