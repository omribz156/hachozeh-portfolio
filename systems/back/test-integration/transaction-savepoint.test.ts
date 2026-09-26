import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { withTransaction } from "../src/db/tx/with-transaction";
import { withSavepoint } from "../src/shared/transaction-savepoint";
import {
  createTestPool,
  seedMinimalBinaryMarket,
  truncateAllTables,
  type SeedIds
} from "./helpers";

let pool: Pool;
let ids: SeedIds;

beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);
  ids = await seedMinimalBinaryMarket(pool, {
    userId: "inttest_savepoint_user",
    userCash: "500.000000",
    marketId: "inttest_savepoint_market",
    liquidityB: "1000.00000000",
    marketTreasuryBalance: "100000.000000",
    platformTreasuryBalance: "500000.000000"
  });
});

afterEach(async () => {
  await pool.end();
});

describe("transaction savepoint integration", () => {
  it("keeps later transaction writes usable after a statement error", async () => {
    const beforeCash = await pool.query<{ balance: string }>(
      "select balance_cached::text as balance from accounts where id = $1",
      [ids.userCashAccountId]
    );
    const before = Number(beforeCash.rows[0]?.balance ?? "0");

    await withTransaction(pool, async (client) => {
      const failureResult = await withSavepoint(client, "inttest_savepoint", async () => {
        await client.query("select 1 / 0");
      });

      expect(failureResult).toMatchObject({ success: false });
      if (!failureResult.success) {
        expect(failureResult.error).toBeInstanceOf(Error);
      }

      const afterFailure = await client.query(
        "update accounts set balance_cached = $1::numeric where id = $2",
        [`${(before + 1).toFixed(6)}`, ids.userCashAccountId]
      );
      expect(afterFailure.rowCount).toBe(1);
    });

    const afterCommit = await pool.query<{ balance: string }>(
      "select balance_cached::text as balance from accounts where id = $1",
      [ids.userCashAccountId]
    );
    expect(afterCommit.rows[0]?.balance).toBe((before + 1).toFixed(6));
  });
});
