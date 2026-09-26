import { describe, expect, it, vi } from "vitest";

import { createGuestDiscoveryFeedCache } from "./discovery-feed-snapshot-cache";

const db = {} as never;
const Q = { feed: "trending", category: null };

describe("guest discovery feed cache", () => {
  it("serves a cached payload within the TTL (one underlying read for N callers)", async () => {
    let t = 1000;
    const reader = vi.fn(async () => ({ feed: "trending", items: [] }) as never);
    const cache = createGuestDiscoveryFeedCache({ ttlMs: 30_000, reader, now: () => t });

    const a = await cache.read(db, "trending:all", Q);
    const b = await cache.read(db, "trending:all", Q);
    t += 5_000; // still within TTL
    const c = await cache.read(db, "trending:all", Q);

    expect(reader).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("re-reads after the TTL expires", async () => {
    let t = 1000;
    const reader = vi.fn(async () => ({ feed: "trending", items: [] }) as never);
    const cache = createGuestDiscoveryFeedCache({ ttlMs: 30_000, reader, now: () => t });

    await cache.read(db, "trending:all", Q);
    t += 30_001; // past TTL
    await cache.read(db, "trending:all", Q);

    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("dedups concurrent in-flight reads (thundering herd on cold/expired key)", async () => {
    let resolveRead: (v: unknown) => void = () => {};
    const reader = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }) as never
    );
    const cache = createGuestDiscoveryFeedCache({ reader, now: () => 1000 });

    const p1 = cache.read(db, "trending:all", Q);
    const p2 = cache.read(db, "trending:all", Q);
    const p3 = cache.read(db, "trending:all", Q);
    resolveRead({ feed: "trending", items: [] });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(reader).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it("keys are isolated (different feed-keys do not share a payload)", async () => {
    const reader = vi.fn(async (_db, q: { feed: string | null }) => ({ feed: q.feed }) as never);
    const cache = createGuestDiscoveryFeedCache({ reader, now: () => 1000 });

    const trending = await cache.read(db, "trending:all", { feed: "trending", category: null });
    const newest = await cache.read(db, "new:all", { feed: "new", category: null });

    expect(reader).toHaveBeenCalledTimes(2);
    expect(trending).not.toBe(newest);
  });
});
