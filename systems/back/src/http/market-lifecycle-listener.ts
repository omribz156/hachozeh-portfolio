import { Client, type Pool } from "pg";

import type { AppEnv } from "../config/env";
import { resolveCanonicalMarketKeyById } from "../shared/market-identity";
import { formatUnknownError, type Logger } from "../shared/logger";
import { DEFAULT_MARKET_STREAM_BUS } from "./default-market-stream-bus";
import { DEFAULT_PORTFOLIO_STREAM_BUS } from "./default-portfolio-stream-bus";
import type { MarketStreamBus } from "./market-stream-bus";
import { broadcastMarketLifecycleEvent } from "./market-stream-broadcasts";
import { broadcastPortfolioInvalidation } from "./portfolio-invalidation";
import type { PortfolioStreamBus } from "./portfolio-stream-bus";

const RECONNECT_MS = 2_000;
const CHANNEL = "market_lifecycle";

export type MarketLifecycleStatus = "closed" | "resolved" | "voided";

export type MarketLifecycleNotice = {
  marketId: string;
  status: MarketLifecycleStatus;
};

// Terminal transitions that settle holders → need a portfolio fan-out. `closed` only ends
// trading (no balance/position change), so it is NOT here.
type SettlingStatus = "resolved" | "voided";

export type MarketLifecycleDispatchDeps = {
  dbPool: Pool;
  marketStreamBus: MarketStreamBus;
  portfolioStreamBus: PortfolioStreamBus;
  logger: Logger;
  // Injectable for tests; defaults to the per-status reads below.
  readAffectedUserIds?: (
    dbPool: Pool,
    marketId: string,
    status: SettlingStatus
  ) => Promise<string[]>;
};

// Who to push when a market settles. Positions are DELETED during both resolution and void,
// so the affected set can't come from the positions table post-commit:
//   - resolved → realization_events (one win/loss row per holder; a market resolves once).
//   - voided   → the void_refund ledger transactions credit each holder's user_cash account;
//                join entries → accounts to recover the owners.
async function defaultReadAffectedUserIds(
  dbPool: Pool,
  marketId: string,
  status: SettlingStatus
): Promise<string[]> {
  if (status === "voided") {
    const result = await dbPool.query<{ user_id: string }>(
      `
        select distinct a.owner_id as user_id
        from ledger_transactions lt
        join ledger_entries le on le.transaction_id = lt.id
        join accounts a on a.id = le.account_id
        where lt.type = 'void_refund'
          and lt.market_id = $1
          and a.type = 'user_cash'
      `,
      [marketId]
    );
    return result.rows.map((row) => row.user_id);
  }

  const result = await dbPool.query<{ user_id: string }>(
    `
      select distinct user_id
      from realization_events
      where market_id = $1
        and type in ('resolution_win', 'resolution_loss')
    `,
    [marketId]
  );
  return result.rows.map((row) => row.user_id);
}

export function parseMarketLifecycleNotice(
  payload: string | undefined
): MarketLifecycleNotice | null {
  if (!payload) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const marketId = record.marketId;
  const status = record.status;
  if (typeof marketId !== "string" || !marketId) {
    return null;
  }
  if (status !== "closed" && status !== "resolved" && status !== "voided") {
    return null;
  }
  return { marketId, status };
}

