import type { Pool } from "pg";

import { readDiscoveryFeed } from "../discovery/read-discovery-feed-service";

// The discovery feed snapshot is viewer-personalized only by a thin per-viewer POSITION
// overlay; the expensive base (grouping, market reads, prices, volumes) is identical for every
// viewer of a given feed-key. Logged-out viewers get no overlay at all, so their payload is
// fully shared. Discovery traffic is mostly logged-out browsing, and each open feed-stream
// re-queries every 30s — so without sharing, N guests on /trending = N identical base queries
// every 30s. This caches the GUEST snapshot per feed-key (same 30s cadence) with in-flight
// dedup, collapsing that fan-in to one query per key. Logged-in viewers bypass the cache and
// keep their personalized read (see discovery.ts) — that tail is left as a later optimization.

type FeedQuery = { feed: string | null; category: string | null };
type FeedPayload = Awaited<ReturnType<typeof readDiscoveryFeed>>;
type GuestFeedReader = (db: Pool, query: FeedQuery) => Promise<FeedPayload>;

const DEFAULT_TTL_MS = 30_000;

export function createGuestDiscoveryFeedCache(options?: {
  ttlMs?: number;
  reader?: GuestFeedReader;
  now?: () => number;
}) {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const now = options?.now ?? (() => Date.now());
  const reader: GuestFeedReader =
    options?.reader ??
    ((db, query) =>
      readDiscoveryFeed(db, { feed: query.feed, category: query.category, viewerUserId: null }));

  const cache = new Map<string, { at: number; payload: FeedPayload }>();
  const inflight = new Map<string, Promise<FeedPayload>>();

  return {
    // streamKey is the caller's already-normalized feed:category key, so the cache shares the
    // exact grouping the connection limiter uses.
    async read(db: Pool, streamKey: string, query: FeedQuery): Promise<FeedPayload> {
      const fresh = cache.get(streamKey);
      if (fresh && now() - fresh.at < ttlMs) {
        return fresh.payload;
      }
      const pending = inflight.get(streamKey);
      if (pending) {
        return pending;
      }
      const next = reader(db, query)
        .then((payload) => {
          cache.set(streamKey, { at: now(), payload });
          return payload;
        })
        .finally(() => {
          inflight.delete(streamKey);
        });
      inflight.set(streamKey, next);
      return next;
    },
    stats(): { keys: number; inflight: number } {
      return { keys: cache.size, inflight: inflight.size };
    }
  };
}

export type GuestDiscoveryFeedCache = ReturnType<typeof createGuestDiscoveryFeedCache>;

export const DEFAULT_GUEST_DISCOVERY_FEED_CACHE = createGuestDiscoveryFeedCache();
