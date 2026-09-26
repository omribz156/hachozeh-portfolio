import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  buildVerificationTierSummary,
  purchaseVerificationTier,
  VerificationTierServiceError,
  type VerificationTier
} from "../../src/auth/user-verification-tier-service";

type Account = {
  id: string;
  type: "user_cash" | "platform_treasury";
  status: "active";
  balance_cached: string;
};

type PurchaseRow = {
  user_id: string;
  tier: VerificationTier;
  price_amount: string;
  ledger_transaction_id: string;
  purchased_at: Date;
};

type TestState = {
  successfulReturns: number;
  accounts: Record<string, Account>;
  purchases: PurchaseRow[];
  ledgerTransactions: Array<{
    id: string;
    sequence_number: number;
    type: string;
    reference_id: string;
  }>;
  ledgerEntries: Array<{
    id: string;
    transaction_id: string;
    account_id: string;
    amount: string;
    entry_role: string;
  }>;
  auditEvents: Array<{
    id: string;
    action: string;
    actor_id: string;
    payload: string;
  }>;
};

function createPurchaseState(overrides: Partial<TestState> = {}): TestState {
  return {
    successfulReturns: 10,
    accounts: {
      account_user_cash_1: {
        id: "account_user_cash_1",
        type: "user_cash",
        status: "active",
        balance_cached: "10000.000000"
      },
      account_platform_treasury_1: {
        id: "account_platform_treasury_1",
        type: "platform_treasury",
        status: "active",
        balance_cached: "750000.000000"
      }
    },
    purchases: [],
    ledgerTransactions: [],
    ledgerEntries: [],
    auditEvents: [],
    ...overrides
  };
}

