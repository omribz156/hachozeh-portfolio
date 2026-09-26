import { describe, expect, it } from "vitest";

import { resolutionSecondsForSpan } from "../../../src/markets/market-history/base-candle-store";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("resolutionSecondsForSpan", () => {
  // Bucket is driven by the visible span, not the range label. A sub-6h span —
  // any young market, or the 1H/6H windows — is 1-min, never the old 5-min jump.
  it("buckets any span up to 6h at 1 minute", () => {
    expect(resolutionSecondsForSpan(30 * MIN)).toBe(60);
    expect(resolutionSecondsForSpan(1 * HOUR)).toBe(60);
    expect(resolutionSecondsForSpan(6 * HOUR)).toBe(60);
  });

  // On a mature market each range's window lands on its familiar cadence, and
  // crossing a window boundary steps the bucket up.
  it("steps up just past each window boundary", () => {
    expect(resolutionSecondsForSpan(6 * HOUR + MIN)).toBe(5 * 60); // > 6h  → 1D cadence
    expect(resolutionSecondsForSpan(1 * DAY)).toBe(5 * 60);
    expect(resolutionSecondsForSpan(1 * DAY + MIN)).toBe(30 * 60); // > 1d  → 1W cadence
    expect(resolutionSecondsForSpan(7 * DAY)).toBe(30 * 60);
    expect(resolutionSecondsForSpan(7 * DAY + MIN)).toBe(4 * 60 * 60); // > 1w → 1M cadence
    expect(resolutionSecondsForSpan(30 * DAY)).toBe(4 * 60 * 60);
  });

  it("coarsens further for very long spans (ALL on old markets)", () => {
    expect(resolutionSecondsForSpan(90 * DAY)).toBe(12 * 60 * 60);
    expect(resolutionSecondsForSpan(300 * DAY)).toBe(24 * 60 * 60);
  });
});
