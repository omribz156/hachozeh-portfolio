import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../src/auth/actor-resolver";
import type { AppEnv } from "../src/config/env";
import { executeTrade } from "../src/engine/trading/trade-service";
import { voidMarket } from "../src/lifecycle/management/void-market-service";
import {
  createTestPool,
  readBalance,
  readPosition,
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

const ADMIN_ACTOR: RequestActor = {
  actorId: "inttest_admin_void",
  mode: "session",
  sessionId: "inttest_session_admin_void",
  role: "admin"
};

let pool: Pool;
let ids: SeedIds;

beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);
  ids = await seedMinimalBinaryMarket(pool, {
    userId: "inttest_void_trader",
    userCash: "500.000000",
    marketId: "inttest_void_market",
    liquidityB: "1000.00000000",
    marketTreasuryBalance: "100000.000000",
    platformTreasuryBalance: "500000.000000"
  });
});

afterEach(async () => {
  await pool.end();
});

describe("void-market integration", () => {
  it("refunds remaining cost basis, deletes positions, sweeps residue, and conserves total V₪", async () => {
    await executeTrade(
      pool,
      TEST_ENV,
      ids.marketId,
      {
        side: "buy",
        outcomeKey: ids.outcomeYesId,
        cashAmount: "50.000000",
        idempotencyKey: "inttest:void:buy:1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      },
      { actorId: ids.userId }
    );

    expect(await readPosition(pool, ids.userId, ids.marketId, ids.outcomeYesId)).not.toBeNull();
    const totalBeforeVoid = parseFloat(await readTotalEconomyBalance(pool));
    const userCashBeforeVoid = parseFloat(await readBalance(pool, ids.userCashAccountId));
    const platformBeforeVoid = parseFloat(await readBalance(pool, ids.platformTreasuryAccountId));
    const marketTreasuryBeforeVoid = parseFloat(await readBalance(pool, ids.marketTreasuryAccountId));

    const response = await voidMarket(
      pool,
      ids.marketId,
      {
        reason: "bad_contract",
        note: "Integration test void.",
        idempotencyKey: "inttest:void:market:1"
      },
      ADMIN_ACTOR
    );

    expect(response.status).toBe("voided");
    expect(response.refundedPositionCount).toBe(1);
    expect(response.refundedAmount).toBe("50.000000");
    expect(parseFloat(response.sweptAmount)).toBeGreaterThan(0);

    expect(await readPosition(pool, ids.userId, ids.marketId, ids.outcomeYesId)).toBeNull();
    expect(parseFloat(await readBalance(pool, ids.userCashAccountId))).toBeCloseTo(
      userCashBeforeVoid + 50,
      4
    );
    expect(parseFloat(await readBalance(pool, ids.marketTreasuryAccountId))).toBeCloseTo(0, 4);
    expect(parseFloat(await readBalance(pool, ids.platformTreasuryAccountId))).toBeCloseTo(
      platformBeforeVoid + marketTreasuryBeforeVoid - 50,
      4
    );
    expect(parseFloat(await readTotalEconomyBalance(pool))).toBeCloseTo(totalBeforeVoid, 4);
  });
});
