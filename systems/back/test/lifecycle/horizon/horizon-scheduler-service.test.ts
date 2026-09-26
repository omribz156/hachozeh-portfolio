import { describe, expect, it } from "vitest";

import {
  calculateHorizonSchedulerSleepMs,
  normalizeSchedulerInteger,
  readHorizonSchedulerClockSnapshot
} from "../../../src/lifecycle/horizon/scheduler-service";

describe("horizon scheduler sleep", () => {
  const now = new Date("2026-06-25T10:00:00.000Z");

  it("wakes quickly after due work so a limited sweep can continue", () => {
    expect(
      calculateHorizonSchedulerSleepMs({
        now,
        nextCloseAt: "2026-06-25T10:10:00.000Z",
        minSleepMs: 1_000,
        maxSleepMs: 30_000,
        hadDueWork: true
      })
    ).toBe(1_000);
  });

  it("sleeps until the next close when it is inside the max wake window", () => {
    expect(
      calculateHorizonSchedulerSleepMs({
        now,
        nextCloseAt: "2026-06-25T10:00:12.000Z",
        minSleepMs: 1_000,
        maxSleepMs: 30_000,
        hadDueWork: false
      })
    ).toBe(12_000);
  });

  it("caps sleep by the max wake interval", () => {
    expect(
      calculateHorizonSchedulerSleepMs({
        now,
        nextCloseAt: "2026-06-25T11:00:00.000Z",
        minSleepMs: 1_000,
        maxSleepMs: 30_000,
        hadDueWork: false
      })
    ).toBe(30_000);
  });

  it("uses min sleep when the next close is already due", () => {
    expect(
      calculateHorizonSchedulerSleepMs({
        now,
        nextCloseAt: "2026-06-25T09:59:59.000Z",
        minSleepMs: 1_000,
        maxSleepMs: 30_000,
        hadDueWork: false
      })
    ).toBe(1_000);
  });
});

describe("normalize scheduler integers", () => {
  it("accepts bounded integer strings", () => {
    expect(
      normalizeSchedulerInteger("30", 10, {
        min: 1,
        max: 60,
        fieldName: "interval"
      })
    ).toBe(30);
  });

  it("rejects out-of-range values", () => {
    expect(() =>
      normalizeSchedulerInteger("0", 10, {
        min: 1,
        max: 60,
        fieldName: "interval"
      })
    ).toThrow("interval must be an integer between 1 and 60.");
  });
});

describe("horizon scheduler DB clock snapshot", () => {
  it("normalizes DB now, next close, and overdue count", async () => {
    const snapshot = await readHorizonSchedulerClockSnapshot({
      query: async () => ({
        rows: [
          {
            db_now: new Date("2026-06-25T10:00:00.000Z"),
            next_close_at: new Date("2026-06-25T10:05:00.000Z"),
            overdue_open_market_count: "2"
          }
        ],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: []
      })
    });

    expect(snapshot).toEqual({
      dbNow: "2026-06-25T10:00:00.000Z",
      nextCloseAt: "2026-06-25T10:05:00.000Z",
      overdueOpenMarketCount: 2
    });
  });
});
