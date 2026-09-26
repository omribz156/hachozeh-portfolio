import { describe, expect, it } from "vitest";

import { buildClockAlignedBucketTimes } from "../../src/markets/market-history/bucket-times";

describe("buildClockAlignedBucketTimes", () => {
  it("snaps chart buckets to clock boundaries and keeps the last point at now", () => {
    const points = buildClockAlignedBucketTimes(
      Date.parse("2026-05-25T16:43:21.000Z"),
      Date.parse("2026-05-25T17:43:21.000Z"),
      5 * 60
    ).map((bucketMs) => new Date(bucketMs).toISOString());

    expect(points.slice(0, 4)).toEqual([
      "2026-05-25T16:45:00.000Z",
      "2026-05-25T16:50:00.000Z",
      "2026-05-25T16:55:00.000Z",
      "2026-05-25T17:00:00.000Z"
    ]);
    expect(points.at(-2)).toBe("2026-05-25T17:40:00.000Z");
    expect(points.at(-1)).toBe("2026-05-25T17:43:21.000Z");
  });

  it("uses top-of-hour buckets for hourly chart ranges", () => {
    const points = buildClockAlignedBucketTimes(
      Date.parse("2026-05-25T09:43:21.000Z"),
      Date.parse("2026-05-25T13:43:21.000Z"),
      60 * 60
    ).map((bucketMs) => new Date(bucketMs).toISOString());

    expect(points).toEqual([
      "2026-05-25T10:00:00.000Z",
      "2026-05-25T11:00:00.000Z",
      "2026-05-25T12:00:00.000Z",
      "2026-05-25T13:00:00.000Z",
      "2026-05-25T13:43:21.000Z"
    ]);
  });
});
