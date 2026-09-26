import type { Pool } from "pg";

import { readDbBackedMarketDetailPassiveRecord } from "../db/read-models/market-detail-passive";
import { readDiscoveryFeed } from "../discovery/read-discovery-feed-service";
import type { DiscoveryFeedResponse } from "../discovery/feed/types";
import { formatUnknownError, type Logger } from "../shared/logger";
import { readMarketHistory } from "./market-history/market-history-service";

const DEFAULT_PREWARM_LIMIT = 6;
const DEFAULT_PREWARM_HISTORY_RANGE = "1D";

export type MarketReadPrewarmReport = {
  generatedAt: string;
  sourceFeed: "trending";
  selectedMarkets: string[];
  marketDetail: {
    attempted: number;
    warmed: number;
  };
  history: {
    range: string;
    attempted: number;
    warmed: number;
  };
  failures: Array<{
    marketKey: string;
    target: "market_detail" | "history";
    error: string;
  }>;
};

type MarketReadPrewarmDependencies = {
  readFeed?: typeof readDiscoveryFeed;
  readMarketDetail?: typeof readDbBackedMarketDetailPassiveRecord;
  readHistory?: typeof readMarketHistory;
};

export type MarketReadPrewarmOptions = MarketReadPrewarmDependencies & {
  limit?: number;
  historyRange?: string;
  logger?: Logger;
};

function normalizePrewarmLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) {
    return DEFAULT_PREWARM_LIMIT;
  }

  return Math.max(0, Math.min(25, Math.trunc(limit)));
}

function normalizeHistoryRange(range: string | undefined): string {
  const normalized = range?.trim().toUpperCase();

  return normalized || DEFAULT_PREWARM_HISTORY_RANGE;
}

function selectTrendingMarketKeys(feed: DiscoveryFeedResponse, limit: number): string[] {
  const selected = new Set<string>();

  for (const item of feed.items) {
    if (selected.size >= limit) {
      break;
    }

    if (item.marketStatus !== "open") {
      continue;
    }

    selected.add(item.marketKey);
  }

  return [...selected];
}

export async function prewarmTrendingMarketReads(
  dbPool: Pool,
  options: MarketReadPrewarmOptions = {}
): Promise<MarketReadPrewarmReport> {
  const limit = normalizePrewarmLimit(options.limit);
  const historyRange = normalizeHistoryRange(options.historyRange);
  const readFeed = options.readFeed ?? readDiscoveryFeed;
  const readMarketDetail = options.readMarketDetail ?? readDbBackedMarketDetailPassiveRecord;
  const readHistory = options.readHistory ?? readMarketHistory;
  const feed = await readFeed(dbPool, {
    feed: "trending"
  });
  const selectedMarkets = limit > 0 ? selectTrendingMarketKeys(feed, limit) : [];
  const failures: MarketReadPrewarmReport["failures"] = [];
  let warmedMarketDetail = 0;
  let warmedHistory = 0;

  for (const marketKey of selectedMarkets) {
    try {
      if (await readMarketDetail(dbPool, marketKey)) {
        warmedMarketDetail += 1;
      }
    } catch (error) {
      failures.push({
        marketKey,
        target: "market_detail",
        error: formatUnknownError(error)
      });
    }

    try {
      if (await readHistory(dbPool, marketKey, { range: historyRange })) {
        warmedHistory += 1;
      }
    } catch (error) {
      failures.push({
        marketKey,
        target: "history",
        error: formatUnknownError(error)
      });
    }
  }

  const report: MarketReadPrewarmReport = {
    generatedAt: new Date().toISOString(),
    sourceFeed: "trending",
    selectedMarkets,
    marketDetail: {
      attempted: selectedMarkets.length,
      warmed: warmedMarketDetail
    },
    history: {
      range: historyRange,
      attempted: selectedMarkets.length,
      warmed: warmedHistory
    },
    failures
  };

  options.logger?.info("market_read_prewarm.completed", report);

  return report;
}

export function readMarketReadPrewarmRuntimeConfig(
  env: NodeJS.ProcessEnv,
  _nodeEnv: string
): {
  enabled: boolean;
  limit: number;
  historyRange: string;
} {
  const enabledValue = env.BACKEND_PREWARM_TRENDING_READS?.trim().toLowerCase();
  const enabled =
    enabledValue === "true" || enabledValue === "1"
      ? true
      : enabledValue === "false" || enabledValue === "0"
        ? false
        : false;
  const parsedLimit = Number.parseInt(env.BACKEND_PREWARM_TRENDING_LIMIT ?? "", 10);

  return {
    enabled,
    limit: normalizePrewarmLimit(Number.isNaN(parsedLimit) ? undefined : parsedLimit),
    historyRange: normalizeHistoryRange(env.BACKEND_PREWARM_HISTORY_RANGE)
  };
}
