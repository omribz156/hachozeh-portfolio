import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  createPortfolioQueryImpl,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

describe("portfolio routes", () => {
  it("returns portfolio orders as an immediate execution model", async () => {
    const { baseUrl } = await startServer({
      queryImpl: createPortfolioQueryImpl(25)
    });

    const response = await fetch(`${baseUrl}/api/portfolio/orders`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      actorMode: "demo",
      orderModel: "immediate_execution",
      openOrders: [],
      summary: {
        openOrderCount: 0
      }
    });
    expect(payload.asOf).toEqual(expect.any(String));
  });

  it("returns portfolio history as merged trades and realizations", async () => {
    const { baseUrl } = await startServer({
      queryImpl: createPortfolioQueryImpl(25)
    });

    const response = await fetch(`${baseUrl}/api/portfolio/history`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      totalEvents: 3,
      tradeCount: 2,
      buyTradeCount: 1,
      sellTradeCount: 1,
      realizationCount: 1
    });
    expect(payload.items).toHaveLength(3);
    expect(payload.items[0]).toMatchObject({
      kind: "realization",
      id: "realization_1",
      marketKey: "next-prime-minister",
      outcomeKey: "option-a",
      realizedPnl: "1.200000"
    });
    expect(payload.items[1]).toMatchObject({
      kind: "trade",
      id: "trade_2",
      side: "sell",
      contractSide: "yes"
    });
  });

  it("returns portfolio performance with snapshot summary and activity counts", async () => {
    const { baseUrl } = await startServer({
      queryImpl: createPortfolioQueryImpl(5)
    });

    const response = await fetch(`${baseUrl}/api/portfolio/performance`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toMatchObject({
      availableCash: "9900.000000",
      portfolioValue: "108.889585",
      totalAccountValue: "10008.889585",
      realizedPnl: "0.354946",
      unrealizedPnl: "11.737466",
      openPositionsCount: 1,
      tradeCount: 2,
      buyTradeCount: 1,
      sellTradeCount: 1,
      realizationCount: 1
    });
    expect(payload.activeTimeframe).toBe("all");
    expect(payload.dayMovement).toMatchObject({
      basis: "portfolio_mark",
      totalNow: "10008.889585",
      dayChangeAbs: "0.000000",
      dayChangeSign: "flat"
    });
    expect(payload.timeframes).toEqual([
      { id: "day", label: "יום", active: false },
      { id: "week", label: "שבוע", active: false },
      { id: "month", label: "חודש", active: false },
      { id: "year", label: "שנה", active: false },
      { id: "ytd", label: "YTD", active: false },
      { id: "all", label: "הכל", active: true }
    ]);
    expect(payload.views.all.value).toBe("1.200000");
  });

  it("returns a lean portfolio performance view for a requested timeframe", async () => {
    const { baseUrl } = await startServer({
      queryImpl: createPortfolioQueryImpl(5)
    });

    const response = await fetch(`${baseUrl}/api/portfolio/performance?timeframe=day`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.activeTimeframe).toBe("day");
    expect(payload.timeframes).toContainEqual({ id: "day", label: "יום", active: true });
    expect(Object.keys(payload.views)).toEqual(["day"]);
    expect(payload.views.day).toBeDefined();
    expect(payload.views.week).toBeUndefined();
    expect(payload.dayMovement).toBeDefined();
  });

  it("rejects no-cookie portfolio reads when beta session-only is enabled", async () => {
    const { baseUrl } = await startServer({
      env: {
        trading: {
          requireSession: true
        }
      },
      queryImpl: createPortfolioQueryImpl(25)
    });

    const response = await fetch(`${baseUrl}/api/portfolio/snapshot`);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthorized");
  });

  it("returns portfolio claims for the current actor", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from realization_events re")) {
          expect(values).toEqual(["seed_user_1", 25]);
          return {
            rows: [
              {
                id: "realization_win_1",
                created_at: new Date("2026-04-07T10:01:00.000Z"),
                claimed_at: null,
                claim_status: "pending",
                user_id: "seed_user_1",
                market_id: "market_seed_next_prime_minister",
                market_title: "מי יהיה ראש הממשלה הבא?",
                market_treasury_account_id: "account_market_treasury",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                shares_closed: "20.000000",
                proceeds: "20.000000",
                removed_cost_basis: "16.800000",
                realized_pnl: "3.200000",
                resolution_id: "resolution_1"
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query in claims test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/portfolio/claims`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      actorMode: "demo",
      summary: {
        pendingClaimCount: 1,
        totalClaimable: "20.000000"
      },
      claims: [
        {
          claimId: "realization_win_1",
          status: "pending",
          marketKey: "next-prime-minister",
          outcomeKey: "option-a",
          proceeds: "20.000000"
        }
      ]
    });
  });

  it("returns claim_not_found for missing claim actions", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from realization_events re") && sql.includes("for update")) {
          expect(values).toEqual(["missing_claim", "seed_user_1"]);
          return { rows: [] };
        }

        throw new Error(`Unexpected db query in claim action test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/portfolio/claims/missing_claim/claim`, {
      method: "POST"
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: {
        code: "claim_not_found",
        message: "Claim was not found."
      }
    });
  });
});
