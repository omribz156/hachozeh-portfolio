import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  buildIncidentCorrectionNotificationTargets,
  runMarketIncidentCompensation
} from "../../src/scripts/market-incident-compensation";

function createDryRunPool(): Pool {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            id: "market-1",
            title: "Market 1",
            status: "resolved",
            settlement_status: "completed",
            winning_outcome_id: "yes",
            winner_label: "כן"
          }
        ]
      };
    }

    if (sql.includes("stale_loss_notifications") && sql.includes("stale_win_notifications")) {
      return {
        rows: [
          {
            loss_notification_count: 1,
            loss_notification_event_count: 1,
            win_notification_count: 1,
            win_notification_event_count: 1
          }
        ]
      };
    }

    if (sql.includes("producer_type = 'market_incident_compensation'")) {
      return { rows: [] };
    }

    if (sql.includes("from realization_events re")) {
      return {
        rows: [
          {
            realization_event_id: "realization-1",
            user_id: "user-1",
            user_label: "User 1",
            user_cash_account_id: "account-1",
            outcome_id: "no",
            outcome_label: "לא",
            shares_closed: "10.000000",
            removed_cost_basis: "6.000000",
            actual_proceeds: "0.000000",
            already_compensated: false
          }
        ]
      };
    }

    throw new Error(`unexpected query: ${sql}`);
  });

  return { query } as unknown as Pool;
}

function createExecutePoolWithLockTracking(): { pool: Pool; clientQuery: ReturnType<typeof vi.fn> } {
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql.includes("select pg_advisory_xact_lock")) {
      return { rows: [] };
    }

    if (sql.includes("from realization_events re")) {
      return {
        rows: [{
          realization_event_id: "realization-1",
          user_id: "user-1",
          user_label: "User 1",
          user_cash_account_id: "account-1",
          outcome_id: "no",
          outcome_label: "לא",
          shares_closed: "10.000000",
          removed_cost_basis: "6.000000",
          actual_proceeds: "0.000000",
          already_compensated: false
        }]
      };
    }

    if (sql.includes("from ledger_transactions") && sql.includes("sequence_number desc")) {
      return { rows: [{ sequence_number: "10", transaction_hash: "tx-hash-10" }]};
    }

    if (sql.includes("from accounts") && sql.includes("where type = $1")) {
      return {
        rows: [{ id: "platform-account", type: "platform_treasury", status: "active", balance_cached: "99990.000000" }]
      };
    }

    if (sql.includes("from accounts") && sql.includes("where id = $1")) {
      return {
        rows: [{ id: "account-1", type: "user_cash", status: "active", balance_cached: "0.000000" }]
      };
    }

    if (sql.includes("stale_loss_notifications") && sql.includes("stale_win_notifications")) {
      return {
        rows: [{
          deleted_loss_notification_count: 0,
          deleted_loss_notification_event_count: 0,
          deleted_win_notification_count: 0,
          deleted_win_notification_event_count: 0
        }]
      };
    }

    if (sql.includes("producer_type = 'market_incident_compensation'")) {
      return { rows: [] };
    }

    if (sql.includes("insert into user_notifications")) {
      return { rows: [{ id: "notif-1", user_id: "user-1" }]};
    }

    if (sql.includes("insert into user_notification_events")) {
      return { rows: [{ id: "event-1" }]};
    }

    if (sql.includes("insert into ledger_transactions")) {
      return { rows: [{ id: "ledger-1" }]};
    }

    if (sql.includes("insert into ledger_entries")) {
      return { rows: [], rowCount: 2 };
    }

    if (sql.includes("insert into lifecycle_events")) {
      return { rows: [{ id: "lifecycle-1" }]};
    }

    if (sql.startsWith("insert into")) {
      return { rows: [{ id: "insert-1" }]};
    }

    if (sql.startsWith("update") || sql.startsWith("delete")) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [] };
  });

  const poolQuery = vi.fn(async (sql: string) => {
    if (sql.includes("from markets m")) {
      return {
        rows: [{
          id: "market-1",
          title: "Market 1",
          status: "resolved",
          settlement_status: "completed",
          winning_outcome_id: "no",
          winner_label: "לא"
        }]
      };
    }

    if (sql.includes("producer_type = 'market_incident_compensation'")) {
      return { rows: [] };
    }

    if (sql.includes("stale_loss_notifications") && sql.includes("stale_win_notifications")) {
      return {
        rows: [{
          deleted_loss_notification_count: 0,
          deleted_loss_notification_event_count: 0,
          deleted_win_notification_count: 0,
          deleted_win_notification_event_count: 0
        }]
      };
    }

    throw new Error(`unexpected query: ${sql}`);
  });

  const client = { query: clientQuery, release: vi.fn() };
  return {
    pool: {
      query: poolQuery,
      connect: vi.fn(async () => client)
    } as unknown as Pool,
    clientQuery
  };
}

