import type { DiscoveryFeedResponse } from "./types";

const DISCOVERY_FEED_DEFAULT_LIMIT = 16;
const DISCOVERY_FEED_MAX_LIMIT = 48;

export function parseDiscoveryLimit(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DISCOVERY_FEED_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), DISCOVERY_FEED_MAX_LIMIT);
}

function decodeDiscoveryCursor(value: string | null): string | null {
  if (!value) return null;
  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const after = typeof payload?.after === "string" ? payload.after.trim() : "";
    return after || null;
  } catch {
    return null;
  }
}

function encodeDiscoveryCursor(after: string): string {
  return Buffer.from(JSON.stringify({ after }), "utf8").toString("base64url");
}

function readDiscoveryItemKey(item: DiscoveryFeedResponse["items"][number]): string {
  return item.feedKey || item.marketKey;
}

export function paginateDiscoveryFeed(
  payload: DiscoveryFeedResponse,
  options: { limit: number; cursor: string | null }
): DiscoveryFeedResponse {
  const afterFeedKey = decodeDiscoveryCursor(options.cursor);
  const matchedIndex = afterFeedKey
    ? payload.items.findIndex((item) => readDiscoveryItemKey(item) === afterFeedKey)
    : -1;
  const startIndex = afterFeedKey && matchedIndex >= 0 ? matchedIndex + 1 : 0;
  const items = payload.items.slice(startIndex, startIndex + options.limit);
  const nextIndex = startIndex + items.length;
  const hasMore = nextIndex < payload.items.length;
  const lastItem = items[items.length - 1] ?? null;

  return {
    ...payload,
    items,
    pagination: {
      limit: options.limit,
      nextCursor: hasMore && lastItem ? encodeDiscoveryCursor(readDiscoveryItemKey(lastItem)) : null,
      hasMore,
      totalAvailable: payload.items.length
    }
  };
}
