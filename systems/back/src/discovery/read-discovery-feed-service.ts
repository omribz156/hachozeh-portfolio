import type { Queryable } from "../db/client/pool";
import {
  resolveBackendCategoryKeys,
  resolveFrontendCategoryKey
} from "../shared/market-category";
import {
  buildDiscoveryGroups,
  groupRowsByMarket,
  readFirstDiscoveryRow,
  type DiscoveryGroup
} from "./feed/event-groups";
import { buildFeedItem } from "./feed/presenter";
import {
  readDiscoveryFeedRows,
  readDiscoveryMovementRows,
  readDiscoveryViewerPositionRows
} from "./feed/query";
import {
  buildDiscoveryComparator,
  diversifyDiscoveryItems,
  buildFeaturedPromotion,
  normalizeFeed
} from "./feed/ranking";
import {
  applyDiscoveryCuration,
  readDiscoveryCurationSettings,
  readActiveDiscoveryCurationSlots,
  type DiscoveryCurationSlot
} from "./feed/curation";
export type {
  DiscoveryFeedItem,
  DiscoveryFeedName,
  DiscoveryFeedResponse
} from "./feed/types";
import type {
  DiscoveryFeedRow,
  DiscoveryFeedItem,
  DiscoveryMovementRow,
  DiscoveryViewerPositionRow,
  DiscoveryFeedResponse
} from "./feed/types";

const HOT_RECENT_TRADE_MIN_COUNT = 3;
const HOT_RECENT_VOLUME_MIN = 500;
const HOT_MAX_ITEMS = 4;
const HOT_MAX_SHARE = 0.2;
const BREAKING_MOVEMENT_MIN_ABS_DELTA = 0.01;
const BREAKING_MOVEMENT_MIN_VOLUME = 1;
const DISCOVERY_HERO_ITEM_LIMIT = 10;

function buildHotRankByMarket(discoveryGroups: DiscoveryGroup[]): Map<string, number> {
  const limit = Math.min(
    HOT_MAX_ITEMS,
    Math.max(1, Math.ceil(discoveryGroups.length * HOT_MAX_SHARE))
  );
  const candidates = discoveryGroups
    .map((group) => readFirstDiscoveryRow(group.rows))
    .filter((row): row is DiscoveryFeedRow => Boolean(row))
    .filter((row) => {
      const recentTradeCount = Number(row.recent_trade_count ?? 0);
      const recentTradeVolume = Number(row.recent_trade_volume ?? 0);

      return (
        row.market_status === "open" &&
        recentTradeCount >= HOT_RECENT_TRADE_MIN_COUNT &&
        recentTradeVolume >= HOT_RECENT_VOLUME_MIN
      );
    })
    .sort((left, right) => {
      return (
        Number(right.recent_trade_volume ?? 0) - Number(left.recent_trade_volume ?? 0) ||
        Number(right.recent_trade_count ?? 0) - Number(left.recent_trade_count ?? 0) ||
        right.updated_at.getTime() - left.updated_at.getTime()
      );
    })
    .slice(0, limit);

  return new Map(candidates.map((row, index) => [row.market_id, index + 1]));
}

function buildMovementByMarket(rows: DiscoveryMovementRow[]): Map<string, DiscoveryMovementRow> {
  const candidates = rows
    .filter((row) => {
      const absDelta = Number(row.abs_delta);
      const tradeVolume = Number(row.trade_volume);

      return (
        Number.isFinite(absDelta) &&
        Number.isFinite(tradeVolume) &&
        absDelta >= BREAKING_MOVEMENT_MIN_ABS_DELTA &&
        tradeVolume >= BREAKING_MOVEMENT_MIN_VOLUME &&
        Number(row.trade_count) > 0
      );
    })
    .sort((left, right) => {
      return (
        Number(right.abs_delta) - Number(left.abs_delta) ||
        Number(right.trade_volume) - Number(left.trade_volume) ||
        Number(right.trade_count) - Number(left.trade_count)
      );
    });

  const movementByMarket = new Map<string, DiscoveryMovementRow>();

  for (const row of candidates) {
    if (!movementByMarket.has(row.market_id)) {
      movementByMarket.set(row.market_id, row);
    }
  }

  return movementByMarket;
}

function compareMovementRows(
  left: DiscoveryMovementRow,
  right: DiscoveryMovementRow
): number {
  return (
    Number(right.abs_delta) - Number(left.abs_delta) ||
    Number(right.trade_volume) - Number(left.trade_volume) ||
    Number(right.trade_count) - Number(left.trade_count)
  );
}

function readBestMovementForGroup(
  group: DiscoveryGroup,
  movementByMarket: Map<string, DiscoveryMovementRow>
): DiscoveryMovementRow | null {
  const candidates = group.marketIds
    .map((marketId) => movementByMarket.get(marketId))
    .filter((row): row is DiscoveryMovementRow => Boolean(row))
    .sort(compareMovementRows);

  return candidates[0] ?? null;
}

