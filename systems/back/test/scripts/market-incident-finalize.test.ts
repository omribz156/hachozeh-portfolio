import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { runMarketIncidentFinalize } from "../../src/scripts/market-incident-finalize";

function createDryRunPool(): Pool {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("action = 'market_incident_finalized'")) return { rows: [] };
    if (sql.includes("from markets m")) {
      return { rows: [{
        id: "market-1",
        title: "Zverev winner",
        status: "closed",
        settlement_status: null,
        resolved_at: null,
        market_treasury_account_id: "market-treasury",
        market_treasury_balance: "1500.000000",
        resolution_id: null
      }] };
    }
    if (sql.includes("from oracle_cases oc")) {
      return { rows: [{
        id: "case-1",
        market_id: "market-1",
        case_type: "resolution_check",
        case_status: "recommended",
        current_winning_outcome_id: "no",
        evidence_winning_outcome_id: "no"
      }] };
    }
    if (sql.includes("from market_outcomes")) {
      return { rows: [{ id: "yes", label: "כן" }, { id: "no", label: "לא" }] };
    }
    if (sql.includes("from contract_positions")) {
      return { rows: [{
        user_id: "user-1",
        requested_outcome_id: "yes",
        contract_side: "no",
        shares: "2638.031702",
        cost_basis: "1500.000000"
      }] };
    }
    if (sql.includes("select user_id, outcome_id") && sql.includes("from positions")) {
      return { rows: [{
        user_id: "user-1",
        outcome_id: "no",
        shares: "2638.031702",
        cost_basis: "1500.000000"
      }] };
    }
    if (sql.includes("from realization_events")) {
      return { rows: [{
        id: "realization-claimed",
        user_id: "user-1",
        outcome_id: "no",
        type: "resolution_win",
        claim_status: "claimed",
        shares_closed: "69.756702",
        proceeds: "69.756702",
        removed_cost_basis: "35.000000",
        resolution_id: null
      }] };
    }
    if (sql.includes("type = 'platform_treasury'")) return { rows: [{ balance: "100000.000000" }] };
    throw new Error(`unexpected query: ${sql}`);
  });

  return { query } as unknown as Pool;
}

describe("market incident finalize", () => {
  it("dry-runs an approved partial settlement without mutating", async () => {
    const pool = createDryRunPool();
    const report = await runMarketIncidentFinalize(pool, {
      marketId: "market-1",
      oracleCaseId: "case-1",
      winningOutcomeId: "no",
      actorId: "operator",
      summary: "Official result",
      sourceUrl: "https://example.com/official",
      sourceLabel: "Official",
      idempotencyKey: "incident-finalize:market-1",
      execute: false,
      json: true,
      renderLogReceipt: false
    }, new Date("2026-07-13T00:00:00.000Z"));

    expect(report.blockers).toEqual([]);
    expect(report.dryRun).toBe(true);
    expect(report.plan).toMatchObject({
      pendingClaimReserve: "2638.031702",
      treasuryTopUp: "1138.031702"
    });
    expect(pool.query).toHaveBeenCalledTimes(8);
  });

  it("executes the reconciled delta once inside one transaction", async () => {
    const dryRunPool = createDryRunPool();
    const dryRunQuery = dryRunPool.query as ReturnType<typeof vi.fn>;
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback" || sql.startsWith("set local")) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes("action = 'market_incident_finalized'")) return { rows: [] };
      if (sql.includes("select pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("from ledger_transactions") && sql.includes("sequence_number")) return { rows: [] };
      if (sql.includes("from accounts") && sql.includes("where type = $1")) {
        return { rows: [{ id: "platform-treasury", type: "platform_treasury", status: "active", balance_cached: "100000.000000" }] };
      }
      if (sql.includes("from accounts") && sql.includes("where id = $1")) {
        return { rows: [{ id: "market-treasury", type: "market_treasury", status: "active", balance_cached: "1500.000000" }] };
      }
      if (sql.includes("from realization_events re") && sql.includes("join markets m")) return { rows: [] };

      try {
        return await dryRunQuery(sql, params);
      } catch {
        if (sql.includes("update realization_events set resolution_id")) return { rows: [], rowCount: 1 };
        if (sql.includes("delete from positions")) return { rows: [], rowCount: 1 };
        if (sql.includes("update contract_positions set settled_at")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }
    });
    const client = { query: clientQuery, release: vi.fn() };
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => dryRunQuery(sql, params)),
      connect: vi.fn(async () => client)
    } as unknown as Pool;

    const report = await runMarketIncidentFinalize(pool, {
      marketId: "market-1",
      oracleCaseId: "case-1",
      winningOutcomeId: "no",
      actorId: "operator",
      summary: "Official result",
      sourceUrl: "https://example.com/official",
      sourceLabel: "Official",
      idempotencyKey: "incident-finalize:market-1",
      execute: true,
      json: true,
      renderLogReceipt: false
    }, new Date("2026-07-13T00:00:00.000Z"));

    expect(report).toMatchObject({
      dryRun: false,
      blockers: [],
      notificationCount: 0,
      plan: { treasuryTopUp: "1138.031702", pendingClaimReserve: "2638.031702" }
    });
    expect(clientQuery).toHaveBeenCalledWith("commit");
    expect(clientQuery.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("market_treasury_topup"))).toBe(true);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into oracle_case_reviews"))).toBe(true);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("delete from user_notifications"))).toBe(true);
  });

  it("replays the stored receipt without opening another transaction", async () => {
    const stored = {
      objectType: "market_incident_finalize" as const,
      generatedAt: "2026-07-13T00:00:00.000Z",
      dryRun: false,
      replayed: false,
      marketId: "market-1",
      oracleCaseId: "case-1",
      winningOutcomeId: "no",
      summary: "Official result",
      sourceUrl: "https://example.com/official",
      sourceLabel: "Official",
      blockers: [],
      plan: null,
      resolutionId: "resolution-1",
      auditEventId: "audit-1",
      notificationCount: 1
    };
    const pool = {
      query: vi.fn(async () => ({ rows: [{ payload: { receipt: stored } }] })),
      connect: vi.fn()
    } as unknown as Pool;

    const report = await runMarketIncidentFinalize(pool, {
      marketId: "market-1",
      oracleCaseId: "case-1",
      winningOutcomeId: "no",
      actorId: "operator",
      summary: "Official result",
      sourceUrl: "https://example.com/official",
      sourceLabel: "Official",
      idempotencyKey: "incident-finalize:market-1",
      execute: true,
      json: true,
      renderLogReceipt: false
    });

    expect(report.replayed).toBe(true);
    expect(report.resolutionId).toBe("resolution-1");
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
