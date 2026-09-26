import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import type { AppEnv } from "../src/config/env";
import {
  DAILY_LOGIN_STREAK_REWARDS
} from "../src/economy/economy-config";
import {
  claimDailyLoginFaucet,
  claimEmergencyFaucet,
  FaucetServiceError
} from "../src/economy/faucet-service";
import { executeTrade } from "../src/engine/trading/trade-service";
import {
  createTestPool,
  readBalance,
  readTotalEconomyBalance,
  seedMinimalBinaryMarket,
  truncateAllTables,
  type SeedIds
} from "./helpers";

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

let pool: Pool;
let ids: SeedIds;

beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);
  ids = await seedMinimalBinaryMarket(pool, {
    userId: "inttest_faucet_user",
    userCash: "500.000000",
    marketId: "inttest_faucet_market",
    liquidityB: "1000.00000000",
    marketTreasuryBalance: "100000.000000",
    platformTreasuryBalance: "500000.000000"
  });
});

afterEach(async () => {
  await pool.end();
});

describe("faucet service integration", () => {
  it("awards flat baseline without active positions and does not advance streak", async () => {
    const totalBefore = parseFloat(await readTotalEconomyBalance(pool));
    const response = await claimDailyLoginFaucet(
      pool,
      ids.userId,
      new Date("2026-06-14T09:00:00+03:00")
    );

    expect(response.rewardAmount).toBe("25.000000");
    expect(response.streakDayAwarded).toBeNull();
    expect(response.currentStreakDay).toBe(0);
    expect(response.nextClaimAt).toBe("2026-06-14T21:00:00.000Z");
    expect(response.eligibilityReason).toBe("no_active_position_baseline");
    expect(parseFloat(await readBalance(pool, ids.userCashAccountId))).toBeCloseTo(525, 4);
    expect(parseFloat(await readTotalEconomyBalance(pool))).toBeCloseTo(totalBefore, 4);
  });

  it("advances active-position daily streak and loops day 8 back to day 1", async () => {
    await executeTrade(
      pool,
      TEST_ENV,
      ids.marketId,
      {
        side: "buy",
        outcomeKey: ids.outcomeYesId,
        cashAmount: "25.000000",
        idempotencyKey: "inttest:faucet:buy:1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      { actorId: ids.userId }
    );

    const totalBefore = parseFloat(await readTotalEconomyBalance(pool));
    const rewards: string[] = [];
    const streakDays: Array<number | null> = [];

    for (let index = 0; index < 8; index += 1) {
      const response = await claimDailyLoginFaucet(
        pool,
        ids.userId,
        new Date(Date.UTC(2026, 5, 14 + index, 6, 0, 0))
      );
      rewards.push(response.rewardAmount);
      streakDays.push(response.streakDayAwarded);
    }

    expect(rewards).toEqual([
      ...DAILY_LOGIN_STREAK_REWARDS,
      DAILY_LOGIN_STREAK_REWARDS[0]
    ]);
    expect(streakDays).toEqual([1, 2, 3, 4, 5, 6, 7, 1]);
    expect(parseFloat(await readTotalEconomyBalance(pool))).toBeCloseTo(totalBefore, 4);
  });

  it("returns same daily claim on duplicate local-day request", async () => {
    const first = await claimDailyLoginFaucet(
      pool,
      ids.userId,
      new Date("2026-06-14T09:00:00+03:00")
    );
    const second = await claimDailyLoginFaucet(
      pool,
      ids.userId,
      new Date("2026-06-14T12:00:00+03:00")
    );

    expect(second.alreadyClaimed).toBe(true);
    expect(second.rewardAmount).toBe(first.rewardAmount);
    expect(second.ledgerTransactionId).toBe(first.ledgerTransactionId);
  });

  it("allows emergency grant only for zero-balance users with no active positions", async () => {
    await pool.query(
      "update accounts set balance_cached = '0.000000' where id = $1",
      [ids.userCashAccountId]
    );
    const totalBefore = parseFloat(await readTotalEconomyBalance(pool));

    const response = await claimEmergencyFaucet(
      pool,
      ids.userId,
      new Date("2026-06-14T09:00:00+03:00")
    );

    expect(response.rewardAmount).toBe("100.000000");
    expect(response.eligibilityReason).toBe("bankruptcy_emergency");
    expect(parseFloat(await readBalance(pool, ids.userCashAccountId))).toBeCloseTo(100, 4);
    expect(parseFloat(await readTotalEconomyBalance(pool))).toBeCloseTo(totalBefore, 4);

    await expect(
      claimEmergencyFaucet(pool, ids.userId, new Date("2026-06-14T10:00:00+03:00"))
    ).rejects.toBeInstanceOf(FaucetServiceError);
  });
});
