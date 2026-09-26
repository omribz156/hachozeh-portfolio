import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { runMarketWatchCoverageDoctor } from "../../src/scripts/market-watch-coverage-doctor";

function dbWithRows(rows: unknown[]): Queryable {
  return {
    query: vi.fn(async () => ({ rows }))
  };
}

describe("market watch coverage doctor", () => {
  it("blocks open watch-marker markets without an enabled plan", async () => {
    const report = await runMarketWatchCoverageDoctor(dbWithRows([
      {
        market_id: "market_show_child",
        event_id: "evt_show",
        title: "Show child",
        status: "open",
        marker_present: true,
        enabled_watch_plan_count: 0,
        stale_due_watch_plan_count: 0,
        next_run_at: null,
        last_checked_at: null,
        failed_delivery_signal_count: 0,
        promotion_error_signal_count: 0
      }
    ]), { now: "2026-07-15T20:00:00.000Z" });

    expect(report.status).toBe("findings");
    expect(report.blockerCount).toBe(1);
    expect(report.issues).toContainEqual({
      marketId: null,
      eventId: "evt_show",
      severity: "blocker",
      code: "missing_enabled_watch_plan",
      affectedMarketCount: 1
    });
  });

  it("surfaces stale due plans and recent signal errors", async () => {
    const report = await runMarketWatchCoverageDoctor(dbWithRows([
      {
        market_id: "market_show_child",
        event_id: "evt_show",
        title: "Show child",
        status: "open",
        marker_present: true,
        enabled_watch_plan_count: 1,
        stale_due_watch_plan_count: 1,
        next_run_at: new Date("2026-07-15T19:00:00.000Z"),
        last_checked_at: new Date("2026-07-15T18:00:00.000Z"),
        failed_delivery_signal_count: 2,
        promotion_error_signal_count: 1
      }
    ]), { now: "2026-07-15T20:00:00.000Z" });

    expect(report.status).toBe("findings");
    expect(report.warningCount).toBe(2);
    expect(report.blockerCount).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toEqual([
      "stale_due_watch_plan",
      "failed_signal_delivery",
      "promotion_error_signal"
    ]);
    expect(report.rows[0]).toMatchObject({
      marketId: "market_show_child",
      staleDueWatchPlanCount: 1,
      failedDeliverySignalCount: 2,
      promotionErrorSignalCount: 1
    });
  });

  it("dedupes event-scoped issues across child rows", async () => {
    const report = await runMarketWatchCoverageDoctor(dbWithRows([
      {
        market_id: "market_a",
        event_id: "evt_show",
        title: "A",
        status: "open",
        marker_present: true,
        enabled_watch_plan_count: 0,
        stale_due_watch_plan_count: 0,
        next_run_at: null,
        last_checked_at: null,
        failed_delivery_signal_count: 0,
        promotion_error_signal_count: 0
      },
      {
        market_id: "market_b",
        event_id: "evt_show",
        title: "B",
        status: "open",
        marker_present: true,
        enabled_watch_plan_count: 0,
        stale_due_watch_plan_count: 0,
        next_run_at: null,
        last_checked_at: null,
        failed_delivery_signal_count: 0,
        promotion_error_signal_count: 0
      }
    ]), { now: "2026-07-15T20:00:00.000Z" });

    expect(report.issueCount).toBe(1);
    expect(report.issues[0]).toMatchObject({
      marketId: null,
      eventId: "evt_show",
      code: "missing_enabled_watch_plan",
      affectedMarketCount: 2
    });
  });
});
