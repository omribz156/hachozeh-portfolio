import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  claimPortfolioRealization,
  readPortfolioClaims,
  sweepPendingPortfolioClaims
} from "../../../src/engine/portfolio/portfolio-claim-service";

const LEDGER_ADVISORY_LOCK_QUERY = "select pg_advisory_xact_lock(hashtext('navi_ledger_sequence'))";

const BASE_ENV = {
  actorMode: {
    demoEnabled: true,
    demoActorId: "user_demo_1"
  }
} as any;

function createPool() {
  const state = {
    claims: [
      {
      id: "realization_win_1",
      created_at: new Date("2026-05-21T08:00:00.000Z"),
      claimed_at: null as Date | null,
      claim_status: "pending",
      user_id: "user_demo_1",
      market_id: "market_seed_next_prime_minister",
      market_title: "מי יהיה ראש הממשלה הבא?",
      market_treasury_account_id: "account_market_treasury_1",
      outcome_id: "market_seed_next_prime_minister_outcome_option_a",
      outcome_label: "מועמד א'",
      shares_closed: "10.000000",
      proceeds: "10.000000",
      removed_cost_basis: "6.000000",
      realized_pnl: "4.000000",
      resolution_id: "resolution_1",
      user_cash_account_id: "account_user_demo_cash",
      user_cash_balance: "2.000000",
      market_treasury_balance: "10.000000"
      }
    ],
    accounts: {
      account_user_demo_cash: "2.000000",
      account_market_treasury_1: "10.000000"
    },
    ledgerTransactions: [] as string[],
    ledgerEntries: [] as string[],
    claimedNotifications: [] as string[],
    queries: [] as string[]
  };
  const stateWithClaim = state as typeof state & { claim: typeof state.claims[number] };
  stateWithClaim.claim = state.claims[0]!;

  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        state.queries.push(sql);
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [], rowCount: 0 };
        }

        if (sql === LEDGER_ADVISORY_LOCK_QUERY) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from realization_events re") && sql.includes("order by")) {
          const isSweepRead = sql.includes("for update skip locked");
          const rows = isSweepRead
            ? state.claims
                .filter((claim) => {
                  const cutoff = values?.[0] instanceof Date
                    ? values[0]
                    : new Date(String(values?.[0]));
                  return claim.claim_status === "pending" && claim.created_at < cutoff;
                })
                .slice(0, Number(values?.[1] ?? 25))
                .map((claim) => ({ id: claim.id }))
            : state.claims;
          return { rows, rowCount: rows.length };
        }

        if (sql.includes("from realization_events re") && sql.includes("for update")) {
          const claimId = String(values?.[0]);
          const actorId = typeof values?.[1] === "string" ? String(values[1]) : null;
          const claim = state.claims.find((candidate) => {
            if (candidate.id !== claimId) {
              return false;
            }

            return actorId ? candidate.user_id === actorId : true;
          });
          return { rows: claim ? [claim] : [], rowCount: claim ? 1 : 0 };
        }

        if (sql.includes("select sequence_number, transaction_hash")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("insert into ledger_transactions")) {
          state.ledgerTransactions.push(String(values?.[0]));
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into ledger_entries")) {
          state.ledgerEntries.push(String(values?.[0]));
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("update accounts")) {
          const accountId = String(values?.[0]) as keyof typeof state.accounts;
          state.accounts[accountId] = String(values?.[1]);
          for (const claim of state.claims) {
            if (claim.user_cash_account_id === accountId) {
              claim.user_cash_balance = String(values?.[1]);
            }

            if (claim.market_treasury_account_id === accountId) {
              claim.market_treasury_balance = String(values?.[1]);
            }
          }
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("update realization_events")) {
          const claim = state.claims.find((candidate) => candidate.id === String(values?.[0]));
          if (claim) {
            claim.claim_status = "claimed";
            claim.claimed_at = new Date("2026-05-21T08:05:00.000Z");
          }
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("update user_notifications")) {
          state.claimedNotifications.push(String(values?.[1]));
          return { rows: [], rowCount: 1 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: vi.fn()
    }))
  } as unknown as Pool;

  return { pool, state: stateWithClaim };
}