function createPurchasePool(state: TestState): Pool {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from realization_events")) {
      return {
        rows: [{ successful_return_count: String(state.successfulReturns) }],
        rowCount: 1
      };
    }

    if (sql.includes("from user_verification_tier_purchases")) {
      return {
        rows: state.purchases.map((purchase) => ({
          tier: purchase.tier,
          purchased_at: purchase.purchased_at
        })),
        rowCount: state.purchases.length
      };
    }

    if (sql.includes("where type = 'user_cash'")) {
      return { rows: [state.accounts.account_user_cash_1], rowCount: 1 };
    }

    if (sql.includes("where type = 'platform_treasury'")) {
      return { rows: [state.accounts.account_platform_treasury_1], rowCount: 1 };
    }

    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from ledger_transactions") && sql.includes("order by sequence_number desc")) {
      const latest = state.ledgerTransactions.at(-1);

      return {
        rows: latest
          ? [
              {
                sequence_number: latest.sequence_number,
                transaction_hash: `hash_${latest.sequence_number}`
              }
            ]
          : [],
        rowCount: latest ? 1 : 0
      };
    }

    if (sql.includes("insert into ledger_transactions")) {
      state.ledgerTransactions.push({
        id: values?.[0] as string,
        sequence_number: values?.[1] as number,
        type: "verification_tier_purchase",
        reference_id: values?.[2] as string
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("insert into ledger_entries")) {
      state.ledgerEntries.push({
        id: values?.[0] as string,
        transaction_id: values?.[1] as string,
        account_id: values?.[2] as string,
        amount: values?.[3] as string,
        entry_role: values?.[4] as string
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("update accounts")) {
      const accountId = values?.[0] as string;
      const nextBalance = values?.[1] as string;
      state.accounts[accountId].balance_cached = nextBalance;
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("insert into user_verification_tier_purchases")) {
      state.purchases.push({
        user_id: values?.[0] as string,
        tier: values?.[1] as VerificationTier,
        price_amount: values?.[2] as string,
        ledger_transaction_id: values?.[3] as string,
        purchased_at: new Date("2026-06-13T09:00:00.000Z")
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("insert into audit_events")) {
      state.auditEvents.push({
        id: values?.[0] as string,
        actor_id: values?.[1] as string,
        action: values?.[2] as string,
        payload: values?.[5] as string
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected db query: ${sql}`);
  });

  return {
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool;
}

describe("user verification tier summary", () => {
  it("resets visible progress at each purchased tier", () => {
    expect(buildVerificationTierSummary(7, [])).toMatchObject({
      currentTier: null,
      nextPurchase: {
        tier: "gray",
        progressSuccessfulReturns: 7,
        requiredSuccessfulReturns: 10,
        missingSuccessfulReturns: 3,
        eligible: false
      }
    });

    expect(
      buildVerificationTierSummary(17, [
        { tier: "gray", purchased_at: new Date("2026-06-09T00:00:00Z") }
      ])
    ).toMatchObject({
      currentTier: "gray",
      nextPurchase: {
        tier: "gold",
        progressSuccessfulReturns: 7,
        requiredSuccessfulReturns: 10,
        missingSuccessfulReturns: 3,
        eligible: false
      }
    });

    expect(
      buildVerificationTierSummary(44, [
        { tier: "gray", purchased_at: new Date("2026-06-09T00:00:00Z") },
        { tier: "gold", purchased_at: new Date("2026-06-10T00:00:00Z") }
      ])
    ).toMatchObject({
      currentTier: "gold",
      nextPurchase: {
        tier: "diamond",
        progressSuccessfulReturns: 24,
        requiredSuccessfulReturns: 30,
        missingSuccessfulReturns: 6,
        eligible: false
      }
    });
  });
});

describe("purchaseVerificationTier", () => {
  it("moves cash into treasury, writes ledger records, and records the purchased tier", async () => {
    const state = createPurchaseState();
    const response = await purchaseVerificationTier(
      createPurchasePool(state),
      "user_1",
      { tier: "gray" }
    );

    expect(state.accounts.account_user_cash_1.balance_cached).toBe("5000.000000");
    expect(state.accounts.account_platform_treasury_1.balance_cached).toBe("755000.000000");
    expect(state.ledgerTransactions).toHaveLength(1);
    expect(state.ledgerTransactions[0]).toMatchObject({
      sequence_number: 1,
      type: "verification_tier_purchase",
      reference_id: "user_1:gray"
    });
    expect(state.ledgerEntries).toHaveLength(2);
    expect(state.ledgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account_id: "account_user_cash_1",
          amount: "-5000.000000",
          entry_role: "debit_user_cash"
        }),
        expect.objectContaining({
          account_id: "account_platform_treasury_1",
          amount: "5000.000000",
          entry_role: "credit_platform_treasury"
        })
      ])
    );
    expect(state.purchases).toHaveLength(1);
    expect(state.purchases[0]).toMatchObject({
      user_id: "user_1",
      tier: "gray",
      price_amount: "5000.000000"
    });
    expect(state.auditEvents).toHaveLength(1);
    expect(state.auditEvents[0]).toMatchObject({
      actor_id: "user_1",
      action: "user.verification_tier.purchase"
    });
    expect(response.purchased).toMatchObject({
      tier: "gray",
      price: "5000.000000",
      ledgerTransactionId: state.ledgerTransactions[0]?.id
    });
    expect(response.summary).toMatchObject({
      currentTier: "gray",
      purchasedTiers: ["gray"],
      nextPurchase: {
        tier: "gold",
        eligible: false
      }
    });
  });

  it("rejects insufficient cash without ledger/account/purchase writes", async () => {
    const state = createPurchaseState({
      accounts: {
        account_user_cash_1: {
          id: "account_user_cash_1",
          type: "user_cash",
          status: "active",
          balance_cached: "1000.000000"
        },
        account_platform_treasury_1: {
          id: "account_platform_treasury_1",
          type: "platform_treasury",
          status: "active",
          balance_cached: "750000.000000"
        }
      }
    });

    await expect(
      purchaseVerificationTier(createPurchasePool(state), "user_1", { tier: "gray" })
    ).rejects.toMatchObject({
      code: "insufficient_cash"
    });
    expect(state.accounts.account_user_cash_1.balance_cached).toBe("1000.000000");
    expect(state.accounts.account_platform_treasury_1.balance_cached).toBe("750000.000000");
    expect(state.ledgerTransactions).toHaveLength(0);
    expect(state.ledgerEntries).toHaveLength(0);
    expect(state.purchases).toHaveLength(0);
  });

  it("rejects a tier before it is unlocked", async () => {
    const state = createPurchaseState({ successfulReturns: 9 });

    await expect(
      purchaseVerificationTier(createPurchasePool(state), "user_1", { tier: "gray" })
    ).rejects.toMatchObject({
      code: "tier_not_unlocked"
    });
    expect(state.ledgerTransactions).toHaveLength(0);
    expect(state.purchases).toHaveLength(0);
  });

  it("rejects a valid tier that is not the next upgrade", async () => {
    const state = createPurchaseState({ successfulReturns: 20 });

    await expect(
      purchaseVerificationTier(createPurchasePool(state), "user_1", { tier: "gold" })
    ).rejects.toMatchObject({
      code: "tier_not_next"
    });
    expect(state.ledgerTransactions).toHaveLength(0);
    expect(state.purchases).toHaveLength(0);
  });

  it("does not double-debit when the same tier is requested twice", async () => {
    const state = createPurchaseState();
    const pool = createPurchasePool(state);

    await purchaseVerificationTier(pool, "user_1", { tier: "gray" });
    await expect(purchaseVerificationTier(pool, "user_1", { tier: "gray" })).rejects.toMatchObject({
      code: "tier_not_next"
    });

    expect(state.accounts.account_user_cash_1.balance_cached).toBe("5000.000000");
    expect(state.accounts.account_platform_treasury_1.balance_cached).toBe("755000.000000");
    expect(state.ledgerTransactions).toHaveLength(1);
    expect(state.ledgerEntries).toHaveLength(2);
    expect(state.purchases).toHaveLength(1);
  });

  it("uses typed service errors for purchase failures", async () => {
    await expect(
      purchaseVerificationTier(createPurchasePool(createPurchaseState()), "user_1", {
        tier: "diamond"
      })
    ).rejects.toBeInstanceOf(VerificationTierServiceError);
  });
});
