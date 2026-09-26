import { describe, expect, it } from "vitest";

import { runProductionIntegrityChecks } from "../../src/ops/production-integrity-checks";

function createDb(countByCheck: Record<string, number>) {
  return {
    query: async (sql: string) => {
      const normalized = sql.replace(/\s+/g, " ");
      const check = normalized.match(/check:([a-z_]+)/)?.[1];
      if (check) {
        return { rows: [{ count: countByCheck[check] ?? 0 }] };
      }
      if (normalized.includes("balance_cached < 0")) return { rows: [{ count: 0 }] };
      if (normalized.includes("from positions where")) return { rows: [{ count: 0 }] };
      if (normalized.includes("from contract_positions where")) return { rows: [{ count: 0 }] };
      if (normalized.includes("from market_outcome_state where")) return { rows: [{ count: 0 }] };
      if (normalized.includes("having sum(last_price)")) return { rows: [{ count: 0 }] };
      if (normalized.includes("status = 'open'")) return { rows: [{ count: 0 }] };
      if (normalized.includes("market_resolutions")) return { rows: [{ count: 0 }] };
      if (normalized.includes("settlement_status")) return { rows: [{ count: 0 }] };
      if (normalized.includes("oracle_cases")) return { rows: [{ count: 0 }] };
      throw new Error(`Unexpected integrity SQL: ${sql}`);
    }
  };
}

describe("production integrity checks", () => {
  it("returns ok when hard and watch checks are empty", async () => {
    const report = await runProductionIntegrityChecks(createDb({}));

    expect(report.verdict).toBe("ok");
    expect(report.checks.every((check) => check.count === 0)).toBe(true);
  });

  it("returns bad for hard money drift", async () => {
    const db = {
      query: async (sql: string) => ({
        rows: [{ count: sql.includes("balance_cached < 0") ? 1 : 0 }]
      })
    };

    const report = await runProductionIntegrityChecks(db);

    expect(report.verdict).toBe("bad");
    expect(report.checks).toContainEqual({
      name: "negative_account_balances",
      severity: "bad",
      count: 1
    });
  });

  it("returns bad when required system economy accounts are missing or inactive", async () => {
    const report = await runProductionIntegrityChecks(createDb({
      economy_system_accounts_missing_or_inactive: 1
    }));

    expect(report.verdict).toBe("bad");
    expect(report.checks).toContainEqual({
      name: "economy_system_accounts_missing_or_inactive",
      severity: "bad",
      count: 1
    });
  });

  it("returns bad when faucet tables are missing after migrations", async () => {
    const report = await runProductionIntegrityChecks(createDb({
      economy_faucet_tables_missing: 1
    }));

    expect(report.verdict).toBe("bad");
    expect(report.checks).toContainEqual({
      name: "economy_faucet_tables_missing",
      severity: "bad",
      count: 1
    });
  });

  it("returns bad for unbalanced ledger transactions", async () => {
    const report = await runProductionIntegrityChecks(createDb({
      ledger_unbalanced_transactions: 1
    }));

    expect(report.verdict).toBe("bad");
    expect(report.checks).toContainEqual({
      name: "ledger_unbalanced_transactions",
      severity: "bad",
      count: 1
    });
  });

  it("returns watch when platform treasury is below the launch runway", async () => {
    const report = await runProductionIntegrityChecks(createDb({
      platform_treasury_below_low_watermark: 1
    }));

    expect(report.verdict).toBe("watch");
    expect(report.checks).toContainEqual({
      name: "platform_treasury_below_low_watermark",
      severity: "watch",
      count: 1
    });
  });

  it("returns watch for cached balance versus ledger drift", async () => {
    const report = await runProductionIntegrityChecks(createDb({
      account_cached_balance_ledger_drift: 3
    }));

    expect(report.verdict).toBe("watch");
    expect(report.checks).toContainEqual({
      name: "account_cached_balance_ledger_drift",
      severity: "watch",
      count: 3
    });
  });

  it("returns watch for closed markets waiting on intentional resolution work", async () => {
    const db = {
      query: async (sql: string) => ({
        rows: [{ count: sql.includes("oracle_cases") ? 2 : 0 }]
      })
    };

    const report = await runProductionIntegrityChecks(db);

    expect(report.verdict).toBe("watch");
    expect(report.checks).toContainEqual({
      name: "closed_markets_without_resolution_case",
      severity: "watch",
      count: 2
    });
  });

  it("counts closed markets without cases immediately instead of waiting for expected resolution time", async () => {
    const seenSql: string[] = [];
    const db = {
      query: async (sql: string) => {
        seenSql.push(sql);
        return { rows: [{ count: 0 }] };
      }
    };

    await runProductionIntegrityChecks(db);

    const checkSql = seenSql.find((sql) => sql.includes("check:closed_markets_without_resolution_case"));
    expect(checkSql).not.toContain("expectedResolutionAt");
    expect(checkSql).not.toContain("expected_resolution_at::timestamptz <= now()");
    expect(checkSql).toContain("m.status = 'closed'");
  });
});
