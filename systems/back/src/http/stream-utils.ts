/**
 * Shared helpers for the SSE stream buses / connection limiters.
 *
 * `normalizeLimit` was copy-pasted byte-identical into the market, portfolio,
 * discovery, and connection limiter modules. Callers pass their own per-stream
 * fallback, so the function itself is stream-agnostic.
 */
export function normalizeLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}
