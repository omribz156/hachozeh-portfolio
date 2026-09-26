import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../../src/config/env";
import type { Queryable } from "../../../src/db/client/pool";
import { PortfolioSnapshotServiceError } from "../../../src/engine/portfolio/portfolio-snapshot-service";
import {
  buildMarkPnlSeries,
  readPortfolioHistory,
  readPortfolioOrders,
  readPortfolioPerformance
} from "../../../src/engine/portfolio/portfolio-read-service";

const BASE_ENV: AppEnv = {
  serviceName: "navi-backend",
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "info",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 24 * 7,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 5,
    devOtpCode: "111111"
  },
  actorMode: {
    demoEnabled: true,
    demoActorId: "seed_user_1"
  },
  db: {
    host: "127.0.0.1",
    port: 5432,
    name: "navi",
    user: "navi",
    password: "navi",
    connectTimeoutMs: 1500
  }
};

function createQueryable(options?: {
  includeCashAccount?: boolean;
  realizedPnlTotal?: string;
  positions?: Array<{
    market_id: string;
    market_title: string;
    market_status: string;
    persisted_status?: string | null;
    outcome_id: string;
    outcome_label: string;
    outcome_count?: number;
    complement_outcome_id?: string | null;
    complement_outcome_label?: string | null;
    shares: string;
    cost_basis: string;
    realized_pnl: string;
    current_price: string;
  }>;
  marketRows?: Array<Record<string, unknown>>;
  accountCreatedAt?: Date | null;
  realizedPnlBeforeWindow?: string;
  tradeCount?: number;
  buyTradeCount?: number;
  sellTradeCount?: number;
  realizationCount?: number;
  trades?: Array<{
    trade_id: string;
    created_at: Date;
    side: "buy" | "sell";
    contract_side?: "yes" | "no";
    requested_outcome_key?: string;
    requested_outcome_label?: string | null;
    cash_amount: string;
    share_amount: string;
    avg_price: string;
    price_before: string;
    price_after: string;
    market_id: string;
    market_title: string;
    market_status: string;
    persisted_status?: string | null;
    outcome_id: string;
    outcome_label: string;
    execution_legs?: Array<{
      outcome_id: string;
      outcome_label: string;
      share_amount: string;
    }>;
  }>;
  realizations?: Array<{
    realization_id: string;
    created_at: Date;
    type: "sell" | "resolution_win" | "resolution_loss";
    shares_closed: string;
    proceeds: string;
    removed_cost_basis: string;
    realized_pnl: string;
    trade_id: string | null;
    resolution_id: string | null;
    market_id: string;
    market_title: string;
    market_status: string;
    outcome_id: string;
    outcome_label: string;
  }>;
}): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("select balance_cached")) {
        return {
          rows: options?.includeCashAccount === false ? [] : [{ balance_cached: "9900.000000" }]
        };
      }

      if (sql.includes("realized_pnl_total")) {
        return {
          rows: [{ realized_pnl_total: options?.realizedPnlTotal ?? "0.354946" }]
        };
      }

      if (sql.includes("realized_pnl_before")) {
        return {
          rows: [{ realized_pnl_before: options?.realizedPnlBeforeWindow ?? "0.000000" }]
        };
      }

      if (sql.includes("select created_at") && sql.includes("from accounts")) {
        return {
          rows: [{ created_at: options?.accountCreatedAt ?? new Date("2026-04-01T00:00:00.000Z") }]
        };
      }

      if (sql.includes("from markets m")) {
        return {
          rows: options?.marketRows ?? []
        };
      }

      if (sql.includes("shares::text as shares") && sql.includes("from positions")) {
        return {
          rows: (options?.positions ?? [
            {
              market_id: "market_seed_next_prime_minister",
              outcome_id: "market_seed_next_prime_minister_outcome_option_a",
              shares: "341.138215",
              cost_basis: "97.152119",
              current_price: "0.31919492"
            }
          ]).map((position) => ({
            market_id: position.market_id,
            outcome_id: position.outcome_id,
            shares: position.shares,
            cost_basis: position.cost_basis,
            current_price: position.current_price
          }))
        };
      }

      if (sql.includes("share_delta")) {
        return {
          rows: []
        };
      }

      if (sql.includes("from positions p")) {
        return {
          rows:
            options?.positions ??
            [
              {
                market_id: "market_seed_next_prime_minister",
                market_title: "מי יהיה ראש הממשלה הבא?",
                market_status: "open",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                outcome_count: 4,
                complement_outcome_id: null,
                complement_outcome_label: null,
                shares: "341.138215",
                cost_basis: "97.152119",
                realized_pnl: "0.354946",
                current_price: "0.31919492"
              }
            ]
        };
      }

      if (sql.includes("from contract_positions cp")) {
        return {
          rows: []
        };
      }

      if (sql.includes("count(*)::int as trade_count")) {
        return {
          rows: [
            {
              trade_count: options?.tradeCount ?? 2,
              buy_trade_count: options?.buyTradeCount ?? 1,
              sell_trade_count: options?.sellTradeCount ?? 1
            }
          ]
        };
      }

      if (sql.includes("count(*)::int as realization_count")) {
        return {
          rows: [{ realization_count: options?.realizationCount ?? 1 }]
        };
      }

      if (sql.includes("from trades t")) {
        return {
          rows:
            options?.trades ??
            [
              {
                trade_id: "trade_2",
                created_at: new Date("2026-04-07T10:00:00.000Z"),
                side: "sell",
                contract_side: "yes",
                requested_outcome_key: "market_seed_next_prime_minister_outcome_option_a",
                requested_outcome_label: "מועמד א'",
                cash_amount: "18.000000",
                share_amount: "20.000000",
                avg_price: "0.90000000",
                price_before: "0.88000000",
                price_after: "0.87000000",
                market_id: "market_seed_next_prime_minister",
                market_title: "מי יהיה ראש הממשלה הבא?",
                market_status: "open",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                execution_legs: [
                  {
                    outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                    outcome_label: "מועמד א'",
                    share_amount: "20.000000"
                  }
                ]
              },
              {
                trade_id: "trade_1",
                created_at: new Date("2026-04-07T09:59:00.000Z"),
                side: "buy",
                contract_side: "yes",
                requested_outcome_key: "market_seed_next_prime_minister_outcome_option_a",
                requested_outcome_label: "מועמד א'",
                cash_amount: "20.000000",
                share_amount: "23.809524",
                avg_price: "0.84000000",
                price_before: "0.82000000",
                price_after: "0.88000000",
                market_id: "market_seed_next_prime_minister",
                market_title: "מי יהיה ראש הממשלה הבא?",
                market_status: "open",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                execution_legs: [
                  {
                    outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                    outcome_label: "מועמד א'",
                    share_amount: "23.809524"
                  }
                ]
              }
            ]
        };
      }

      if (sql.includes("from realization_events re")) {
        return {
          rows:
            options?.realizations ??
            [
              {
                realization_id: "realization_1",
                created_at: new Date("2026-04-07T10:01:00.000Z"),
                type: "sell",
                shares_closed: "20.000000",
                proceeds: "18.000000",
                removed_cost_basis: "16.800000",
                realized_pnl: "1.200000",
                trade_id: "trade_2",
                resolution_id: null,
                market_id: "market_seed_next_prime_minister",
                market_title: "מי יהיה ראש הממשלה הבא?",
                market_status: "open",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'"
              }
            ]
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }) as Queryable["query"]
  };
}

