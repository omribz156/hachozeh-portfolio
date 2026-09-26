/**
 * Integration spec B: resolve-market
 *
 * Seeds a closed binary market with two opposing position holders,
 * runs resolveMarket, then asserts:
 *   - market.status = 'resolved'
 *   - realization_events created (winner = pending, loser = not_applicable)
 *   - winner position deleted, loser position deleted
 *   - contract_positions settled (settled_at set)
 *   - market treasury swept down to winner-reserve amount
 *   - platform treasury credited with sweep amount
 *
 * The oracle resolve service lives in systems/oracle/src/ and imports
 * back internals via relative paths — this mirrors the test/lifecycle/oracle
 * pattern already in the unit suite.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../src/auth/actor-resolver";
import { resolveMarket } from "../../oracle/src/resolve-market-service";
import { executeTrade } from "../src/engine/trading/trade-service";
import type { AppEnv } from "../src/config/env";
import {
  closeMarket,
  createTestPool,
  readBalance,
  readPosition,
  readRealizationEvents,
  readTotalEconomyBalance,
  seedMinimalBinaryMarket,
  seedMinimalMultiOutcomeMarket,
  truncateAllTables,
  type SeedIds
} from "./helpers";

// ── Shared env ────────────────────────────────────────────────────────────────
const TEST_ENV: AppEnv = {
  serviceName: "navi-backend-inttest",
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "error",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 168,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 5,
    devOtpCode: "111111",
    devOtpExposed: false
  },
  mail: { resendApiKey: "", from: "test@test.test" },
  actorMode: { demoEnabled: false, demoActorId: "" },
  trading: { requireSession: false },
  publicBaseUrl: "http://127.0.0.1",
  db: {
    host: process.env["DB_HOST"] ?? "127.0.0.1",
    port: parseInt(process.env["DB_PORT"] ?? "55432", 10),
    name: process.env["DB_NAME"] ?? "navi_test",
    user: process.env["DB_USER"] ?? "navi",
    password: process.env["DB_PASSWORD"] ?? "navi",
    connectTimeoutMs: 10_000
  }
};

const ADMIN_ACTOR: RequestActor = {
  actorId: "inttest_admin_1",
  mode: "session",
  sessionId: "inttest_session_admin_1",
  role: "admin"
};

// ── Suite ─────────────────────────────────────────────────────────────────────

let pool: Pool;
let ids: SeedIds;

// Seed two traders on the same market with opposing YES/NO positions.
const TRADER_YES = "inttest_resolver_winner";
const TRADER_NO = "inttest_resolver_loser";

async function insertTrader(pool: Pool, userId: string, cash = "500.000000"): Promise<void> {
  await pool.query(
    `insert into users (id, handle, status, role, trade_access_status, last_login_at)
     values ($1, $2, 'active', 'user', 'enabled', now()) on conflict (id) do nothing`,
    [userId, userId]
  );
  await pool.query(
    `insert into accounts (id, type, owner_id, status, balance_cached)
     values ($1, 'user_cash', $2, 'active', $3) on conflict (id) do nothing`,
    [`account_${userId}_cash`, userId, cash]
  );
}

beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);

  // Seed market with a second user sharing the same market / accounts.
  // We seed the primary market with TRADER_YES, then insert TRADER_NO manually.
  ids = await seedMinimalBinaryMarket(pool, {
    userId: TRADER_YES,
    userCash: "500.000000",
    marketId: "inttest_resolve_market",
    liquidityB: "1000.00000000",
    marketTreasuryBalance: "100000.000000",
    platformTreasuryBalance: "500000.000000"
  });

  // Add TRADER_NO with their own cash account
  await insertTrader(pool, TRADER_NO);

  // Trader YES buys YES
  await executeTrade(
    pool,
    TEST_ENV,
    ids.marketId,
    {
      side: "buy",
      outcomeKey: ids.outcomeYesId,
      cashAmount: "50.000000",
      idempotencyKey: "inttest:resolve:buy:yes:1",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    },
    { actorId: TRADER_YES }
  );

  // Trader NO buys NO
  await executeTrade(
    pool,
    TEST_ENV,
    ids.marketId,
    {
      side: "buy",
      outcomeKey: ids.outcomeNoId,
      cashAmount: "50.000000",
      idempotencyKey: "inttest:resolve:buy:no:1",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    },
    { actorId: TRADER_NO }
  );

  // Close the market before resolving
  await closeMarket(pool, ids.marketId);
});

afterEach(async () => {
  await pool.end();
});

describe("resolve-market integration", () => {
  it("resolves a closed binary market: winner pending, loser not_applicable, treasury swept", async () => {
    const treasuryBefore = parseFloat(await readBalance(pool, ids.marketTreasuryAccountId));
    const platformBefore = parseFloat(await readBalance(pool, ids.platformTreasuryAccountId));

    const response = await resolveMarket(
      pool,
      ids.marketId,
      {
        winningOutcomeId: ids.outcomeYesId,
        triggerType: "oracle_proposal",
        resolutionSourceUrl: "https://inttest.example.com/result",
        resolutionNote: "Integration test resolution.",
        oracleCaseId: "inttest_oracle_case_1",
        proposedByOracleId: "inttest_oracle_agent_1",
        approvedByHumanId: null,
        evidenceSnapshot: null,
        idempotencyKey: "inttest:resolve:market:1"
      },
      ADMIN_ACTOR
    );

    // ── Service response ──────────────────────────────────────────────────────
    expect(response.status).toBe("resolved");
    expect(response.winningOutcomeId).toBe(ids.outcomeYesId);
    expect(response.settlementStatus).toBe("completed");
    expect(response.resolutionId).toMatch(/^resolution_/);

    // ── Market row ────────────────────────────────────────────────────────────
    const marketRow = await pool.query<{ status: string; settlement_status: string }>(
      "select status, settlement_status from markets where id = $1",
      [ids.marketId]
    );
    expect(marketRow.rows[0]!.status).toBe("resolved");
    expect(marketRow.rows[0]!.settlement_status).toBe("completed");

    // ── Positions deleted ─────────────────────────────────────────────────────
    const winnerPos = await readPosition(pool, TRADER_YES, ids.marketId, ids.outcomeYesId);
    expect(winnerPos).toBeNull();
    const loserPos = await readPosition(pool, TRADER_NO, ids.marketId, ids.outcomeNoId);
    expect(loserPos).toBeNull();

    // ── Realization events ────────────────────────────────────────────────────
    const winnerEvents = await readRealizationEvents(pool, TRADER_YES, ids.marketId);
    expect(winnerEvents).toHaveLength(1);
    expect(winnerEvents[0]!.type).toBe("resolution_win");
    expect(winnerEvents[0]!.claim_status).toBe("pending");
    // winner proceeds = shares_closed (binary payout = 1 per share)
    expect(parseFloat(winnerEvents[0]!.proceeds)).toBeGreaterThan(0);

    const loserEvents = await readRealizationEvents(pool, TRADER_NO, ids.marketId);
    expect(loserEvents).toHaveLength(1);
    expect(loserEvents[0]!.type).toBe("resolution_loss");
    expect(loserEvents[0]!.claim_status).toBe("not_applicable");
    expect(loserEvents[0]!.proceeds).toBe("0.000000");

    // ── contract_positions settled ────────────────────────────────────────────
    const contractPositions = await pool.query<{ settled_at: string | null }>(
      "select settled_at from contract_positions where market_id = $1",
      [ids.marketId]
    );
    // All contract positions must have a settled_at timestamp
    for (const row of contractPositions.rows) {
      expect(row.settled_at).not.toBeNull();
    }

    // ── Treasury accounting ───────────────────────────────────────────────────
    const winnerProceeds = parseFloat(winnerEvents[0]!.proceeds);
    const treasuryAfter = parseFloat(await readBalance(pool, ids.marketTreasuryAccountId));
    const platformAfter = parseFloat(await readBalance(pool, ids.platformTreasuryAccountId));

    // Treasury should hold exactly the pending winner reserve
    expect(treasuryAfter).toBeCloseTo(winnerProceeds, 4);

    // Platform treasury received the sweep (non-winner liquidity)
    const swept = treasuryBefore - winnerProceeds;
    if (swept > 0) {
      expect(platformAfter).toBeCloseTo(platformBefore + swept, 4);
    }
  });

  it("rejects resolution of an open market", async () => {
    // Re-open the market to trigger the guard
    await pool.query("update markets set status = 'open' where id = $1", [ids.marketId]);

    await expect(
      resolveMarket(
        pool,
        ids.marketId,
        {
          winningOutcomeId: ids.outcomeYesId,
          triggerType: "oracle_proposal",
          resolutionSourceUrl: "https://inttest.example.com/result",
          resolutionNote: "Should fail.",
          oracleCaseId: null,
          proposedByOracleId: null,
          approvedByHumanId: null,
          evidenceSnapshot: null,
          idempotencyKey: "inttest:resolve:open:reject"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject({ code: "market_not_resolvable", statusCode: 409 });
  });

  it("idempotent resolve: second call returns stored response, no duplicate records", async () => {
    const req = {
      winningOutcomeId: ids.outcomeYesId,
      triggerType: "oracle_proposal" as const,
      resolutionSourceUrl: "https://inttest.example.com/result",
      resolutionNote: "Idempotent integration test.",
      oracleCaseId: null,
      proposedByOracleId: null,
      approvedByHumanId: null,
      evidenceSnapshot: null,
      idempotencyKey: "inttest:resolve:idem:1"
    };

    const first = await resolveMarket(pool, ids.marketId, req, ADMIN_ACTOR);
    const second = await resolveMarket(pool, ids.marketId, req, ADMIN_ACTOR);

    expect(second.resolutionId).toBe(first.resolutionId);

    // Only one market_resolutions row
    const resCount = await pool.query<{ cnt: string }>(
      "select count(*)::text as cnt from market_resolutions where market_id = $1",
      [ids.marketId]
    );
    expect(resCount.rows[0]!.cnt).toBe("1");
  });

  it.each([3, 4] as const)(
    "conserves total V₪ and settles every position for a %i-outcome market",
    async (outcomeCount) => {
      await truncateAllTables(pool);
      const multi = await seedMinimalMultiOutcomeMarket(pool, {
        outcomeCount,
        userId: `inttest_multi_trader_1_${outcomeCount}`,
        userCash: "500.000000",
        marketId: `inttest_resolve_market_${outcomeCount}_way`,
        liquidityB: "1000.00000000",
        marketTreasuryBalance: "100000.000000",
        platformTreasuryBalance: "500000.000000"
      });

      const traderIds = Array.from({ length: outcomeCount }, (_value, index) => (
        `inttest_multi_trader_${index + 1}_${outcomeCount}`
      ));
      for (const traderId of traderIds.slice(1)) {
        await insertTrader(pool, traderId);
      }

      for (const [index, traderId] of traderIds.entries()) {
        await executeTrade(
          pool,
          TEST_ENV,
          multi.marketId,
          {
            side: "buy",
            outcomeKey: multi.outcomeIds[index]!,
            cashAmount: "40.000000",
            idempotencyKey: `inttest:resolve:${outcomeCount}:buy:${index}`,
            quoteId: null,
            quotedAt: null,
            quoteExpiresAt: null,
            expectedMarketStateVersion: null
          },
          { actorId: traderId }
        );
      }

      await closeMarket(pool, multi.marketId);
      const totalBeforeResolution = parseFloat(await readTotalEconomyBalance(pool));
      const treasuryBefore = parseFloat(await readBalance(pool, multi.marketTreasuryAccountId));
      const platformBefore = parseFloat(await readBalance(pool, multi.platformTreasuryAccountId));
      const winningOutcomeId = multi.outcomeIds[1]!;

      await resolveMarket(
        pool,
        multi.marketId,
        {
          winningOutcomeId,
          triggerType: "human_reviewed_oracle_resolution",
          resolutionSourceUrl: "https://inttest.example.com/multi-result",
          resolutionNote: "Multi-outcome conservation test.",
          oracleCaseId: null,
          proposedByOracleId: null,
          approvedByHumanId: ADMIN_ACTOR.actorId,
          evidenceSnapshot: null,
          idempotencyKey: `inttest:resolve:${outcomeCount}:market`
        },
        ADMIN_ACTOR
      );

      const totalAfterResolution = parseFloat(await readTotalEconomyBalance(pool));
      expect(totalAfterResolution).toBeCloseTo(totalBeforeResolution, 4);

      let winnerProceeds = 0;
      for (const [index, traderId] of traderIds.entries()) {
        const events = await readRealizationEvents(pool, traderId, multi.marketId);
        expect(events).toHaveLength(1);
        const expectedWinner = multi.outcomeIds[index] === winningOutcomeId;
        expect(events[0]!.type).toBe(expectedWinner ? "resolution_win" : "resolution_loss");
        expect(events[0]!.claim_status).toBe(expectedWinner ? "pending" : "not_applicable");
        if (expectedWinner) {
          winnerProceeds = parseFloat(events[0]!.proceeds);
          expect(winnerProceeds).toBeGreaterThan(0);
        } else {
          expect(events[0]!.proceeds).toBe("0.000000");
        }
      }

      const openPositions = await pool.query<{ count: string }>(
        "select count(*)::text as count from positions where market_id = $1",
        [multi.marketId]
      );
      expect(openPositions.rows[0]!.count).toBe("0");

      const treasuryAfter = parseFloat(await readBalance(pool, multi.marketTreasuryAccountId));
      const platformAfter = parseFloat(await readBalance(pool, multi.platformTreasuryAccountId));
      expect(treasuryAfter).toBeCloseTo(winnerProceeds, 4);

      const swept = treasuryBefore - winnerProceeds;
      if (swept > 0) {
        expect(platformAfter).toBeCloseTo(platformBefore + swept, 4);
      }
    }
  );
});
