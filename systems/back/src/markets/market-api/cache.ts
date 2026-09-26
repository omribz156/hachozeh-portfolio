import { createExpiringCache } from "../../shared/expiring-cache";

const MARKET_API_READ_CACHE_TTL_MS = 2_000;
const MARKET_API_READ_CACHE_MAX_ENTRIES = 1_000;
const MARKET_API_READ_CACHE = createExpiringCache<unknown>({
  ttlMs: MARKET_API_READ_CACHE_TTL_MS,
  maxEntries: MARKET_API_READ_CACHE_MAX_ENTRIES
});
const MARKET_API_READ_IN_FLIGHT = new Map<string, Promise<unknown>>();

export function buildCacheOptionsKey(options: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(options)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
    )
  );
}

export async function readCachedMarketApiPayload<T>(
  cacheKey: string,
  buildPayload: () => Promise<T>,
  options?: {
    ttlMs?: number;
  }
): Promise<T> {
  const now = Date.now();
  const cachedPayload = MARKET_API_READ_CACHE.get(cacheKey, now);

  if (cachedPayload !== undefined) {
    return cachedPayload as T;
  }

  const inFlight = MARKET_API_READ_IN_FLIGHT.get(cacheKey);

  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const payloadPromise = buildPayload();
  MARKET_API_READ_IN_FLIGHT.set(cacheKey, payloadPromise as Promise<unknown>);

  try {
    const payload = await payloadPromise;
    MARKET_API_READ_CACHE.set(cacheKey, payload, Date.now(), options?.ttlMs);

    return payload;
  } finally {
    MARKET_API_READ_IN_FLIGHT.delete(cacheKey);
  }
}

export function clearMarketApiReadCacheForTest(): void {
  MARKET_API_READ_CACHE.clear();
  MARKET_API_READ_IN_FLIGHT.clear();
}

export function readMarketApiReadCacheStats() {
  return {
    ...MARKET_API_READ_CACHE.stats(),
    inFlight: MARKET_API_READ_IN_FLIGHT.size
  };
}