describe("market incident compensation", () => {
  it("reports eligible users without marking them compensated during dry-run", async () => {
    const report = await runMarketIncidentCompensation(createDryRunPool(), {
      marketId: "market-1",
      correctWinningOutcomeId: "no",
      actorId: "operator",
      reason: "incident",
      summary: "Correction summary",
      sourceUrl: "https://example.com/source",
      sourceLabel: "Example source",
      idempotencyKey: "incident:market-1:no",
      execute: false,
      noteOnly: false,
      correctResolutionDisplay: false,
      json: true,
      renderLogReceipt: false
    });

    expect(report.dryRun).toBe(true);
    expect(report.candidateCount).toBe(1);
    expect(report.eligibleCompensationCount).toBe(1);
    expect(report.compensatedCount).toBe(0);
    expect(report.totalCompensation).toBe("10.000000");
    expect(report.clearedLossNotificationCount).toBe(1);
    expect(report.clearedWinNotificationCount).toBe(1);
    expect(report.correctionNotificationTargetCount).toBe(1);
    expect(report.correctionNotificationExistingCount).toBe(0);
    expect(report.correctionNotificationInsertedCount).toBe(0);
    expect(report.results[0]).toMatchObject({
      userId: "user-1",
      amount: "10.000000",
      skipped: false,
      ledgerTransactionId: null
    });
  });

  it("locks execute mode by market before reading candidates and transferring", async () => {
    const { pool, clientQuery } = createExecutePoolWithLockTracking();
    const report = await runMarketIncidentCompensation(pool, {
      marketId: "market-1",
      correctWinningOutcomeId: "no",
      actorId: "operator",
      reason: "incident",
      summary: "Correction summary",
      sourceUrl: "https://example.com/source",
      sourceLabel: "Example source",
      idempotencyKey: "incident:market-1:no:execute",
      execute: true,
      noteOnly: false,
      correctResolutionDisplay: false,
      json: true,
      renderLogReceipt: false
    });

    const calls = clientQuery.mock.calls.map((entry) => String(entry[0]));
    const lockIndex = calls.findIndex((sql) => sql.includes("hashtext('market_incident_compensation')"));
    const candidateIndex = calls.findIndex((sql) => sql.includes("from realization_events re"));
    const transferIndex = calls.findIndex((sql) => sql.includes("insert into ledger_transactions"));

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(candidateIndex).toBeGreaterThan(lockIndex);
    expect(transferIndex).toBeGreaterThan(candidateIndex);

    expect(report.dryRun).toBe(false);
    expect(report.compensatedCount).toBe(1);
    expect(report.results[0]).toMatchObject({
      userId: "user-1",
      amount: "10.000000",
      skipped: false,
      ledgerTransactionId: expect.stringMatching(/^ledger_tx_/)
    });
  });

  it("aggregates one correction notification per affected user", () => {
    expect(buildIncidentCorrectionNotificationTargets([
      {
        userId: "user-1",
        userLabel: "User 1",
        realizationEventId: "realization-1",
        outcomeId: "yes",
        outcomeLabel: "כן",
        amount: "10.250000",
        skipped: false,
        ledgerTransactionId: "ledger-1"
      },
      {
        userId: "user-1",
        userLabel: "User 1",
        realizationEventId: "realization-2",
        outcomeId: "yes",
        outcomeLabel: "כן",
        amount: "2.750000",
        skipped: true,
        ledgerTransactionId: null
      }
    ])).toEqual([
      {
        userId: "user-1",
        amount: "13.000000",
        outcomeLabel: "כן"
      }
    ]);
  });
});
