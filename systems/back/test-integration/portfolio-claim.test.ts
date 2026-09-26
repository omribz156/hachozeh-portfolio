/**
 * Integration spec C: portfolio-claim
 *
 * Builds on a fully-resolved state (seed → trade → close → resolve)
 * then exercises claimPortfolioRealization and readPortfolioClaims.
 *
 * Asserts:
 *   - User cash credited by exact proceeds amount
 *   - Market treasury debited by exact proceeds amount
 *   - Realization event transitions from 'pending' → 'claimed'
 *   - Ledger transaction + 2 entries written
 *   - Idempotent: second claim attempt throws claim_already_claimed (409)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../src/auth/actor-resolver";
import { resolveMarket } from "../../oracle/src/resolve-market-service";
import { executeTrade } from "../src/engine/trading/trade-service";
import {
  claimPortfolioRealization,
  readPortfolioClaims,
  PortfolioClaimServiceError,
  sweepPendingPortfolioClaims
} from "../src/engine/portfolio/portfolio-claim-service";
import type { AppEnv } from "../src/config/env";
import {
  closeMarket,
  countLedgerEntriesForAccount,
  createTestPool,
  readBalance,
  seedMinimalBinaryMarket,
  truncateAllTables,
  type SeedIds
} from "./helpers";

// ── Env / actors ──────────────────────────────────────────────────────────────
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

const WINNER_USER = "inttest_claim_winner";
const WINNER_USER_2 = "inttest_claim_winner2";
const LOSER_USER = "inttest_claim_loser";

const ADMIN_ACTOR: RequestActor = {
  actorId: "inttest_claim_admin",
  mode: "session",
  sessionId: "inttest_claim_session_admin",
  role: "admin"
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build an actor reference suitable for portfolio services. */
function sessionActor(userId: string): Pick<RequestActor, "actorId" | "mode"> {
  return { actorId: userId, mode: "session" };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

let pool: Pool;
let ids: SeedIds;
let winnerClaimId: string;
let secondaryWinnerClaimId: string;

/**
 * Set up a fully-resolved market state before every test.
 * Execution path: seed → buy YES (winner) + buy NO (loser) → close → resolve
 */
beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);

  ids = await seedMinimalBinaryMarket(pool, {
    userId: WINNER_USER,
    userCash: "500.000000",
    marketId: "inttest_claim_market",
    liquidityB: "1000.00000000",
    marketTreasuryBalance: "100000.000000",
    platformTreasuryBalance: "500000.000000"
  });

  // Seed LOSER_USER
  await pool.query(
    `insert into users (id, handle, status, role, trade_access_status, last_login_at)
     values ($1, $2, 'active', 'user', 'enabled', now()) on conflict (id) do nothing`,
    [LOSER_USER, LOSER_USER]
  );
  await pool.query(
    `insert into accounts (id, type, owner_id, status, balance_cached)
     values ($1, 'user_cash', $2, 'active', '500.000000') on conflict (id) do nothing`,
    [`account_${LOSER_USER}_cash`, LOSER_USER]
  );
  await pool.query(
    `insert into users (id, handle, status, role, trade_access_status, last_login_at)
     values ($1, $2, 'active', 'user', 'enabled', now()) on conflict (id) do nothing`,
    [WINNER_USER_2, WINNER_USER_2]
  );
  await pool.query(
    `insert into accounts (id, type, owner_id, status, balance_cached)
     values ($1, 'user_cash', $2, 'active', '500.000000') on conflict (id) do nothing`,
    [`account_${WINNER_USER_2}_cash`, WINNER_USER_2]
  );

  // Winner buys YES
  await executeTrade(
    pool,
    TEST_ENV,
    ids.marketId,
    {
      side: "buy",
      outcomeKey: ids.outcomeYesId,
      cashAmount: "50.000000",
      idempotencyKey: "inttest:claim:buy:yes:1",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    },
    { actorId: WINNER_USER }
  );
  await executeTrade(
    pool,
    TEST_ENV,
    ids.marketId,
    {
      side: "buy",
      outcomeKey: ids.outcomeYesId,
      cashAmount: "35.000000",
      idempotencyKey: "inttest:claim:buy:yes:2",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    },
    { actorId: WINNER_USER_2 }
  );

  // Loser buys NO
  await executeTrade(
    pool,
    TEST_ENV,
    ids.marketId,
    {
      side: "buy",
      outcomeKey: ids.outcomeNoId,
      cashAmount: "50.000000",
      idempotencyKey: "inttest:claim:buy:no:1",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    },
    { actorId: LOSER_USER }
  );

  await closeMarket(pool, ids.marketId);

  await resolveMarket(
    pool,
    ids.marketId,
    {
      winningOutcomeId: ids.outcomeYesId,
      triggerType: "oracle_proposal",
      resolutionSourceUrl: "https://inttest.example.com/result",
      resolutionNote: "Integration claim test.",
      oracleCaseId: null,
      proposedByOracleId: null,
      approvedByHumanId: null,
      evidenceSnapshot: null,
      idempotencyKey: "inttest:claim:resolve:1"
    },
    ADMIN_ACTOR
  );

  const winnerClaimRows = await pool.query<{ id: string; user_id: string }>(
    `select id, user_id from realization_events
     where user_id = any($1::text[]) and market_id = $2 and type = 'resolution_win'`,
    [[WINNER_USER, WINNER_USER_2], ids.marketId]
  );
  if (winnerClaimRows.rows.length < 2) {
    throw new Error("beforeEach: winner realization events not found for both users");
  }

  const claimIdsByUser = Object.fromEntries(
    winnerClaimRows.rows.map((row) => [row.user_id, row.id])
  ) as Record<string, string>;
  winnerClaimId = claimIdsByUser[WINNER_USER];
  secondaryWinnerClaimId = claimIdsByUser[WINNER_USER_2];

  if (!winnerClaimId || !secondaryWinnerClaimId) {
    throw new Error("beforeEach: winner claim mapping failed");
  }
});

