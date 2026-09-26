export type ExpiringCacheStats = {
  entries: number;
  maxEntries: number;
  ttlMs: number;
  nextExpiryAt: string | null;
  hitCount: number;
  missCount: number;
  hitRate: number;
};

type ExpiringCacheEntry<T> = {
  expiresAt: number;
  payload: T;
};

export function createExpiringCache<T>(options: {
  ttlMs: number;
  maxEntries: number;
}) {
  const ttlMs = Math.max(1, options.ttlMs);
  const maxEntries = Math.max(1, options.maxEntries);
  const entries = new Map<string, ExpiringCacheEntry<T>>();
  let hitCount = 0;
  let missCount = 0;

  function pruneExpired(now = Date.now()): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(key);
      }
    }
  }

  function enforceMaxEntries(): void {
    while (entries.size >= maxEntries) {
      const oldestKey = entries.keys().next().value as string | undefined;

      if (!oldestKey) {
        return;
      }

      entries.delete(oldestKey);
    }
  }

  return {
    get(key: string, now = Date.now()): T | undefined {
      const entry = entries.get(key);

      if (!entry) {
        missCount += 1;
        return undefined;
      }

      if (entry.expiresAt <= now) {
        entries.delete(key);
        missCount += 1;
        return undefined;
      }

      hitCount += 1;
      return entry.payload;
    },
    set(key: string, payload: T, now = Date.now(), ttlMsOverride?: number): void {
      pruneExpired(now);
      entries.delete(key);
      enforceMaxEntries();
      entries.set(key, {
        expiresAt: now + Math.max(1, ttlMsOverride ?? ttlMs),
        payload
      });
    },
    delete(key: string): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
      hitCount = 0;
      missCount = 0;
    },
    stats(now = Date.now()): ExpiringCacheStats {
      pruneExpired(now);

      let nextExpiryAt: number | null = null;

      for (const entry of entries.values()) {
        if (nextExpiryAt === null || entry.expiresAt < nextExpiryAt) {
          nextExpiryAt = entry.expiresAt;
        }
      }

      return {
        entries: entries.size,
        maxEntries,
        ttlMs,
        nextExpiryAt: nextExpiryAt === null ? null : new Date(nextExpiryAt).toISOString(),
        hitCount,
        missCount,
        hitRate: hitCount + missCount > 0
          ? Number((hitCount / (hitCount + missCount)).toFixed(4))
          : 0
      };
    }
  };
}
