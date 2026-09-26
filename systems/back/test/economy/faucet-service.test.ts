import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import * as economyLedger from "../../src/economy/economy-ledger";
import {
  claimDailyLoginFaucet,
  FaucetServiceError,
  readWalletFaucets
} from "../../src/economy/faucet-service";
import * as notificationFeed from "../../src/notifications/notification-feed-service";
import * as auditEvents from "../../src/shared/audit-events";
import type { EconomyLedgerTransferResult } from "../../src/economy/economy-ledger";

type StateForDailyLogin = {
  currentStreakDay: number;
  lastClaimedLocalDate: string | null;
};

function createFaucetPool(options: {
  userCreatedLocalDate: string;
  hasActivePosition?: boolean;
  userId?: string;
  accountId?: string;
  reward?: string;
  dailyLoginState?: StateForDailyLogin;
}) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });

      if (
        sql === "begin" ||
        sql === "commit" ||
        sql === "rollback" ||
        sql.startsWith("savepoint") ||
        sql.startsWith("rollback to savepoint") ||
        sql.startsWith("release savepoint") ||
        sql.startsWith("set local statement_timeout") ||
        sql.startsWith("set local lock_timeout")
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("insert into user_faucet_state")) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from user_faucet_state")) {
        return {
          rows: [
            {
              user_id: options.userId ?? "user_new_1",
              faucet_type: values?.[1],
              current_streak_day: options.dailyLoginState?.currentStreakDay ?? 0,
              last_claimed_at: null,
              last_claimed_local_date: options.dailyLoginState?.lastClaimedLocalDate ?? null
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from accounts") && sql.includes("type = 'user_cash'")) {
        return {
          rows: [
            {
              account_id: options.accountId ?? "account_user_cash_1",
              balance_cached: options.reward ?? "1000.000000"
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("insert into faucet_claims")) {
        return {
          rows: [{ id: "faucet_claim_1" }],
          rowCount: 1
        };
      }

      if (sql.includes("from faucet_claims")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("update user_faucet_state")) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("select exists") && sql.includes("from positions")) {
        return { rows: [{ has_active_position: options.hasActivePosition ?? false }], rowCount: 1 };
      }

      if (sql.includes("from users") && sql.includes("created_at at time zone")) {
        return {
          rows: [{ created_local_date: options.userCreatedLocalDate }],
          rowCount: 1
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }),
    release: vi.fn()
  };

  return {
    pool: {
      connect: vi.fn(async () => client)
    } as unknown as Pool,
    client,
    queries
  };
}

describe("faucet service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not expose a daily login claim on the signup local day", async () => {
    const { pool } = createFaucetPool({ userCreatedLocalDate: "2026-06-28" });

    const response = await readWalletFaucets(
      pool,
      "user_new_1",
      new Date("2026-06-28T08:31:14.650Z")
    );

    expect(response.faucets.dailyLogin).toMatchObject({
      canClaim: false,
      rewardAmount: null,
      reason: "new_account_same_day"
    });
  });

  it("allows daily login eligibility after the signup local day", async () => {
    const { pool } = createFaucetPool({ userCreatedLocalDate: "2026-06-27" });

    const response = await readWalletFaucets(
      pool,
      "user_new_1",
      new Date("2026-06-28T08:31:14.650Z")
    );

    expect(response.faucets.dailyLogin).toMatchObject({
      canClaim: true,
      rewardAmount: "25.000000",
      reason: "no_active_position_baseline"
    });
  });

  it("rejects direct daily login claims on the signup local day before wallet transfer", async () => {
    const { pool, queries } = createFaucetPool({ userCreatedLocalDate: "2026-06-28" });

    await expect(
      claimDailyLoginFaucet(pool, "user_new_1", new Date("2026-06-28T08:31:14.650Z"))
    ).rejects.toMatchObject({
      code: "daily_login_new_account_same_day",
      statusCode: 409
    } satisfies Partial<FaucetServiceError>);

    expect(queries.some((query) => query.sql.includes("transfer"))).toBe(false);
    expect(queries.some((query) => query.sql.includes("insert into faucet_claims"))).toBe(false);
    expect(queries.some((query) => query.sql === "rollback")).toBe(true);
  });

  it("keeps claim and audit write when day-7 streak notification fails", async () => {
    const { pool } = createFaucetPool({
      userCreatedLocalDate: "2026-06-01",
      userId: "user_streak_7",
      accountId: "account_user_cash_streak_7",
      hasActivePosition: true,
      dailyLoginState: {
        currentStreakDay: 6,
        lastClaimedLocalDate: "2026-06-13"
      }
    });

    const transferResult = {
      ledgerTransactionId: "ledger_tx_streak_7",
      sourceAccountId: "account_platform_treasury",
      targetAccountId: "account_user_cash_streak_7",
      sourceBalanceBefore: "500000.000000",
      sourceBalanceAfter: "499999.975000",
      targetBalanceBefore: "1000.000000",
      targetBalanceAfter: "1000.025000",
      amount: "0.025000"
    } satisfies EconomyLedgerTransferResult;

    vi.spyOn(economyLedger, "transferPlatformTreasuryToUser").mockResolvedValue(transferResult);
    vi.spyOn(notificationFeed, "createStreakMilestoneNotification").mockRejectedValue(
      new Error("notification write failed")
    );
    vi.spyOn(auditEvents, "insertAuditEvent").mockResolvedValue("audit_event_7");

    const response = await claimDailyLoginFaucet(
      pool,
      "user_streak_7",
      new Date("2026-06-14T08:00:00.000Z")
    );

    expect(response.streakDayAwarded).toBe(7);
    expect(response.currentStreakDay).toBe(7);
    expect(response.auditEventId).toBe("audit_event_7");
    expect(response.eligibilityReason).toBe("active_position_streak");
    expect(notificationFeed.createStreakMilestoneNotification).toHaveBeenCalled();
  });
});