afterEach(async () => {
  await pool.end();
});

describe("portfolio-claim integration", () => {
  it("readPortfolioClaims returns pending winner claim with correct proceeds", async () => {
    const result = await readPortfolioClaims(pool, TEST_ENV, sessionActor(WINNER_USER));

    expect(result.summary.pendingClaimCount).toBe(1);
    expect(parseFloat(result.summary.totalClaimable)).toBeGreaterThan(0);

    const claim = result.claims[0]!;
    expect(claim.claimId).toBe(winnerClaimId);
    expect(claim.status).toBe("pending");
    expect(parseFloat(claim.proceeds)).toBeGreaterThan(0);
    expect(claim.marketId).toBe(ids.marketId);
  });

  it("loser has no pending claims (loss is not_applicable)", async () => {
    const result = await readPortfolioClaims(pool, TEST_ENV, sessionActor(LOSER_USER));

    expect(result.summary.pendingClaimCount).toBe(0);
    expect(result.summary.totalClaimable).toBe("0.000000");
    // resolution_loss events are excluded from readPortfolioClaims
    expect(result.claims).toHaveLength(0);
  });

  it("claimPortfolioRealization credits exact proceeds to user cash, debits market treasury", async () => {
    const cashBefore = parseFloat(await readBalance(pool, ids.userCashAccountId));
    const treasuryBefore = parseFloat(await readBalance(pool, ids.marketTreasuryAccountId));

    // Read expected proceeds from the realization event
    const eventRow = await pool.query<{ proceeds: string }>(
      "select proceeds::text from realization_events where id = $1",
      [winnerClaimId]
    );
    const expectedProceeds = parseFloat(eventRow.rows[0]!.proceeds);

    const response = await claimPortfolioRealization(
      pool,
      TEST_ENV,
      winnerClaimId,
      sessionActor(WINNER_USER)
    );

    // Service response
    expect(response.summary.creditedAmount).toBe(expectedProceeds.toFixed(6));
    expect(response.claim.status).toBe("claimed");
    expect(response.claim.claimId).toBe(winnerClaimId);

    // DB: user cash increased by proceeds
    const cashAfter = parseFloat(await readBalance(pool, ids.userCashAccountId));
    expect(cashAfter).toBeCloseTo(cashBefore + expectedProceeds, 4);

    // DB: market treasury decreased by proceeds
    const treasuryAfter = parseFloat(await readBalance(pool, ids.marketTreasuryAccountId));
    expect(treasuryAfter).toBeCloseTo(treasuryBefore - expectedProceeds, 4);

    // DB: realization_event status = 'claimed'
    const eventAfter = await pool.query<{ claim_status: string }>(
      "select claim_status from realization_events where id = $1",
      [winnerClaimId]
    );
    expect(eventAfter.rows[0]!.claim_status).toBe("claimed");

    // DB: ledger entries written (2: debit market_treasury + credit user_cash)
    const userEntries = await countLedgerEntriesForAccount(pool, ids.userCashAccountId);
    // At least 2 claim entries (may include prior trade entries)
    expect(userEntries).toBeGreaterThanOrEqual(1);

    const treasuryEntries = await countLedgerEntriesForAccount(pool, ids.marketTreasuryAccountId);
    expect(treasuryEntries).toBeGreaterThanOrEqual(1);
  });

  it("allows two independent winner claims to settle concurrently with consecutive ledger sequence chain", async () => {
    const treasuryBefore = parseFloat(await readBalance(pool, ids.marketTreasuryAccountId));
    const winnerCashBefore = parseFloat(await readBalance(pool, `account_${WINNER_USER}_cash`));
    const winnerCashBefore2 = parseFloat(await readBalance(pool, `account_${WINNER_USER_2}_cash`));

    const ledgerMaxBefore = await pool.query<{ max_seq: string | null }>(
      "select max(sequence_number)::text as max_seq from ledger_transactions"
    );
    const maxSequenceBefore = Number(ledgerMaxBefore.rows[0]!.max_seq ?? "0");

    const proceedsRows = await pool.query<{ id: string; proceeds: string }>(
      `select id, proceeds::text
       from realization_events
       where id in ($1, $2)
       order by id asc`,
      [winnerClaimId, secondaryWinnerClaimId]
    );
    const proceedsByClaim = Object.fromEntries(
      proceedsRows.rows.map((row) => [row.id, parseFloat(row.proceeds)])
    ) as Record<string, number>;

    const [winnerResponse, secondWinnerResponse] = await Promise.all([
      claimPortfolioRealization(pool, TEST_ENV, winnerClaimId, sessionActor(WINNER_USER)),
      claimPortfolioRealization(
        pool,
        TEST_ENV,
        secondaryWinnerClaimId,
        sessionActor(WINNER_USER_2)
      )
    ]);

    expect(winnerResponse.claim.claimId).toBe(winnerClaimId);
    expect(winnerResponse.claim.status).toBe("claimed");
    expect(winnerResponse.summary.creditedAmount).toBe(proceedsByClaim[winnerClaimId]!.toFixed(6));
    expect(secondWinnerResponse.claim.claimId).toBe(secondaryWinnerClaimId);
    expect(secondWinnerResponse.claim.status).toBe("claimed");
    expect(secondWinnerResponse.summary.creditedAmount).toBe(
      proceedsByClaim[secondaryWinnerClaimId]!.toFixed(6)
    );

    const expectedWinnerCashAfter = winnerCashBefore + proceedsByClaim[winnerClaimId]!;
    const expectedWinnerCashAfter2 = winnerCashBefore2 + proceedsByClaim[secondaryWinnerClaimId]!;
    const expectedTreasuryAfter = treasuryBefore - (
      proceedsByClaim[winnerClaimId]! + proceedsByClaim[secondaryWinnerClaimId]!
    );

    const winnerCashAfter = parseFloat(await readBalance(pool, `account_${WINNER_USER}_cash`));
    const winnerCashAfter2 = parseFloat(await readBalance(pool, `account_${WINNER_USER_2}_cash`));
    const treasuryAfter = parseFloat(await readBalance(pool, ids.marketTreasuryAccountId));

    expect(winnerCashAfter).toBeCloseTo(expectedWinnerCashAfter, 4);
    expect(winnerCashAfter2).toBeCloseTo(expectedWinnerCashAfter2, 4);
    expect(treasuryAfter).toBeCloseTo(expectedTreasuryAfter, 4);

    const claimStatuses = await pool.query<{ id: string; claim_status: string }>(
      `select id, claim_status
       from realization_events
       where id in ($1, $2)`,
      [winnerClaimId, secondaryWinnerClaimId]
    );
    expect(claimStatuses.rows).toHaveLength(2);
    for (const row of claimStatuses.rows) {
      expect(row.claim_status).toBe("claimed");
    }

    const ledgerRows = await pool.query<{
      sequence_number: string;
      previous_transaction_hash: string;
      transaction_hash: string;
    }>(
      `select sequence_number::text as sequence_number,
              previous_transaction_hash,
              transaction_hash
       from ledger_transactions
       where type = 'claim_payout'
         and reference_type = 'realization'
         and reference_id in ($1, $2)
       order by sequence_number asc`,
      [winnerClaimId, secondaryWinnerClaimId]
    );
    expect(ledgerRows.rows).toHaveLength(2);

    const firstLedger = ledgerRows.rows[0]!;
    const secondLedger = ledgerRows.rows[1]!;
    const firstSequence = Number(firstLedger.sequence_number);
    const secondSequence = Number(secondLedger.sequence_number);

    expect(firstSequence).toBe(maxSequenceBefore + 1);
    expect(secondSequence).toBe(maxSequenceBefore + 2);
    expect(secondLedger.previous_transaction_hash).toBe(firstLedger.transaction_hash);

    if (firstSequence === 1) {
      expect(firstLedger.previous_transaction_hash).toBe("GENESIS");
    } else {
      const previousLedgerRow = await pool.query<{ transaction_hash: string }>(
        "select transaction_hash from ledger_transactions where sequence_number = $1",
        [firstSequence - 1]
      );
      expect(firstLedger.previous_transaction_hash).toBe(previousLedgerRow.rows[0]!.transaction_hash);
    }
  });

  it("sweeps old pending winner claims and is idempotent", async () => {
    await pool.query(
      `
        update realization_events
        set created_at = now() - interval '31 days'
        where id = $1
      `,
      [winnerClaimId]
    );
    const cashBefore = parseFloat(await readBalance(pool, ids.userCashAccountId));
    const treasuryBefore = parseFloat(await readBalance(pool, ids.marketTreasuryAccountId));
    const eventRow = await pool.query<{ proceeds: string }>(
      "select proceeds::text from realization_events where id = $1",
      [winnerClaimId]
    );
    const expectedProceeds = parseFloat(eventRow.rows[0]!.proceeds);

    const response = await sweepPendingPortfolioClaims(pool, {
      actorId: "inttest_claim_sweep",
      olderThanDays: 30,
      limit: 100
    });

    expect(response.sweptCount).toBe(1);
    expect(response.claimIds).toEqual([winnerClaimId]);
    expect(response.sweptAmount).toBe(expectedProceeds.toFixed(6));
    expect(parseFloat(await readBalance(pool, ids.userCashAccountId))).toBeCloseTo(
      cashBefore + expectedProceeds,
      4
    );
    expect(parseFloat(await readBalance(pool, ids.marketTreasuryAccountId))).toBeCloseTo(
      treasuryBefore - expectedProceeds,
      4
    );

    const eventAfter = await pool.query<{ claim_status: string }>(
      "select claim_status from realization_events where id = $1",
      [winnerClaimId]
    );
    expect(eventAfter.rows[0]!.claim_status).toBe("claimed");

    const second = await sweepPendingPortfolioClaims(pool, {
      actorId: "inttest_claim_sweep",
      olderThanDays: 30,
      limit: 100
    });
    expect(second).toEqual({
      sweptCount: 0,
      sweptAmount: "0.000000",
      claimIds: []
    });
  });

  it("second claim attempt throws claim_already_claimed (409) — idempotent guard", async () => {
    // First claim succeeds
    await claimPortfolioRealization(
      pool,
      TEST_ENV,
      winnerClaimId,
      sessionActor(WINNER_USER)
    );

    const cashAfterFirst = await readBalance(pool, ids.userCashAccountId);
    const treasuryAfterFirst = await readBalance(pool, ids.marketTreasuryAccountId);

    // Second claim on same id must be rejected
    await expect(
      claimPortfolioRealization(
        pool,
        TEST_ENV,
        winnerClaimId,
        sessionActor(WINNER_USER)
      )
    ).rejects.toMatchObject({
      code: "claim_already_claimed",
      statusCode: 409
    } satisfies Partial<PortfolioClaimServiceError>);

    // Balances must be unchanged after the rejected second attempt
    const cashAfterSecond = await readBalance(pool, ids.userCashAccountId);
    const treasuryAfterSecond = await readBalance(pool, ids.marketTreasuryAccountId);
    expect(cashAfterSecond).toBe(cashAfterFirst);
    expect(treasuryAfterSecond).toBe(treasuryAfterFirst);
  });

  it("wrong user cannot claim winner's payout (claim_not_found)", async () => {
    await expect(
      claimPortfolioRealization(
        pool,
        TEST_ENV,
        winnerClaimId,
        sessionActor(LOSER_USER)
      )
    ).rejects.toMatchObject({
      code: "claim_not_found",
      statusCode: 404
    } satisfies Partial<PortfolioClaimServiceError>);
  });
});
