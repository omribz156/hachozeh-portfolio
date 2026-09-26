import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { buildKnownResultTradePlan } from "../../src/scripts/market-known-result-trades";

function dbWithTrades(ids: string[], queries: string[] = []): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("from markets m")) {
        return { rows: [{
          id: "market-1", title: "France", status: "closed", settlement_status: "not_started",
          resolved_at: null, liquidity_b: "5000", market_treasury_account_id: "treasury-1", total_volume: "1500"
        }] };
      }
      if (sql.includes("from trades t")) {
        return { rows: ids.map((id, index) => ({
          id, market_id: "market-1", user_id: `user-${index}`, user_label: `user-${index}`,
          user_cash_account_id: `cash-${index}`, outcome_id: "no", requested_outcome_key: "yes",
          contract_side: "no", side: "buy", cash_amount: index === 0 ? "1200.000000" : "10.000000",
          share_amount: index === 0 ? "2424.527652" : "17.993795",
          created_at: new Date(`2026-07-14T21:0${index}:00.000Z`),
          original_ledger_transaction_id: `ledger-${index}`, reversal_ledger_transaction_id: null
        })) };
      }
      if (sql.includes("from trade_execution_legs")) {
        return { rows: ids.map((id, index) => ({ trade_id: id, outcome_id: "no", share_amount: index === 0 ? "2424.527652" : "17.993795", sort_order: 0 })) };
      }
      throw new Error(`unexpected query: ${sql}`);
    })
  } as Queryable;
}

describe("known-result trade plan", () => {
  it("lists all post-cutoff trades in preview mode when no exact IDs are selected yet", async () => {
    const plan = await buildKnownResultTradePlan(dbWithTrades(["trade-1", "trade-2"]), {
      marketId: "market-1", cutoffAt: "2026-07-14T19:00:00.000Z",
      selectedTradeIds: [], execute: false
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.selectedTradeIds).toEqual([]);
    expect(plan.trades.map((trade) => trade.id)).toEqual(["trade-1", "trade-2"]);
    expect(plan.totalCash).toBe("1210.000000");
  });

  it("accepts an exact latest trade suffix and sizes the refund", async () => {
    const plan = await buildKnownResultTradePlan(dbWithTrades(["trade-1", "trade-2"]), {
      marketId: "market-1", cutoffAt: "2026-07-14T19:00:00.000Z",
      selectedTradeIds: ["trade-1", "trade-2"], execute: false
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.totalCash).toBe("1210.000000");
    expect(plan.trades).toHaveLength(2);
  });

  it("blocks a selection that leaves a later market trade intact", async () => {
    const plan = await buildKnownResultTradePlan(dbWithTrades(["trade-1", "trade-2"]), {
      marketId: "market-1", cutoffAt: "2026-07-14T19:00:00.000Z",
      selectedTradeIds: ["trade-1"], execute: false
    });
    expect(plan.blockers).toContain("selected_trades_are_not_exact_market_suffix");
  });

  it("uses public user identity fields that exist in the users schema", async () => {
    const queries: string[] = [];
    await buildKnownResultTradePlan(dbWithTrades(["trade-1"], queries), {
      marketId: "market-1", cutoffAt: "2026-07-14T19:00:00.000Z",
      selectedTradeIds: ["trade-1"], execute: false
    });

    const tradeQuery = queries.find((sql) => sql.includes("from trades t")) ?? "";
    expect(tradeQuery).toContain("u.display_name");
    expect(tradeQuery).toContain("u.handle");
    expect(tradeQuery).not.toContain("u.username");
  });
});
