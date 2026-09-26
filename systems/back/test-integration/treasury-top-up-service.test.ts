import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../src/auth/actor-resolver";
import {
  topUpPlatformTreasuryForAdmin,
  TreasuryTopUpServiceError
} from "../src/economy/treasury-top-up-service";
import {
  createTestPool,
  readBalance,
  seedMinimalBinaryMarket,
  truncateAllTables,
  type SeedIds
} from "./helpers";

let pool: Pool;
let ids: SeedIds;

const ADMIN_ACTOR: RequestActor = {
  actorId: "admin_inttest_top_up",
  mode: "session",
  sessionId: "session_inttest_top_up",
  role: "admin"
};

beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);
  ids = await seedMinimalBinaryMarket(pool, {
    userId: "inttest_top_up_user",
    marketId: "inttest_top_up_market",
    platformTreasuryBalance: "1000.000000"
  });
});

afterEach(async () => {
  await pool.end();
});

describe("treasury top-up service integration", () => {
  it("tops up platform treasury and replays the same idempotency key", async () => {
    const first = await topUpPlatformTreasuryForAdmin(
      pool,
      {
        amount: "100.000000",
        reason: "integration top up",
        idempotencyKey: "inttest:top-up:1"
      },
      ADMIN_ACTOR
    );

    expect(first.amount).toBe("100.000000");
    expect(first.platformTreasuryBefore).toBe("1000.000000");
    expect(first.platformTreasuryAfter).toBe("1100.000000");
    expect(await readBalance(pool, ids.platformTreasuryAccountId)).toBe("1100.000000");
    expect(await readBalance(pool, ids.mintSourceAccountId)).toBe("-1100.000000");

    const replay = await topUpPlatformTreasuryForAdmin(
      pool,
      {
        amount: "100.000000",
        reason: "integration top up",
        idempotencyKey: "inttest:top-up:1"
      },
      ADMIN_ACTOR
    );

    expect(replay).toEqual(first);
    expect(await readBalance(pool, ids.platformTreasuryAccountId)).toBe("1100.000000");

    const ledgerCount = await pool.query<{ count: string }>(
      "select count(*)::text from ledger_transactions where type = 'treasury_top_up'"
    );
    expect(ledgerCount.rows[0]?.count).toBe("1");
  });

  it("rejects a changed request with the same idempotency key", async () => {
    await topUpPlatformTreasuryForAdmin(
      pool,
      {
        amount: "100.000000",
        reason: "integration top up",
        idempotencyKey: "inttest:top-up:conflict"
      },
      ADMIN_ACTOR
    );

    await expect(
      topUpPlatformTreasuryForAdmin(
        pool,
        {
          amount: "200.000000",
          reason: "integration top up",
          idempotencyKey: "inttest:top-up:conflict"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<TreasuryTopUpServiceError>({
      code: "idempotency_conflict",
      statusCode: 409
    });
  });
});
