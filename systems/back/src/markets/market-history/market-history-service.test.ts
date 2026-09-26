import { describe, expect, it } from "vitest";

import {
  FALLBACK_TRADE_REPLAY_CAP,
  isFallbackReplayTruncated
} from "./market-history-service";

describe("isFallbackReplayTruncated", () => {
  it("is false when the trade replay came back under the cap (normal replay, full history)", () => {
    expect(isFallbackReplayTruncated(3, 5000)).toBe(false);
    expect(isFallbackReplayTruncated(4999, 5000)).toBe(false);
  });

  it("is true once row count reaches the cap (query LIMIT hit — degraded/partial window)", () => {
    expect(isFallbackReplayTruncated(5000, 5000)).toBe(true);
    expect(isFallbackReplayTruncated(5001, 5000)).toBe(true);
  });

  it("defaults to FALLBACK_TRADE_REPLAY_CAP when no cap is passed", () => {
    expect(isFallbackReplayTruncated(FALLBACK_TRADE_REPLAY_CAP - 1)).toBe(false);
    expect(isFallbackReplayTruncated(FALLBACK_TRADE_REPLAY_CAP)).toBe(true);
  });

  it("treats zero rows as not truncated", () => {
    expect(isFallbackReplayTruncated(0, 5000)).toBe(false);
  });
});
