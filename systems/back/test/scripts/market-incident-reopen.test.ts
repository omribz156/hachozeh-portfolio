import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { runMarketIncidentReopen } from "../../src/scripts/market-incident-reopen";

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
            event_id: "event-1",
            close_at: new Date("2026-07-12T15:00:00.000Z"),
            resolved_at: new Date("2026-07-11T16:00:00.000Z"),
            resolution_id: "resolution-1",
            winning_outcome_id: "no",
            winner_label: "לא",
            resolution_event_count: 1,
            resolution_loss_count: 1,
            resolution_win_count: 0,
            claimed_win_count: 0
          }
        ]
      };
    }

    if (sql.includes("from realization_events") && sql.includes("type = 'resolution_loss'")) {
      return {
        rows: [
          {
            user_id: "user-1",
            market_id: "market-1",
            outcome_id: "yes",
            shares: "10.000000",
            cost_basis: "6.000000",
            realization_ids: ["realization-1"]
          }
        ]
      };
    }

    throw new Error(`unexpected query: ${sql}`);
  });

  return { query } as unknown as Pool;
}

describe("market incident reopen", () => {
  it("dry-runs premature reopen without mutating and reports false-loss restoration", async () => {
    const report = await runMarketIncidentReopen(
      createDryRunPool(),
      {
        marketIds: ["market-1"],
        actorId: "operator",
        reason: "premature resolution",
        summary: "Correction summary",
        sourceUrl: "https://example.com/source",
        sourceLabel: "Example source",
        idempotencyKey: "incident:reopen",
        reopenUntil: null,
        execute: false,
        json: true,
        renderLogReceipt: false
      },
      new Date("2026-07-11T17:00:00.000Z")
    );

    expect(report.dryRun).toBe(true);
    expect(report.markets[0]).toMatchObject({
      targetCloseAt: "2026-07-12T15:00:00.000Z",
      restoredPositionCount: 1,
      deletedLossRealizationCount: 1,
      keptWinRealizationCount: 0,
      deletedResolution: true,
      skipped: false,
      skipReason: null
    });
  });
});