describe("portfolio read service", () => {
  it("returns an immediate execution order model with no open orders", async () => {
    const response = await readPortfolioOrders(createQueryable(), BASE_ENV, {
      actorId: "user_live_1",
      mode: "session",
      sessionId: "session_live_1",
      role: "user"
    });

    expect(response).toMatchObject({
      actorMode: "session",
      orderModel: "immediate_execution",
      summary: {
        openOrderCount: 0
      }
    });
    expect(response.openOrders).toEqual([]);
  });

  it("merges trades and realizations into a recent activity history", async () => {
    const response = await readPortfolioHistory(createQueryable(), BASE_ENV, {
      actorId: "user_live_1",
      mode: "session",
      sessionId: "session_live_1",
      role: "user"
    });

    expect(response.actorMode).toBe("session");
    expect(response.summary).toEqual({
      totalEvents: 3,
      tradeCount: 2,
      buyTradeCount: 1,
      sellTradeCount: 1,
      realizationCount: 1
    });
    expect(response.items).toHaveLength(3);
    expect(response.items[0]).toMatchObject({
      kind: "realization",
      id: "realization_1",
      marketKey: "next-prime-minister",
      outcomeKey: "option-a",
      realizedPnl: "1.200000"
    });
    expect(response.items[1]).toMatchObject({
      kind: "trade",
      id: "trade_2",
      side: "sell",
      contractSide: "yes",
      cashAmount: "18.000000"
    });
  });

  it("surfaces snapshot summary in performance payload", async () => {
    const response = await readPortfolioPerformance(createQueryable(), BASE_ENV, {
      actorId: "user_live_1",
      mode: "session",
      sessionId: "session_live_1",
      role: "user"
    });

    expect(response.actorMode).toBe("session");
    expect(response.summary).toMatchObject({
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
    expect(response.activeTimeframe).toBe("all");
    expect(response.dayMovement).toMatchObject({
      basis: "portfolio_mark",
      totalNow: "10008.889585",
      dayChangeAbs: "0.000000",
      dayChangeSign: "flat"
    });
    expect(response.dayMovement.series.at(-1)).toMatchObject({ v: "0.000000" });
    expect(response.timeframes).toEqual([
      { id: "day", label: "יום", active: false },
      { id: "week", label: "שבוע", active: false },
      { id: "month", label: "חודש", active: false },
      { id: "year", label: "שנה", active: false },
      { id: "ytd", label: "YTD", active: false },
      { id: "all", label: "הכל", active: true }
    ]);
    expect(response.views.year).toMatchObject({
      kind: "snapshot",
      timeframeLabel: "שנה"
    });
    expect(response.views.ytd).toMatchObject({
      kind: "snapshot",
      timeframeLabel: "YTD"
    });
    expect(response.views.all).toMatchObject({
      kind: "snapshot",
      timeframeLabel: "כל הזמן",
      value: "1.200000"
    });
  });

  it("keeps realized PnL in the lifetime series when recent buys crowd it out of the activity feed", async () => {
    // An older realized loss, plus 5 NEWER buys that fill the capped recent-activity
    // feed. The series math must still see the realization — otherwise the lifetime
    // views (all/year/ytd, where realizedPnlBeforeWindow=0) silently drop it.
    const oldRealization = {
      realization_id: "realization_old",
      created_at: new Date("2026-04-02T00:00:00.000Z"),
      type: "resolution_loss" as const,
      shares_closed: "100.000000",
      proceeds: "0.000000",
      removed_cost_basis: "3.000000",
      realized_pnl: "-3.000000",
      trade_id: null,
      resolution_id: "resolution_old",
      market_id: "market_closed",
      market_title: "Closed market",
      market_status: "resolved",
      outcome_id: "market_closed_outcome_no",
      outcome_label: "No"
    };
    const recentBuys = Array.from({ length: 5 }, (_, i) => ({
      trade_id: `trade_recent_${i}`,
      created_at: new Date(`2026-04-1${i}T00:00:00.000Z`), // 2026-04-10 .. 2026-04-14, all newer
      side: "buy" as const,
      contract_side: "yes" as const,
      requested_outcome_key: "market_open_outcome_yes",
      requested_outcome_label: "Yes",
      cash_amount: "10.000000",
      share_amount: "20.000000",
      avg_price: "0.50000000",
      price_before: "0.49000000",
      price_after: "0.51000000",
      market_id: "market_open",
      market_title: "Open market",
      market_status: "open",
      outcome_id: "market_open_outcome_yes",
      outcome_label: "Yes"
    }));
    const db = createQueryable({
      positions: [], // no open positions → realized-only (fallback) lifetime series
      realizedPnlBeforeWindow: "0.000000",
      realizationCount: 1,
      tradeCount: 5,
      buyTradeCount: 5,
      sellTradeCount: 0,
      realizations: [oldRealization],
      trades: recentBuys
    });

    const response = await readPortfolioPerformance(db, BASE_ENV, {
      actorId: "user_x",
      mode: "session",
      sessionId: "session_x",
      role: "user"
    });

    // Lifetime PnL must reflect the -3.00 realized loss, not 0.
    expect(response.views.all.value).toBe("-3.000000");
  });

  it("can return a single requested performance timeframe for lean reads", async () => {
    const db = createQueryable();
    const response = await readPortfolioPerformance(
      db,
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      },
      {
        timeframe: "day"
      }
    );
    const queryCalls = vi.mocked(db.query).mock.calls.map(([sql]) => String(sql));

    expect(response.activeTimeframe).toBe("day");
    expect(response.timeframes).toContainEqual({ id: "day", label: "יום", active: true });
    expect(Object.keys(response.views)).toEqual(["day"]);
    expect(response.views.day).toBeDefined();
    expect(response.views.week).toBeUndefined();
    expect(response.dayMovement).toBeDefined();
    expect(queryCalls.filter((sql) => sql.includes("as start_price"))).toHaveLength(0);
  });

  it("omits legacy dayMovement when a non-day lean performance timeframe is requested", async () => {
    const response = await readPortfolioPerformance(
      createQueryable(),
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      },
      {
        timeframe: "week"
      }
    );

    expect(response.activeTimeframe).toBe("week");
    expect(Object.keys(response.views)).toEqual(["week"]);
    expect(response.views.week).toBeDefined();
    expect(response.dayMovement).toBeUndefined();
  });

  it("starts fallback performance windows at account creation", async () => {
    const accountCreatedAt = new Date("2026-04-08T09:30:00.000Z");
    const response = await readPortfolioPerformance(
      createQueryable({
        accountCreatedAt,
        tradeCount: 0,
        buyTradeCount: 0,
        sellTradeCount: 0,
        realizationCount: 0,
        trades: [],
        realizations: [],
        positions: [],
        marketRows: []
      }),
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      },
      {
        timeframe: "year"
      }
    );

    expect(response.views.year?.series.points[0]?.at).toBe(accountCreatedAt.toISOString());
  });

  it("exposes typed day movement when realized PnL happens inside the day window", async () => {
    const response = await readPortfolioPerformance(
      createQueryable({
        realizations: [
          {
            realization_id: "realization_today_1",
            created_at: new Date(Date.now() - 60 * 1000),
            type: "sell",
            shares_closed: "20.000000",
            proceeds: "18.000000",
            removed_cost_basis: "16.800000",
            realized_pnl: "1.200000",
            trade_id: "trade_2",
            resolution_id: null,
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'"
          }
        ]
      }),
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      }
    );

    expect(response.dayMovement).toMatchObject({
      basis: "portfolio_mark",
      dayChangeAbs: "1.200000",
      dayChangeSign: "up"
    });
    expect(response.dayMovement.series.at(-1)).toMatchObject({ v: "1.200000" });
  });

  it("does not invent open-position movement when no market mark history is available", async () => {
    const marketId = "market_seed_next_prime_minister";
    const outcomeA = "market_seed_next_prime_minister_outcome_option_a";
    const outcomeB = "market_seed_next_prime_minister_outcome_option_b";
    const response = await readPortfolioPerformance(
      createQueryable({
        positions: [
          {
            market_id: marketId,
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: outcomeA,
            outcome_label: "מועמד א'",
            outcome_count: 2,
            complement_outcome_id: outcomeB,
            complement_outcome_label: "מועמד ב'",
            shares: "10.000000",
            cost_basis: "5.000000",
            realized_pnl: "0.000000",
            current_price: "0.62245933"
          }
        ],
        realizations: []
      }),
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      }
    );

    expect(response.dayMovement).toMatchObject({
      basis: "portfolio_mark",
      dayChangeAbs: "0.000000",
      dayChangeSign: "flat"
    });
    expect(response.views.day.value).toBe("0.000000");
  });

  it("exposes typed movement block on every timeframe view with uniform shape", async () => {
    const response = await readPortfolioPerformance(
      createQueryable({
        realizations: [
          {
            realization_id: "realization_today",
            created_at: new Date(Date.now() - 60 * 1000),
            type: "sell",
            shares_closed: "20.000000",
            proceeds: "18.000000",
            removed_cost_basis: "16.800000",
            realized_pnl: "1.200000",
            trade_id: "trade_x",
            resolution_id: null,
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'"
          }
        ]
      }),
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      }
    );

    for (const tf of ["day", "week", "month", "year", "ytd", "all"] as const) {
      const view = response.views[tf];
      expect(view.movement).toMatchObject({
        basis: "portfolio_mark"
      });
      expect(typeof view.movement.totalNow).toBe("string");
      expect(typeof view.movement.changeAbs).toBe("string");
      expect(typeof view.movement.changePct).toBe("string");
      expect(["up", "down", "flat"]).toContain(view.movement.changeSign);
      // changeAbs and the legacy `value` field describe the same number;
      // keep both in sync so front consumers can migrate at their own pace.
      expect(view.movement.changeAbs).toBe(view.value);
    }
  });

  it("emits multi-point series instead of a 2-point flattened wedge", async () => {
    const now = Date.now();
    const response = await readPortfolioPerformance(
      createQueryable({
        realizations: [
          {
            realization_id: "r_a",
            created_at: new Date(now - 5 * 60 * 60 * 1000),
            type: "sell",
            shares_closed: "10.000000",
            proceeds: "12.000000",
            removed_cost_basis: "10.000000",
            realized_pnl: "2.000000",
            trade_id: "t1",
            resolution_id: null,
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "א"
          },
          {
            realization_id: "r_b",
            created_at: new Date(now - 2 * 60 * 60 * 1000),
            type: "sell",
            shares_closed: "5.000000",
            proceeds: "6.000000",
            removed_cost_basis: "4.500000",
            realized_pnl: "1.500000",
            trade_id: "t2",
            resolution_id: null,
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "א"
          }
        ]
      }),
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      }
    );

    // Two realization events inside the day window → starter point
    // at "0", one point per realization, plus a closing point at asOf.
    // Multi-point, not flattened to 2.
    const dayPoints = response.views.day.series.points;
    expect(dayPoints.length).toBeGreaterThanOrEqual(3);
    expect(dayPoints[0].value).toBe("0.000000");
    expect(dayPoints.at(-1)?.value).toBe(response.views.day.value);

    // Top-level dayMovement.series naturally inherits the same multi
    // point shape (it maps view.day.series.points → {t, v}). Existing
    // consumers that check the LAST point keep working; consumers that
    // want intermediate marks now have them.
    expect(response.dayMovement.series.length).toBe(dayPoints.length);
  });

  it("composes mark-PnL series from a mark-to-market series + realized events in window", () => {
    // Mark series: open PnL moves 60 → 62 → 65 → 63 → 68.
    const markSeries = [
      { at: "2026-05-30T00:00:00.000Z", markValue: "100.000000", costBasisValue: "40.000000" },
      { at: "2026-05-30T03:00:00.000Z", markValue: "102.000000", costBasisValue: "40.000000" },
      { at: "2026-05-30T06:00:00.000Z", markValue: "105.000000", costBasisValue: "40.000000" },
      { at: "2026-05-30T09:00:00.000Z", markValue: "103.000000", costBasisValue: "40.000000" },
      { at: "2026-05-30T12:00:00.000Z", markValue: "108.000000", costBasisValue: "40.000000" }
    ];
    // One realization (+1.5) at 04:00, before the 06:00 bucket — so
    // realized_through(04:00) = 0, realized_through(06:00) = 1.5, etc.
    const filteredItems = [
      {
        kind: "realization" as const,
        id: "r1",
        happenedAt: "2026-05-30T04:30:00.000Z",
        marketKey: "m",
        marketTitle: "t",
        marketStatus: "open",
        persistedMarketStatus: "open",
        effectiveMarketStatus: "open",
        outcomeKey: "yes",
        outcomeId: "o",
        outcomeLabel: "כן",
        realizationType: "sell" as const,
        sharesClosed: "1.000000",
        proceeds: "5.000000",
        removedCostBasis: "3.500000",
        realizedPnl: "1.500000",
        tradeId: null,
        resolutionId: null
      }
    ];

    const points = buildMarkPnlSeries(
      markSeries,
      filteredItems
    );

    // Per-bucket PnL = (mark_value - cost_basis) + realized_through(bucket).
    expect(points[0]).toMatchObject({ value: "60.000000" });           // 60 + 0
    expect(points[1]).toMatchObject({ value: "62.000000" });           // 62 + 0 (before realization)
    expect(points[2]).toMatchObject({ value: "66.500000" });           // 65 + 1.5
    expect(points[3]).toMatchObject({ value: "64.500000" });           // 63 + 1.5
    // The view movement is derived later as last - first.
    expect(points[4]).toMatchObject({
      at: "2026-05-30T12:00:00.000Z",
      value: "69.500000"
    });
  });

  it("carries numeric PnL through pre-exposure buckets", () => {
    const points = buildMarkPnlSeries(
      [
        { at: "2026-05-29T12:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
        { at: "2026-05-30T00:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
        { at: "2026-05-30T06:00:00.000Z", markValue: "7.000000", costBasisValue: "5.000000" },
        { at: "2026-05-30T12:00:00.000Z", markValue: "8.500000", costBasisValue: "5.000000" }
      ],
      []
    );

    expect(points).toEqual([
      { at: "2026-05-29T12:00:00.000Z", value: "0.000000" },
      { at: "2026-05-30T00:00:00.000Z", value: "0.000000" },
      { at: "2026-05-30T06:00:00.000Z", value: "2.000000" },
      { at: "2026-05-30T12:00:00.000Z", value: "3.500000" }
    ]);
  });

  it("carries realized PnL from before the selected window", () => {
    const points = buildMarkPnlSeries(
      [
        { at: "2026-05-29T12:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
        { at: "2026-05-30T00:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
        { at: "2026-05-30T12:00:00.000Z", markValue: "8.500000", costBasisValue: "5.000000" }
      ],
      [],
      "-127.710000"
    );

    expect(points).toEqual([
      { at: "2026-05-29T12:00:00.000Z", value: "-127.710000" },
      { at: "2026-05-30T00:00:00.000Z", value: "-127.710000" },
      { at: "2026-05-30T12:00:00.000Z", value: "-124.210000" }
    ]);
  });

  it("keeps multi-outcome no trades anchored to requested truth while exposing execution legs", async () => {
    const response = await readPortfolioHistory(
      createQueryable({
        tradeCount: 1,
        buyTradeCount: 1,
        sellTradeCount: 0,
        realizationCount: 0,
        trades: [
          {
            trade_id: "trade_bundle_1",
            created_at: new Date("2026-04-17T09:30:00.000Z"),
            side: "buy",
            contract_side: "no",
            requested_outcome_key: "disc-cm-boi-rate-decision-july-6-2026-hold",
            requested_outcome_label: "ללא שינוי",
            cash_amount: "40.000000",
            share_amount: "68.443210",
            avg_price: "0.58442612",
            price_before: "0.21000000",
            price_after: "0.24500000",
            market_id: "disc-cm-boi-rate-decision-july-6-2026-v2",
            market_title: "החלטת בנק ישראל ביולי",
            market_status: "open",
            outcome_id: "disc-cm-boi-rate-decision-july-6-2026-hold",
            outcome_label: "ללא שינוי",
            execution_legs: [
              {
                outcome_id: "disc-cm-boi-rate-decision-july-6-2026-cut-025",
                outcome_label: "ירידה של 0.25%",
                share_amount: "68.443210"
              },
              {
                outcome_id: "disc-cm-boi-rate-decision-july-6-2026-cut-050",
                outcome_label: "ירידה של 0.50%+",
                share_amount: "68.443210"
              },
              {
                outcome_id: "disc-cm-boi-rate-decision-july-6-2026-hike-025",
                outcome_label: "עלייה של 0.25%",
                share_amount: "68.443210"
              },
              {
                outcome_id: "disc-cm-boi-rate-decision-july-6-2026-hike-050",
                outcome_label: "עלייה של 0.50%+",
                share_amount: "68.443210"
              }
            ]
          }
        ],
        realizations: []
      }),
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      }
    );

    expect(response.summary).toEqual({
      totalEvents: 1,
      tradeCount: 1,
      buyTradeCount: 1,
      sellTradeCount: 0,
      realizationCount: 0
    });
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      kind: "trade",
      id: "trade_bundle_1",
      contractSide: "no",
      requestedOutcomeKey: "disc-cm-boi-rate-decision-july-6-2026-hold",
      requestedOutcomeLabel: "ללא שינוי",
      executionOutcomeKey: null,
      executionOutcomeId: null,
      executionOutcomeLabel: null
    });
    expect(response.items[0]).toMatchObject({
      executionLegs: [
        {
          outcomeKey: "disc-cm-boi-rate-decision-july-6-2026-cut-025",
          outcomeLabel: "ירידה של 0.25%",
          shareAmount: "68.443210"
        },
        {
          outcomeKey: "disc-cm-boi-rate-decision-july-6-2026-cut-050",
          outcomeLabel: "ירידה של 0.50%+",
          shareAmount: "68.443210"
        },
        {
          outcomeKey: "disc-cm-boi-rate-decision-july-6-2026-hike-025",
          outcomeLabel: "עלייה של 0.25%",
          shareAmount: "68.443210"
        },
        {
          outcomeKey: "disc-cm-boi-rate-decision-july-6-2026-hike-050",
          outcomeLabel: "עלייה של 0.50%+",
          shareAmount: "68.443210"
        }
      ]
    });
  });

  it("exposes persisted and effective market status in history items", async () => {
    const response = await readPortfolioHistory(
      createQueryable({
        tradeCount: 1,
        buyTradeCount: 1,
        sellTradeCount: 0,
        realizationCount: 0,
        trades: [
          {
            trade_id: "trade_closed_by_time",
            created_at: new Date("2026-04-07T11:00:00.000Z"),
            side: "buy",
            contract_side: "yes",
            requested_outcome_key: "market_seed_next_prime_minister_outcome_option_a",
            requested_outcome_label: "מועמד א'",
            cash_amount: "10.000000",
            share_amount: "20.000000",
            avg_price: "0.50000000",
            price_before: "0.48000000",
            price_after: "0.50000000",
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "closed",
            persisted_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'",
            execution_legs: []
          }
        ],
        realizations: []
      }),
      BASE_ENV,
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      }
    );

    expect(response.items[0]).toMatchObject({
      marketStatus: "closed",
      persistedMarketStatus: "open",
      effectiveMarketStatus: "closed"
    });
  });

  it("rejects when no actor is available and demo mode is disabled", async () => {
    await expect(
      readPortfolioOrders(
        createQueryable(),
        {
          ...BASE_ENV,
          actorMode: {
            demoEnabled: false,
            demoActorId: "seed_user_1"
          }
        }
      )
    ).rejects.toMatchObject<Partial<PortfolioSnapshotServiceError>>({
      code: "unauthorized",
      statusCode: 401
    });
  });
});
