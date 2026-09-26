import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../src/auth/actor-resolver";
import { executeTrade } from "../src/engine/trading/trade-service";
import { resolveMarket } from "../../oracle/src/resolve-market-service";
import { runMarketIncidentCompensation } from "../src/scripts/market-incident-compensation";
import type { AppEnv } from "../src/config/env";
import {
  closeMarket,
  createTestPool,
  readBalance,
  seedMinimalBinaryMarket,
  type SeedIds,
  truncateAllTables
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
  actorId: "inttest_admin_incident_operator",
  mode: "session",
  sessionId: "inttest_session_incident_operator",
  role: "admin"
};

const INCIDENCE_TRADER = "inttest_incident_trader_1";

let pool: Pool;
let ids: SeedIds;

async function getLossRealizationEventId(pool: Pool, marketId: string, userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      select id
      from realization_events
      where market_id = $1
        and user_id = $2
        and type = 'resolution_loss'
      order by created_at desc
      limit 1
    `,
    [marketId, userId]
  );

  if (!result.rows[0]) {
    throw new Error(`expected at least one resolution loss event for market ${marketId}`);
  }

  return result.rows[0].id;
}

beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);
  ids = await seedMinimalBinaryMarket(pool, {
    userId: INCIDENCE_TRADER,
    userCash: "500.000000",
    marketId: "inttest_incident_compensation_market",
    liquidityB: "1000.00000000",
    marketTreasuryBalance: "100000.000000",
    platformTreasuryBalance: "500000.000000"
  });

  await executeTrade(
    pool,
    TEST_ENV,
    ids.marketId,
    {
      side: "buy",
      outcomeKey: ids.outcomeYesId,
      cashAmount: "50.000000",
      idempotencyKey: "inttest:incident:trade:buy",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    },
    { actorId: INCIDENCE_TRADER }
  );

  await closeMarket(pool, ids.marketId);

  await resolveMarket(
    pool,
    ids.marketId,
    {
      winningOutcomeId: ids.outcomeNoId,
      triggerType: "oracle_proposal",
      resolutionSourceUrl: "https://inttest.example.com/wrong",
      resolutionNote: "Initial wrong resolution for incident test.",
      oracleCaseId: "inttest_oracle_case_incident",
      proposedByOracleId: "inttest_oracle_agent_1",
      approvedByHumanId: null,
      evidenceSnapshot: null,
      idempotencyKey: "inttest:resolve:incident:1"
    },
    ADMIN_ACTOR
  );
});

afterEach(async () => {
  await pool.end();
});

describe("market incident compensation integration", () => {
  it("serializes two concurrent execute calls so only one compensation transfer is created", async () => {
    const userCashBefore = parseFloat(await readBalance(pool, ids.userCashAccountId));
    const lossRealizationEventId = await getLossRealizationEventId(pool, ids.marketId, INCIDENCE_TRADER);

    const [first, second] = await Promise.all([
      runMarketIncidentCompensation(pool, {
        marketId: ids.marketId,
        correctWinningOutcomeId: ids.outcomeYesId,
        actorId: ADMIN_ACTOR.actorId,
        reason: "incident compensation concurrency test",
        summary: "Incident compensation for wrong resolution",
        sourceUrl: "https://inttest.example.com/original",
        sourceLabel: "Inttest source",
        idempotencyKey: "inttest:market-incident-compensation:1",
        execute: true,
        noteOnly: false,
        correctResolutionDisplay: false,
        json: true,
        renderLogReceipt: false
      }),
      runMarketIncidentCompensation(pool, {
        marketId: ids.marketId,
        correctWinningOutcomeId: ids.outcomeYesId,
        actorId: ADMIN_ACTOR.actorId,
        reason: "incident compensation concurrency test",
        summary: "Incident compensation for wrong resolution",
        sourceUrl: "https://inttest.example.com/original",
        sourceLabel: "Inttest source",
        idempotencyKey: "inttest:market-incident-compensation:2",
        execute: true,
        noteOnly: false,
        correctResolutionDisplay: false,
        json: true,
        renderLogReceipt: false
      })
    ]);

    const compensated = first.compensatedCount === 1 ? first : second;
    const skipped = first.compensatedCount === 1 ? second : first;
    const expectedCompensation = parseFloat(compensated.results[0]?.amount ?? "0");

    expect(first.dryRun).toBe(false);
    expect(second.dryRun).toBe(false);
    expect(compensated.compensatedCount).toBe(1);
    expect(compensated.skippedAlreadyCompensatedCount).toBe(0);
    expect(skipped.compensatedCount).toBe(0);
    expect(skipped.skippedAlreadyCompensatedCount).toBe(1);
    expect(skipped.results[0]?.skipped).toBe(true);
    expect(compensated.results[0]?.ledgerTransactionId).toMatch(/^ledger_tx_/);

    const userCashAfter = parseFloat(await readBalance(pool, ids.userCashAccountId));
    expect(userCashAfter).toBeCloseTo(userCashBefore + expectedCompensation, 4);

    const ledgerCount = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from ledger_transactions
        where reference_type = 'market_incident_compensation'
          and reference_id = $1
      `,
      [`market_incident_compensation:${ids.marketId}:${lossRealizationEventId}`]
    );
    expect(ledgerCount.rows[0]?.count).toBe("1");
  });
});
