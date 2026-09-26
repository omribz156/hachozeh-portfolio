import type {
  DiscoveryFeedItem,
  DiscoveryFeedName,
  DiscoverySignalType,
  DiscoveryFeedResponse
} from "./types";

function hasSignal(item: DiscoveryFeedItem, type: DiscoverySignalType): boolean {
  return item.signals.some((signal) => signal.type === type);
}

function movementScore(item: DiscoveryFeedItem): number {
  return item.movement?.absDeltaPercent ?? 0;
}

function recentVolume(item: DiscoveryFeedItem): number {
  return Number(item.activity?.recentTradeVolume.value ?? 0);
}

function recentTradeCount(item: DiscoveryFeedItem): number {
  return Number(item.activity?.recentTradeCount ?? 0);
}

function totalVolume(item: DiscoveryFeedItem): number {
  return Number(item.volume.value);
}

function publishedTime(item: DiscoveryFeedItem): number {
  return item.publishedAt ? Date.parse(item.publishedAt) || 0 : 0;
}

export function normalizeFeed(feed: string | null): DiscoveryFeedName {
  if (feed === "new" || feed === "breaking" || feed === "closing") {
    return feed;
  }

  return "trending";
}

function buildFeedComparator(feed: DiscoveryFeedName) {
  if (feed === "new") {
    return (left: DiscoveryFeedItem, right: DiscoveryFeedItem) => {
      const leftPublishedAt = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      const rightPublishedAt = right.publishedAt ? Date.parse(right.publishedAt) : 0;

      return (
        rightPublishedAt - leftPublishedAt ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      );
    };
  }

  if (feed === "breaking") {
    return (left: DiscoveryFeedItem, right: DiscoveryFeedItem) => {
      const leftActivitySignal =
        hasSignal(left, "breaking") || hasSignal(left, "moved") || hasSignal(left, "hot")
          ? 0
          : 1;
      const rightActivitySignal =
        hasSignal(right, "breaking") || hasSignal(right, "moved") || hasSignal(right, "hot")
          ? 0
          : 1;

      return (
        movementScore(right) - movementScore(left) ||
        leftActivitySignal - rightActivitySignal ||
        Number(right.movement?.volume.value ?? 0) - Number(left.movement?.volume.value ?? 0) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        Number(right.volume.value) - Number(left.volume.value)
      );
    };
  }

  if (feed === "closing") {
    return (left: DiscoveryFeedItem, right: DiscoveryFeedItem) => {
      return (
        Date.parse(left.closeAt) - Date.parse(right.closeAt) ||
        recentVolume(right) - recentVolume(left) ||
        recentTradeCount(right) - recentTradeCount(left) ||
        totalVolume(right) - totalVolume(left) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      );
    };
  }

  return (left: DiscoveryFeedItem, right: DiscoveryFeedItem) => {
    const leftOpen = left.marketStatus === "open" ? 0 : 1;
    const rightOpen = right.marketStatus === "open" ? 0 : 1;

    return (
      leftOpen - rightOpen ||
      recentVolume(right) - recentVolume(left) ||
      recentTradeCount(right) - recentTradeCount(left) ||
      totalVolume(right) - totalVolume(left) ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      publishedTime(right) - publishedTime(left)
    );
  };
}

function buildCategoryComparator(category: string | null) {
  if (category === "economy") {
    return (left: DiscoveryFeedItem, right: DiscoveryFeedItem) => {
      return (
        Number(right.volume.value) - Number(left.volume.value) ||
        Date.parse(left.closeAt) - Date.parse(right.closeAt) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      );
    };
  }

  if (category === "politics") {
    return (left: DiscoveryFeedItem, right: DiscoveryFeedItem) => {
      return (
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        Number(right.volume.value) - Number(left.volume.value) ||
        (Date.parse(right.publishedAt ?? "") || 0) -
          (Date.parse(left.publishedAt ?? "") || 0)
      );
    };
  }

  if (category === "sports") {
    return (left: DiscoveryFeedItem, right: DiscoveryFeedItem) => {
      return (
        Date.parse(left.closeAt) - Date.parse(right.closeAt) ||
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        Number(right.volume.value) - Number(left.volume.value)
      );
    };
  }

  return null;
}

export function buildDiscoveryComparator(
  feed: DiscoveryFeedName,
  category: string | null
) {
  const feedComparator = buildFeedComparator(feed);
  const categoryComparator = feed === "trending" ? buildCategoryComparator(category) : null;

  if (!categoryComparator) {
    return feedComparator;
  }

  return (left: DiscoveryFeedItem, right: DiscoveryFeedItem) => {
    return categoryComparator(left, right) || feedComparator(left, right);
  };
}

function marketTypeKey(item: DiscoveryFeedItem): string {
  return `${item.category.key ?? "unknown"}:${item.shape}`;
}

export function diversifyDiscoveryItems(items: DiscoveryFeedItem[]): DiscoveryFeedItem[] {
  const buckets = new Map<string, DiscoveryFeedItem[]>();

  for (const item of items) {
    const key = marketTypeKey(item);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const remaining = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    items: [...bucket],
    firstIndex: items.indexOf(bucket[0] as DiscoveryFeedItem)
  }));
  const diversified: DiscoveryFeedItem[] = [];
  let previousKey: string | null = null;

  while (remaining.some((bucket) => bucket.items.length > 0)) {
    const candidates = remaining
      .filter((bucket) => bucket.items.length > 0)
      .sort((left, right) => left.firstIndex - right.firstIndex);
    const picked =
      candidates.find((bucket) => bucket.key !== previousKey) ??
      candidates[0];

    if (!picked) break;

    const [item] = picked.items.splice(0, 1);
    if (!item) continue;

    diversified.push(item);
    previousKey = picked.key;

    const nextFirst = picked.items[0];
    picked.firstIndex = nextFirst ? items.indexOf(nextFirst) : Number.MAX_SAFE_INTEGER;
  }

  return diversified;
}

export function buildFeaturedPromotion(
  items: DiscoveryFeedItem[]
): DiscoveryFeedResponse["featured"] {
  const rankedItems = [...items].sort((left, right) => {
    return (
      Number(right.volume.value) - Number(left.volume.value) ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    );
  });

  const [featuredItem] = rankedItems;

  if (!featuredItem) {
    return null;
  }

  return {
    marketKey: featuredItem.marketKey,
    reasonCode: "most_traded",
    reasonLabel: "הכי נסחר",
    metric: {
      kind: "trade_volume",
      window: "all_time",
      value: featuredItem.volume.value,
      label: featuredItem.volume.label
    }
  };
}
