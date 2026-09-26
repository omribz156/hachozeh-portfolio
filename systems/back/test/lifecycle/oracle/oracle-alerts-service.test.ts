import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../src/db/client/pool";
import { readOracleAlerts } from "../../../../oracle/src/oracle-alerts-service";

function createDb() {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from markets") && sql.includes("status = any")) {
        return {
          rows: [
            {
              id: "market_open_gap",
              title: "Open market with fetch gap",
              status: "open",
              close_at: new Date("2026-04-13T20:00:00.000Z"),
              oracle_source_policy: {
                closeConditionSourceIds: ["src_knesset_feed"],
                notes: [
                  "ground-role=Knesset agenda",
                  "fetch-needed=official-vote-result"
                ]
              }
            },
            {
              id: "market_closed_missing_case",
              title: "Closed market missing resolution case",
              status: "closed",
              close_at: new Date("2026-04-13T06:00:00.000Z"),
              oracle_source_policy: {
                resolutionSourceIds: ["src_boi_announcements"],
                notes: ["fetch-needed=official-rate-decision-pdf"]
              }
            },
            {
              id: "market_closed_stale_review",
              title: "Closed market with stale review",
              status: "closed",
              close_at: new Date("2026-04-13T05:00:00.000Z"),
              oracle_source_policy: {
                resolutionSourceIds: ["src_gov_il_news"],
                notes: ["resolve-role=Official certification"]
              }
            }
          ],
          rowCount: 3
        };
      }

      if (sql.includes("where id = $1")) {
        if (values?.[0] === "market_open_gap") {
          return {
            rows: [
              {
                id: "market_open_gap",
                title: "Open market with fetch gap",
                status: "open",
                resolution_source: "Official result",
                resolution_rules: "Official publication wins.",
                oracle_source_policy: {
                  closeConditionSourceIds: ["src_knesset_feed"],
                  notes: [
                    "ground-role=Knesset agenda",
                    "fetch-needed=official-vote-result"
                  ]
                }
              }
            ],
            rowCount: 1
          };
        }

        if (values?.[0] === "market_closed_missing_case") {
          return {
            rows: [
              {
                id: "market_closed_missing_case",
                title: "Closed market missing resolution case",
                status: "closed",
                resolution_source: "Official result",
                resolution_rules: "Official publication wins.",
                oracle_source_policy: {
                  resolutionSourceIds: ["src_boi_announcements"],
                  notes: ["fetch-needed=official-rate-decision-pdf"]
                }
              }
            ],
            rowCount: 1
          };
        }

        return {
          rows: [
            {
              id: "market_closed_stale_review",
              title: "Closed market with stale review",
              status: "closed",
              resolution_source: "Official result",
              resolution_rules: "Official publication wins.",
              oracle_source_policy: {
                resolutionSourceIds: ["src_gov_il_news"],
                notes: ["resolve-role=Official certification"]
              }
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from oracle_evidence_packets")) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      if (sql.includes("distinct on (oc.market_id, oc.case_type)")) {
        return {
          rows: [
            {
              oracle_case_id: "orc_stale_review_1",
              market_id: "market_closed_stale_review",
              case_type: "resolution_check",
              case_status: "review_needed",
              market_status: "closed",
              scheduled_close_at: new Date("2026-04-13T05:00:00.000Z"),
              created_at: new Date("2026-04-13T05:10:00.000Z"),
              updated_at: new Date("2026-04-13T00:00:00.000Z"),
              source_policy_snapshot: {
                resolutionSourceIds: ["src_gov_il_news"],
                notes: ["resolve-role=Official certification"]
              }
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("insert into oracle_runtime_snapshots")) {
        return {
          rows: [],
          rowCount: 1
        };
      }

      if (sql.includes("from oracle_runtime_snapshots")) {
        return {
          rows: [
            {
              id: "orsnap_alerts_latest",
              runtime_type: "alerts",
              market_status_filter: "all",
              generated_at: new Date("2026-04-13T10:00:00.000Z"),
              summary_snapshot: {
                totalAlerts: 5,
                checkedMarketCount: 3
              }
            },
            {
              id: "orsnap_heartbeat_prev",
              runtime_type: "heartbeat",
              market_status_filter: "all",
              generated_at: new Date("2026-04-13T09:00:00.000Z"),
              summary_snapshot: {
                checkedMarketCount: 3,
                candidateEvidenceCount: 1
              }
            }
          ],
          rowCount: 2
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  } satisfies Queryable;
}

describe("oracle alerts service", () => {
  it("surfaces scheduler pressure from fetch gaps and stale review trails", async () => {
    const db = createDb();

    const result = await readOracleAlerts(db, {
      evaluatedAt: "2026-04-13T10:00:00.000Z",
      persistSnapshot: true
    });

    expect(result).toMatchObject({
      objectType: "oracle_alerts_result",
      marketStatusFilter: "all",
      runtimeSnapshotId: expect.stringMatching(/^orsnap_/),
      heartbeatSummary: {
        eligibleMarketCount: 3,
        checkedMarketCount: 3,
        failedSourceRunCount: 0
      },
      recentRuntimeSnapshots: [
        expect.objectContaining({
          snapshotId: "orsnap_alerts_latest",
          runtimeType: "alerts"
        }),
        expect.objectContaining({
          snapshotId: "orsnap_heartbeat_prev",
          runtimeType: "heartbeat"
        })
      ]
    });
    expect(result.alertCounts.total).toBeGreaterThanOrEqual(4);
    expect(result.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          marketId: "market_open_gap",
          alertType: "fetch-gap-pressure"
        }),
        expect.objectContaining({
          marketId: "market_closed_missing_case",
          alertType: "missing-resolve-plan"
        }),
        expect.objectContaining({
          marketId: "market_closed_missing_case",
          alertType: "missing-resolution-case"
        }),
        expect.objectContaining({
          marketId: "market_closed_stale_review",
          alertType: "stale-review-case",
          oracleCaseId: "orc_stale_review_1"
        })
      ])
    );
    expect(result.recommendations).toContain(
      "Some review-needed Oracle cases are stale. Human eyes now, not tomorrow cosplay."
    );
    expect(result.recommendations).toContain(
      "Some closed markets still have no Oracle resolution case. Heartbeat alone is not enough; open the review trail."
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into oracle_runtime_snapshots"),
      expect.arrayContaining([
        expect.stringMatching(/^orsnap_/),
        "alerts",
        "all"
      ])
    );
  });
});
