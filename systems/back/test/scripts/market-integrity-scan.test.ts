import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { runMarketIntegrityScan } from "../../src/scripts/market-integrity-scan";

describe("market integrity scan", () => {
  it.each([
    ["open", 1],
    ["closed", 0],
    ["resolved", 0]
  ] as const)("requires watch coverage only while a marked market is %s", async (status, blockerCount) => {
    const db: Queryable = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: `watch-${status}`,
            title: "Watch market",
            status,
            event_id: "evt-watch",
            close_at: new Date("2026-12-31T21:59:00.000Z"),
            market_contract: {
              objectType: "market_contract_v1",
              resolutionSource: { sourceIds: ["src_official"] }
            },
            oracle_source_policy: {},
            market_contract_text: "market-watch-pings-only-no-mutation",
            oracle_source_policy_text: "{}",
            enabled_watch_plan_count: 0,
            active_oracle_case_count: status === "closed" ? 1 : 0,
            resolution_count: status === "resolved" ? 1 : 0,
            unresolved_cascade_failure_count: 0
          }
        ]
      }))
    };

    const report = await runMarketIntegrityScan(db);

    expect(report.blockerCount).toBe(blockerCount);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      blockerCount === 1 ? ["missing_market_watch_plan"] : []
    );
  });

  it("blocks a resolution whose dependent cascade has not completed", async () => {
    const db: Queryable = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "source-market",
            title: "Source market",
            status: "resolved",
            event_id: "evt-source",
            close_at: new Date("2026-07-16T18:00:00.000Z"),
            market_contract: {
              objectType: "market_contract_v1",
              resolutionSource: { sourceIds: ["src_official"] }
            },
            oracle_source_policy: {},
            market_contract_text: "{}",
            oracle_source_policy_text: "{}",
            enabled_watch_plan_count: 0,
            active_oracle_case_count: 0,
            resolution_count: 1,
            unresolved_cascade_failure_count: 1
          }
        ]
      }))
    };

    const report = await runMarketIntegrityScan(db);

    expect(report.blockerCount).toBe(1);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        marketId: "source-market",
        code: "unresolved_resolution_cascade_failure",
        severity: "blocker"
      })
    );
  });
});
