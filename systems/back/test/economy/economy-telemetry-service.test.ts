import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  buildEconomyTelemetryWindow,
  readEconomyTelemetry
} from "../../src/economy/economy-telemetry-service";

function createPool(rowsByQuery: (sql: string) => unknown[]) {
  return {
    query: vi.fn(async (sql: string) => ({ rows: rowsByQuery(sql) }))
  } as unknown as Pool;
}

describe("economy telemetry service", () => {
  it("builds a bounded telemetry window", () => {
    const now = new Date("2026-06-14T12:00:00.000Z");

    expect(buildEconomyTelemetryWindow(7, now)).toEqual({
      from: new Date("2026-06-07T12:00:00.000Z"),
      to: now
    });
    expect(buildEconomyTelemetryWindow(0, now).from).toEqual(
      new Date("2026-06-13T12:00:00.000Z")
    );
    expect(buildEconomyTelemetryWindow(999, now).from).toEqual(
      new Date("2026-03-16T12:00:00.000Z")
    );
  });

  it("reads flow, treasury, active-user, and balance histogram telemetry", async () => {
    const pool = createPool((sql) => {
      if (sql.includes("from ledger_transactions")) {
        return [
          {
            local_date: "2026-06-14",
            type: "grant",
            transaction_count: 3,
            entry_sum: "375.000000"
          },
          {
            local_date: "2026-06-14",
            type: "trade_buy",
            transaction_count: "2",
            entry_sum: "-50.000000"
          }
        ];
      }

      if (sql.includes("from faucet_claims")) {
        return [
          {
            local_date: "2026-06-14",
            faucet_type: "daily_login",
            claim_count: "2",
            reward_total: "175.000000"
          }
        ];
      }

      if (sql.includes("where type in ('platform_treasury', 'mint_source')")) {
        return [
          { type: "platform_treasury", balance_cached: "999625.000000" },
          { type: "mint_source", balance_cached: "-1000000.000000" }
        ];
      }

      if (sql.includes("count(distinct user_id)::int as active_users")) {
        return [{ active_users: "3" }];
      }

      if (sql.includes("from accounts") && sql.includes("group by bucket")) {
        return [
          { bucket: "0000-0099", user_count: "1" },
          { bucket: "1000-4999", user_count: 2 }
        ];
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const snapshot = await readEconomyTelemetry(pool, {
      from: new Date("2026-06-13T00:00:00.000Z"),
      to: new Date("2026-06-15T00:00:00.000Z")
    });

    expect(snapshot).toEqual({
      from: "2026-06-13T00:00:00.000Z",
      to: "2026-06-15T00:00:00.000Z",
      timeZone: "Asia/Jerusalem",
      ledgerFlowByType: [
        {
          localDate: "2026-06-14",
          type: "grant",
          transactionCount: 3,
          entrySum: "375.000000"
        },
        {
          localDate: "2026-06-14",
          type: "trade_buy",
          transactionCount: 2,
          entrySum: "-50.000000"
        }
      ],
      faucetFlow: [
        {
          localDate: "2026-06-14",
          faucetType: "daily_login",
          claimCount: 2,
          rewardTotal: "175.000000"
        }
      ],
      treasury: {
        platformTreasury: "999625.000000",
        mintSource: "-1000000.000000"
      },
      activeUsers: 3,
      netGrantFlowPerActiveUser: "41.666667",
      balanceHistogram: [
        { bucket: "0000-0099", userCount: 1 },
        { bucket: "1000-4999", userCount: 2 }
      ]
    });
  });

  it("returns zero-like telemetry when no rows exist", async () => {
    const pool = createPool(() => []);

    const snapshot = await readEconomyTelemetry(pool, {
      from: new Date("2026-06-13T00:00:00.000Z"),
      to: new Date("2026-06-15T00:00:00.000Z")
    });

    expect(snapshot.ledgerFlowByType).toEqual([]);
    expect(snapshot.faucetFlow).toEqual([]);
    expect(snapshot.treasury).toEqual({
      platformTreasury: null,
      mintSource: null
    });
    expect(snapshot.activeUsers).toBe(0);
    expect(snapshot.netGrantFlowPerActiveUser).toBe("0.000000");
    expect(snapshot.balanceHistogram).toEqual([]);
  });

  it("rejects invalid windows", async () => {
    const pool = createPool(() => []);

    await expect(readEconomyTelemetry(pool, {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-15T00:00:00.000Z")
    })).rejects.toThrow(/before/);
  });
});