describe("portfolio claim service", () => {
  it("reads pending claimable winnings", async () => {
    const { pool, state } = createPool();

    const response = await readPortfolioClaims(pool, BASE_ENV);

    expect(response.summary).toEqual({
      pendingClaimCount: 1,
      totalClaimable: "10.000000"
    });
    expect(response.claims[0]).toMatchObject({
      claimId: "realization_win_1",
      status: "pending",
      proceeds: "10.000000"
    });
    expect(state.queries.some((sql) => sql.includes("market_resolutions"))).toBe(true);
    expect(state.queries.some((sql) => sql.includes("mr.winning_outcome_id = re.outcome_id"))).toBe(true);
  });

  it("claims a pending winner payout into user cash", async () => {
    const { pool, state } = createPool();

    const response = await claimPortfolioRealization(pool, BASE_ENV, "realization_win_1");

    expect(response.summary.creditedAmount).toBe("10.000000");
    expect(response.claim.status).toBe("claimed");
    expect(state.accounts.account_user_demo_cash).toBe("12.000000");
    expect(state.accounts.account_market_treasury_1).toBe("0.000000");
    expect(state.claim.claim_status).toBe("claimed");
    expect(state.claimedNotifications).toEqual(["realization_win_1"]);
    expect(state.ledgerTransactions).toHaveLength(1);
    expect(state.ledgerEntries).toHaveLength(2);

    const lockQueries = state.queries.filter((sql) => sql === LEDGER_ADVISORY_LOCK_QUERY);
    expect(lockQueries).toHaveLength(1);

    const advisoryLockIndex = state.queries.indexOf(LEDGER_ADVISORY_LOCK_QUERY);
    const ledgerHeadIndex = state.queries.findIndex((sql) =>
      sql.includes("select sequence_number, transaction_hash")
    );
    const ledgerInsertIndex = state.queries.findIndex((sql) =>
      sql.includes("insert into ledger_transactions")
    );

    expect(ledgerHeadIndex).toBeGreaterThan(advisoryLockIndex);
    expect(ledgerInsertIndex).toBeGreaterThan(ledgerHeadIndex);
  });

  it("sweeps old pending claims and leaves newer claims available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T08:00:00.000Z"));
    const { pool, state } = createPool();
    state.claims.push({
      ...state.claim,
      id: "realization_win_new",
      created_at: new Date("2026-06-01T08:00:00.000Z"),
      proceeds: "5.000000",
      shares_closed: "5.000000",
      removed_cost_basis: "2.000000",
      realized_pnl: "3.000000"
    });

    try {
      const response = await sweepPendingPortfolioClaims(pool, {
        actorId: "claim_sweep_worker",
        olderThanDays: 30,
        limit: 100
      });

      expect(response).toEqual({
        sweptCount: 1,
        sweptAmount: "10.000000",
        claimIds: ["realization_win_1"]
      });
      expect(state.claim.claim_status).toBe("claimed");
      expect(state.claims[1]!.claim_status).toBe("pending");
      expect(state.accounts.account_user_demo_cash).toBe("12.000000");
      expect(state.accounts.account_market_treasury_1).toBe("0.000000");
      expect(state.ledgerTransactions).toHaveLength(1);
      expect(state.ledgerEntries).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweep is idempotent after old claims were collected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T08:00:00.000Z"));
    const { pool } = createPool();

    try {
      await sweepPendingPortfolioClaims(pool, {
        actorId: "claim_sweep_worker",
        olderThanDays: 30,
        limit: 100
      });
      const second = await sweepPendingPortfolioClaims(pool, {
        actorId: "claim_sweep_worker",
        olderThanDays: 30,
        limit: 100
      });

      expect(second).toEqual({
        sweptCount: 0,
        sweptAmount: "0.000000",
        claimIds: []
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