// The fan-out, factored out of the pg plumbing so it is unit-testable with fake buses.
export async function dispatchMarketLifecycle(
  notice: MarketLifecycleNotice,
  deps: MarketLifecycleDispatchDeps
): Promise<void> {
  const { dbPool, marketStreamBus, portfolioStreamBus, logger } = deps;
  // The SSE buses key by the CANONICAL market key (what readMarketPrices returns and what
  // clients connect under); the trigger only knows the row id. Map id -> canonical key.
  const canonicalKey = resolveCanonicalMarketKeyById(notice.marketId) ?? notice.marketId;

  // Market detail page: flip the SSR-baked lifecycle chrome + re-read the price snapshot.
  // Fires for every terminal transition (closed / resolved / voided).
  broadcastMarketLifecycleEvent({
    dbPool,
    marketStreamBus,
    requestLogger: logger,
    marketKey: canonicalKey,
    action: notice.status,
    payload: { status: notice.status, source: "oracle_bridge" }
  });

  // Auto-close only ends trading — no balance/position change, so no portfolio fan-out.
  // Resolution and void both settle holders (positions cleared; void also credits cash).
  if (notice.status === "closed") {
    return;
  }

  const readAffectedUserIds = deps.readAffectedUserIds ?? defaultReadAffectedUserIds;
  let userIds: string[];
  try {
    userIds = await readAffectedUserIds(dbPool, notice.marketId, notice.status);
  } catch (error) {
    logger.warn("market_lifecycle_listener.affected_users_failed", {
      marketId: notice.marketId,
      status: notice.status,
      error: formatUnknownError(error)
    });
    return;
  }

  // Push each settled holder's portfolio: positions cleared + (resolved) winnings now
  // claimable / (voided) cost basis refunded to cash. reason maps to the existing invalidation
  // taxonomy so the client refetch is identical to an in-process settle/void.
  const reason = notice.status === "voided" ? "void" : "settlement";
  for (const userId of userIds) {
    broadcastPortfolioInvalidation(
      { dbPool, portfolioStreamBus },
      {
        actor: { actorId: userId, mode: "session" },
        reason,
        marketKey: canonicalKey
      }
    );
  }

  logger.info("market_lifecycle_listener.settle_fanout", {
    marketId: notice.marketId,
    status: notice.status,
    holderCount: userIds.length
  });
}

// One dedicated Postgres LISTEN connection, held in the API process. Migration 060 makes
// every markets status transition to closed/resolved fire NOTIFY 'market_lifecycle'. This is
// the cross-process bridge: the oracle worker auto-closes/auto-resolves markets but holds no
// SSE connections; the DB relays the event to the API process where the live viewers are. A
// dropped connection auto-reconnects (mirrors notification-listener.ts).
export function startMarketLifecycleListener(options: {
  env: AppEnv;
  logger: Logger;
  dbPool: Pool;
  marketStreamBus?: MarketStreamBus;
  portfolioStreamBus?: PortfolioStreamBus;
}): { stop: () => void } {
  const { env, logger, dbPool } = options;
  const marketStreamBus = options.marketStreamBus ?? DEFAULT_MARKET_STREAM_BUS;
  const portfolioStreamBus = options.portfolioStreamBus ?? DEFAULT_PORTFOLIO_STREAM_BUS;
  let client: Client | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const dead = client;
    client = null;
    if (dead) {
      dead.removeAllListeners();
      dead.end().catch(() => {});
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RECONNECT_MS);
    reconnectTimer.unref?.();
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const next = new Client({
      host: env.db.host,
      port: env.db.port,
      database: env.db.name,
      user: env.db.user,
      password: env.db.password,
      application_name: "hachozeh-market-lifecycle-listener"
    });
    client = next;
    next.on("notification", (message) => {
      if (message.channel !== CHANNEL) return;
      const notice = parseMarketLifecycleNotice(message.payload);
      if (!notice) return;
      void dispatchMarketLifecycle(notice, {
        dbPool,
        marketStreamBus,
        portfolioStreamBus,
        logger
      }).catch((error) => {
        logger.warn("market_lifecycle_listener.dispatch_failed", {
          marketId: notice.marketId,
          error: formatUnknownError(error)
        });
      });
    });
    next.on("error", (error) => {
      logger.warn("market_lifecycle_listener.client_error", { error: formatUnknownError(error) });
      scheduleReconnect();
    });
    try {
      await next.connect();
      await next.query(`listen ${CHANNEL}`);
      logger.info("market_lifecycle_listener.listening");
    } catch (error) {
      logger.warn("market_lifecycle_listener.connect_failed", { error: formatUnknownError(error) });
      scheduleReconnect();
    }
  }

  void connect();

  return {
    stop(): void {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const dead = client;
      client = null;
      if (dead) {
        dead.removeAllListeners();
        dead.end().catch(() => {});
      }
    }
  };
}
