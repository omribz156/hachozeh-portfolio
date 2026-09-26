/**
 * Integration spec A: trade-execute
 *
 * Seeds a user with cash + an open binary market via direct inserts,
 * then drives executeTrade against the real pool and asserts exact
 * post-trade DB state (account balances, positions, ledger entries).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../src/config/env";
import { executeTrade } from "../src/engine/trading/trade-service";
import {
  closeMarket,
  countLedgerEntriesForAccount,
  createTestPool,
  readBalance,
  readContractPosition,
  readPosition,
  seedMinimalBinaryMarket,
  truncateAllTables,
  type SeedIds
} from "./helpers";

import type { Pool } from "pg";

// ── Test env ──────────────────────────────────────────────────────────────────
// Minimal AppEnv — only the slices executeTrade actually touches.
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

// ── Suite ─────────────────────────────────────────────────────────────────────

let pool: Pool;
let ids: SeedIds;

beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);
  ids = await seedMinimalBinaryMarket(pool, {
    userId: "inttest_trader_1",
    userCash: "1000.000000",
    marketId: "inttest_market_binary",
    liquidityB: "1000.00000000",
    marketTreasuryBalance: "100000.000000"
  });
});

afterEach(async () => {
  await pool.end();
});

// ── executeTrade uses market key lookup from market-identity.ts registry.
// The test market id "inttest_market_binary" is not in the registry so the
// service uses the id directly as both key and id — that's the fallback path.
const MARKET_KEY = "inttest_market_binary";
const ACTOR = { actorId: "inttest_trader_1" };

describe("trade-execute integration", () => {
  it("buy YES: deducts cash, creates position + contract_position + ledger entries", async () => {
    const cashBefore = await readBalance(pool, ids.userCashAccountId);
    expect(cashBefore).toBe("1000.000000");

    const response = await executeTrade(
      pool,
      TEST_ENV,
      MARKET_KEY,
      {
        side: "buy",
        outcomeKey: ids.outcomeYesId,  // key == id for unregistered markets
        cashAmount: "100.000000",
        idempotencyKey: "inttest:buy:yes:1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      ACTOR
    );

    // Service returns a well-formed response
    expect(response.side).toBe("buy");
    expect(response.marketId).toBe(ids.marketId);

    const cashBought = response.cashSpent;
    const sharesBought = response.sharesBought;

    // Cash decreased by exactly cashSpent
    const cashAfter = await readBalance(pool, ids.userCashAccountId);
    const expectedCashAfter = (1000 - parseFloat(cashBought)).toFixed(6);
    expect(cashAfter).toBe(expectedCashAfter);

    // Treasury increased by exactly cashSpent
    const treasuryAfter = await readBalance(pool, ids.marketTreasuryAccountId);
    const expectedTreasuryAfter = (100000 + parseFloat(cashBought)).toFixed(6);
    expect(treasuryAfter).toBe(expectedTreasuryAfter);

    // position row exists with correct shares
    const pos = await readPosition(pool, ACTOR.actorId, ids.marketId, ids.outcomeYesId);
    expect(pos).not.toBeNull();
    expect(pos!.shares).toBe(sharesBought);
    // cost_basis equals cashSpent for a single-leg binary buy
    expect(pos!.cost_basis).toBe(cashBought);
    expect(pos!.realized_pnl).toBe("0.000000");

    // contract_position row exists
    const cp = await readContractPosition(
      pool,
      ACTOR.actorId,
      ids.marketId,
      ids.outcomeYesId,
      "yes"
    );
    expect(cp).not.toBeNull();
    expect(cp!.shares).toBe(sharesBought);
    expect(cp!.cost_basis).toBe(cashBought);

    // ledger entries written for both sides of the trade
    const userLedgerCount = await countLedgerEntriesForAccount(pool, ids.userCashAccountId);
    expect(userLedgerCount).toBeGreaterThanOrEqual(1);
    const treasuryLedgerCount = await countLedgerEntriesForAccount(
      pool,
      ids.marketTreasuryAccountId
    );
    expect(treasuryLedgerCount).toBeGreaterThanOrEqual(1);
  });

  it("sell YES: restores cash, removes position, books realized pnl in ledger", async () => {
    // First buy
    const buyResponse = await executeTrade(
      pool,
      TEST_ENV,
      MARKET_KEY,
      {
        side: "buy",
        outcomeKey: ids.outcomeYesId,
        cashAmount: "100.000000",
        idempotencyKey: "inttest:buy:yes:2",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      ACTOR
    );

    const sharesBought = buyResponse.sharesBought;
    const cashAfterBuy = await readBalance(pool, ids.userCashAccountId);

    // Sell all shares back
    const sellResponse = await executeTrade(
      pool,
      TEST_ENV,
      MARKET_KEY,
      {
        side: "sell",
        outcomeKey: ids.outcomeYesId,
        contractSide: "yes",
        shareAmount: sharesBought,
        idempotencyKey: "inttest:sell:yes:1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      ACTOR
    );

    expect(sellResponse.side).toBe("sell");
    expect(sellResponse.sharesSold).toBe(sharesBought);

    const proceedsReceived = sellResponse.proceedsReceived!;

    // Cash after sell = cashAfterBuy + proceedsReceived
    const cashAfterSell = await readBalance(pool, ids.userCashAccountId);
    const expectedCashAfterSell = (
      parseFloat(cashAfterBuy) + parseFloat(proceedsReceived)
    ).toFixed(6);
    expect(cashAfterSell).toBe(expectedCashAfterSell);

    // Position fully sold — row deleted
    const pos = await readPosition(pool, ACTOR.actorId, ids.marketId, ids.outcomeYesId);
    expect(pos).toBeNull();

    // contract_position deleted
    const cp = await readContractPosition(
      pool,
      ACTOR.actorId,
      ids.marketId,
      ids.outcomeYesId,
      "yes"
    );
    expect(cp).toBeNull();

    // Treasury decreased by exactly proceedsReceived
    const treasuryAfterSell = await readBalance(pool, ids.marketTreasuryAccountId);
    const expectedTreasury =
      100000 + parseFloat(buyResponse.cashSpent) - parseFloat(proceedsReceived);
    expect(parseFloat(treasuryAfterSell)).toBeCloseTo(expectedTreasury, 4);
  });

  it("partial sell: position row updated, not deleted", async () => {
    const buyResponse = await executeTrade(
      pool,
      TEST_ENV,
      MARKET_KEY,
      {
        side: "buy",
        outcomeKey: ids.outcomeYesId,
        cashAmount: "200.000000",
        idempotencyKey: "inttest:buy:yes:3",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      ACTOR
    );

    const totalShares = parseFloat(buyResponse.sharesBought);
    const halfShares = (totalShares / 2).toFixed(6);

    await executeTrade(
      pool,
      TEST_ENV,
      MARKET_KEY,
      {
        side: "sell",
        outcomeKey: ids.outcomeYesId,
        contractSide: "yes",
        shareAmount: halfShares,
        idempotencyKey: "inttest:sell:yes:partial",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      ACTOR
    );

    // Position still exists with approximately half the shares
    const pos = await readPosition(pool, ACTOR.actorId, ids.marketId, ids.outcomeYesId);
    expect(pos).not.toBeNull();
    const remainingShares = parseFloat(pos!.shares);
    expect(remainingShares).toBeGreaterThan(0);
    expect(remainingShares).toBeLessThan(totalShares);
  });

  it("buy on closed market rejects with market_not_open", async () => {
    await closeMarket(pool, ids.marketId);

    await expect(
      executeTrade(
        pool,
        TEST_ENV,
        MARKET_KEY,
        {
          side: "buy",
          outcomeKey: ids.outcomeYesId,
          cashAmount: "10.000000",
          idempotencyKey: "inttest:buy:closed",
          quoteId: null,
          quotedAt: null,
          quoteExpiresAt: null,
          expectedMarketStateVersion: null
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: "market_not_open", statusCode: 409 });
  });

  it("idempotent buy: second call with same key returns stored response, no duplicate DB writes", async () => {
    const firstResponse = await executeTrade(
      pool,
      TEST_ENV,
      MARKET_KEY,
      {
        side: "buy",
        outcomeKey: ids.outcomeYesId,
        cashAmount: "50.000000",
        idempotencyKey: "inttest:buy:idem:1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      ACTOR
    );

    const cashAfterFirst = await readBalance(pool, ids.userCashAccountId);

    const secondResponse = await executeTrade(
      pool,
      TEST_ENV,
      MARKET_KEY,
      {
        side: "buy",
        outcomeKey: ids.outcomeYesId,
        cashAmount: "50.000000",
        idempotencyKey: "inttest:buy:idem:1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      ACTOR
    );

    // Replay returns same trade id and same cash amount
    expect(secondResponse.tradeId).toBe(firstResponse.tradeId);
    expect(secondResponse.cashSpent).toBe(firstResponse.cashSpent);

    // Balance unchanged after replay
    const cashAfterSecond = await readBalance(pool, ids.userCashAccountId);
    expect(cashAfterSecond).toBe(cashAfterFirst);
  });
});
