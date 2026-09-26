import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { LIFECYCLE_QUEUE_DOCTOR_SQL } from "../../src/scripts/lifecycle-queue-doctor";
import { runLifecycleQueueDoctor } from "../../src/scripts/lifecycle-queue-doctor";

describe("lifecycle queue doctor", () => {
  it("reads expected resolution time from market_contract instead of a nonexistent markets column", () => {
    expect(LIFECYCLE_QUEUE_DOCTOR_SQL).toContain("m.market_contract #>> '{timeline,expectedResolutionAt}'");
    expect(LIFECYCLE_QUEUE_DOCTOR_SQL).not.toContain("m.expected_resolution_at");
  });

  it("does not block closed unresolved markets before expected resolution time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T13:00:00.000Z"));

    const db: Queryable = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "fuel-market",
            title: "Fuel market",
            status: "closed",
            close_at: new Date("2026-07-31T11:59:00.000Z"),
            closed_at: new Date("2026-07-31T12:00:03.442Z"),
            expected_resolution_at: "2026-08-01T21:15:00.000Z",
            resolved_at: null,
            market_contract: { timeline: { expectedResolutionAt: "2026-08-01T21:15:00.000Z" } },
            active_case_count: 0,
            recommended_case_count: 0,
            review_needed_case_count: 0,
            resolution_count: 0
          }
        ]
      }))
    };

    try {
      const report = await runLifecycleQueueDoctor(db);
      expect(report.blockerCount).toBe(0);
      expect(report.items[0]).toMatchObject({
        marketId: "fuel-market",
        severity: "ok",
        reason: "healthy_or_not_due"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks closed unresolved markets after expected resolution time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T22:00:00.000Z"));

    const db: Queryable = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "fuel-market",
            title: "Fuel market",
            status: "closed",
            close_at: new Date("2026-07-31T11:59:00.000Z"),
            closed_at: new Date("2026-07-31T12:00:03.442Z"),
            expected_resolution_at: "2026-08-01T21:15:00.000Z",
            resolved_at: null,
            market_contract: { timeline: { expectedResolutionAt: "2026-08-01T21:15:00.000Z" } },
            active_case_count: 0,
            recommended_case_count: 0,
            review_needed_case_count: 0,
            resolution_count: 0
          }
        ]
      }))
    };

    try {
      const report = await runLifecycleQueueDoctor(db);
      expect(report.blockerCount).toBe(1);
      expect(report.items[0]).toMatchObject({
        marketId: "fuel-market",
        severity: "blocker",
        reason: "missing_resolution_case_now"
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