function readViewerPositionForGroup(
  group: DiscoveryGroup,
  viewerPositionByMarket: Map<string, DiscoveryViewerPositionRow>
): DiscoveryViewerPositionRow | null {
  return (
    viewerPositionByMarket.get(group.representativeMarketId) ??
    group.marketIds.map((marketId) => viewerPositionByMarket.get(marketId)).find(Boolean) ??
    null
  );
}

export async function readDiscoveryFeed(
  db: Queryable,
  options?: {
    feed?: string | null;
    category?: string | null;
    viewerUserId?: string | null;
  }
): Promise<DiscoveryFeedResponse> {
  const feed = normalizeFeed(options?.feed ?? null);
  const frontendCategory =
    resolveFrontendCategoryKey(options?.category ?? null) ??
    options?.category?.trim() ??
    null;
  const categoryKeys = resolveBackendCategoryKeys(options?.category ?? null);
  const rows = await readDiscoveryFeedRows(db, categoryKeys);
  const groupedRowsByMarket = groupRowsByMarket(rows);
  const discoveryGroups = buildDiscoveryGroups(groupedRowsByMarket, {
    preferSingleChildEventCards: Boolean(frontendCategory)
  });
  const groupMarketIds = [...new Set(discoveryGroups.flatMap((group) => group.marketIds))];

  const [movementRows, viewerPositionRows, curationSlots, curationSettings] = await Promise.all([
    feed === "breaking"
      ? readDiscoveryMovementRows(db, groupMarketIds)
      : Promise.resolve<DiscoveryMovementRow[]>([]),
    options?.viewerUserId
      ? readDiscoveryViewerPositionRows(db, options.viewerUserId, groupMarketIds)
      : Promise.resolve<DiscoveryViewerPositionRow[]>([]),
    feed === "trending"
      ? readActiveDiscoveryCurationSlots(db)
      : Promise.resolve<DiscoveryCurationSlot[]>([]),
    feed === "trending"
      ? readDiscoveryCurationSettings(db)
      : Promise.resolve(new Map())
  ]);
  const movementByMarket = feed === "breaking"
    ? buildMovementByMarket(movementRows)
    : new Map<string, DiscoveryMovementRow>();
  const viewerPositionByMarket = new Map(
    viewerPositionRows.map((position) => [position.market_id, position])
  );
  const hotRankByMarket = buildHotRankByMarket(discoveryGroups);
  const nowMs = Date.now();
  const closingSoonCutoffMs = nowMs + 24 * 60 * 60 * 1000;
  const rankedItems = discoveryGroups
    .map((group) =>
      buildFeedItem(
        group.rows,
        readViewerPositionForGroup(group, viewerPositionByMarket),
        {
          hotRank: hotRankByMarket.get(group.representativeMarketId) ?? null,
          movementRow: readBestMovementForGroup(group, movementByMarket)
        }
      )
    )
    .filter((item): item is DiscoveryFeedItem => Boolean(item))
    .filter((item) => item.marketStatus === "open")
    .filter((item) => feed !== "breaking" || item.movement)
    .filter((item) => {
      if (feed !== "closing") return true;
      const closeAtMs = Date.parse(item.closeAt);
      return Number.isFinite(closeAtMs) && closeAtMs > nowMs && closeAtMs <= closingSoonCutoffMs;
    })
    .filter((item) => {
      if (feed !== "trending" || frontendCategory) return true;
      return item.isEventChildCard !== true;
    })
    .sort(buildDiscoveryComparator(feed, frontendCategory));
  const automaticItems = feed === "trending"
    ? diversifyDiscoveryItems(rankedItems)
    : rankedItems;
  const items = feed === "trending"
    ? applyDiscoveryCuration(automaticItems, curationSlots, "trending")
    : automaticItems;
  const heroSlots = curationSlots.filter((slot) => slot.surface === "hero");
  const heroSettings = curationSettings.get("hero");
  const heroLimit = heroSettings?.maxItems ?? DISCOVERY_HERO_ITEM_LIMIT;
  const heroFill = heroSettings?.fill ?? true;
  const hasHeroCuration = heroSlots.length > 0 || Boolean(heroSettings);
  const heroItems = feed === "trending"
    ? hasHeroCuration
      ? applyDiscoveryCuration(automaticItems, curationSlots, "hero", {
          limit: heroLimit,
          fill: heroFill
        })
      : items.slice(0, heroLimit)
    : items.slice(0, heroLimit);

  return {
    feed,
    category: frontendCategory,
    generatedAt: new Date().toISOString(),
    featured: buildFeaturedPromotion(items),
    heroItems,
    items
  };
}
