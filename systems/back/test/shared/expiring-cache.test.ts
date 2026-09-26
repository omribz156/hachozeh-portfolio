import { describe, expect, it } from "vitest";

import { createExpiringCache } from "../../src/shared/expiring-cache";

describe("expiring cache", () => {
  it("prunes expired entries before reporting stats", () => {
    const cache = createExpiringCache<string>({
      ttlMs: 100,
      maxEntries: 10
    });

    cache.set("old", "payload", 1_000);

    expect(cache.get("old", 1_050)).toBe("payload");
    expect(cache.get("old", 1_101)).toBeUndefined();
    expect(cache.stats(1_101)).toMatchObject({
      entries: 0,
      maxEntries: 10,
      ttlMs: 100,
      nextExpiryAt: null
    });
  });

  it("bounds high-cardinality version keys", () => {
    const cache = createExpiringCache<string>({
      ttlMs: 10_000,
      maxEntries: 3
    });

    cache.set("version:1", "one", 1_000);
    cache.set("version:2", "two", 1_001);
    cache.set("version:3", "three", 1_002);
    cache.set("version:4", "four", 1_003);

    expect(cache.stats(1_004)).toMatchObject({
      entries: 3,
      maxEntries: 3
    });
    expect(cache.get("version:1", 1_004)).toBeUndefined();
    expect(cache.get("version:4", 1_004)).toBe("four");
  });

  it("allows a longer ttl for a specific entry", () => {
    const cache = createExpiringCache<string>({
      ttlMs: 100,
      maxEntries: 10
    });

    cache.set("default", "short", 1_000);
    cache.set("history", "long", 1_000, 500);

    expect(cache.get("default", 1_150)).toBeUndefined();
    expect(cache.get("history", 1_150)).toBe("long");
    expect(cache.get("history", 1_501)).toBeUndefined();
  });
});
