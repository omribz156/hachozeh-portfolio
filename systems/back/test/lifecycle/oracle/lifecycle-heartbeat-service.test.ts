import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { runOracleLifecycleHeartbeat } from "../../../../oracle/src/lifecycle-heartbeat-service";
import type { OracleLifecycleRunResult } from "../../../../oracle/src/lifecycle-run-service";

function buildLifecycleRun(overrides?: Partial<OracleLifecycleRunResult>): OracleLifecycleRunResult {
  return {
    objectType: "oracle_lifecycle_run",
    runId: "olr_test",
    startedAt: "2026-05-10T10:00:00.000Z",
    completedAt: "2026-05-10T10:00:01.000Z",
    status: "completed_clean",
    dryRun: true,
    mutationMode: "report_only",
    marketId: null,
    nextRecommendedRunAt: "2026-05-10T10:05:00.000Z",
    phases: {
      preflight: { objectType: "oracle_lifecycle_preflight_phase" },
      closeDueMarkets: {
        objectType: "horizon_close_sweep_result",
        evaluatedAt: "2026-05-10T10:00:00.000Z",
        dryRun: true,
        limit: 20,
        candidates: [],
        checks: [],
        executions: [],
        alerts: []
      },
      capability: {
        objectType: "oracle_lifecycle_capability_phase",
        checkedMarketCount: 0,
        supportedCount: 0,
        unsupportedCount: 0,
        incompleteCount: 0,
        manualResolutionRequiredCount: 0,
        blockedByContractCount: 0,
        items: []
      },
      closeCondition: {
        objectType: "oracle_lifecycle_close_condition_phase",
        checkedMarketCount: 0,
        satisfiedCount: 0,
        createdCaseCount: 0,
        dryRun: true,
        items: []
      },
      closeProvenance: {
        objectType: "oracle_close_provenance_phase",
        checkedMarketCount: 0,
        confirmedCount: 0,
        missingCount: 0,
        invalidCount: 0,
        items: []
      },
      evidenceIntake: {
        objectType: "oracle_lifecycle_evidence_intake_phase",
        eligibleMarketCount: 0,
        skippedForMissingProvenanceCount: 0,
        dryRun: true,
        results: []
      },
      eventUpdates: {
        objectType: "source_lag_event_update_result",
        generatedAt: "2026-05-10T10:00:00.000Z",
        upsertedCount: 0,
        skippedCount: 0,
        items: []
      },
      inbox: {
        objectType: "oracle_resolve_inbox",
        generatedAt: "2026-05-10T10:00:00.000Z",
        marketId: null,
        missingCaseCount: 0,
        recommendedCaseCount: 0,
        missingCases: [],
        recommendedCases: []
      }
    },
    actions: [
      {
        actionId: "act_repeat",
        actionType: "run_lifecycle_again",
        riskLevel: "safe_repeatable",
        safeToAutoExecute: true,
        requiresExplicitApproval: false,
        reason: "Repeat.",
        command: "npm --prefix systems/back run oracle -- lifecycle-run --json"
      }
    ],
    blockers: [],
    warnings: [],
    receipts: [],
    ...overrides
  };
}

describe("oracle lifecycle heartbeat service", () => {
  it("runs bounded lifecycle ticks and summarizes unsafe approval actions without executing them", async () => {
    const runLifecycleRun = vi
      .fn()
      .mockResolvedValueOnce(
        buildLifecycleRun({
          runId: "olr_one",
          status: "completed_with_actions",
          actions: [
            {
              actionId: "act_case",
              actionType: "approve_resolution_case",
              riskLevel: "approval_required",
              safeToAutoExecute: false,
              requiresExplicitApproval: true,
              marketId: "disc-cm-proof",
              oracleCaseId: "orc_123",
              reason: "Approval required.",
              command: "npm --prefix systems/back run oracle -- approve-resolution-case --case orc_123 --json"
            }
          ]
        })
      )
      .mockResolvedValueOnce(buildLifecycleRun({ runId: "olr_two" }));

    const result = await runOracleLifecycleHeartbeat({} as Pool, {
      maxTicks: 2,
      intervalMs: 0,
      dryRun: true,
      now: new Date("2026-05-10T10:00:00.000Z"),
      runLifecycleRun
    });

    expect(runLifecycleRun).toHaveBeenCalledTimes(2);
    expect(runLifecycleRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        dryRun: true,
        now: new Date("2026-05-10T10:00:00.000Z")
      })
    );
    expect(result).toMatchObject({
      objectType: "oracle_lifecycle_heartbeat",
      completedTickCount: 2,
      unsafeActionCount: 1,
      safeAutoActionCount: 0,
      ticks: [
        {
          tickNumber: 1,
          lifecycleRunId: "olr_one",
          status: "completed_with_actions",
          unsafeActionCount: 1
        },
        {
          tickNumber: 2,
          lifecycleRunId: "olr_two",
          status: "completed_clean",
          unsafeActionCount: 0
        }
      ]
    });
  });

  it("emits a per-tick event so long heartbeats can stream JSONL receipts", async () => {
    const runLifecycleRun = vi
      .fn()
      .mockResolvedValueOnce(buildLifecycleRun({ runId: "olr_stream_one" }))
      .mockResolvedValueOnce(
        buildLifecycleRun({
          runId: "olr_stream_two",
          status: "completed_with_warnings",
          warnings: [
            {
              warningId: "wrn_test",
              warningCode: "final_source_not_ready",
              marketId: "disc-cm-proof",
              reason: "Synthetic warning."
            }
          ]
        })
      );
    const onTick = vi.fn();

    const result = await runOracleLifecycleHeartbeat({} as Pool, {
      maxTicks: 2,
      intervalMs: 0,
      dryRun: false,
      runLifecycleRun,
      onTick
    });

    expect(result.completedTickCount).toBe(2);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        objectType: "oracle_lifecycle_heartbeat_tick_event",
        tick: expect.objectContaining({
          tickNumber: 1,
          lifecycleRunId: "olr_stream_one"
        }),
        lifecycleRun: expect.objectContaining({
          runId: "olr_stream_one"
        })
      })
    );
    expect(onTick).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tick: expect.objectContaining({
          tickNumber: 2,
          lifecycleRunId: "olr_stream_two",
          warningCount: 1
        })
      })
    );
  });

  it("persists lifecycle heartbeat tick snapshots for worker health visibility", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [] };
      })
    } as unknown as Pool;
    const runLifecycleRun = vi.fn().mockResolvedValueOnce(
      buildLifecycleRun({
        runId: "olr_persisted",
        dryRun: false,
        warnings: [
          {
            warningId: "wrn_source_lag",
            warningCode: "final_source_not_ready",
            marketId: "disc-cm-nike-lag",
            reason: "Official source status is not final yet."
          },
          {
            warningId: "wrn_manual_future",
            warningCode: "manual_resolution_parked",
            marketId: "disc-cm-knesset",
            reason: "Manual-resolution market is still open/future."
          }
        ],
        phases: {
          ...buildLifecycleRun().phases,
          closeDueMarkets: {
            ...buildLifecycleRun().phases.closeDueMarkets,
            executions: [
              {
                objectType: "close_execution_result",
                closeExecutionResultId: "cex_test",
                marketId: "disc-cm-btc",
                previousStatus: "open",
                resultingStatus: "closed",
                triggerType: "scheduled_time",
                executed: true,
                auditEventId: "audit_test",
                idempotencyScope: "market-close:disc-cm-btc",
                idempotencyKey: "scheduled:disc-cm-btc:2026-05-13T00:00:00.000Z",
                executedAt: "2026-05-13T00:01:00.000Z",
                closedAt: "2026-05-13T00:01:00.000Z"
              }
            ]
          },
          inbox: {
            ...buildLifecycleRun().phases.inbox,
            missingCaseCount: 1
          }
        }
      })
    );

    const result = await runOracleLifecycleHeartbeat(db, {
      maxTicks: 1,
      intervalMs: 0,
      persistSnapshot: true,
      runLifecycleRun
    });

    expect(result.ticks[0]?.runtimeSnapshotId).toMatch(/^orsnap_/);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("insert into oracle_runtime_snapshots"), [
      expect.stringMatching(/^orsnap_/),
      "lifecycle-heartbeat",
      "all",
      "2026-05-10T10:00:01.000Z",
      expect.stringContaining("\"closeExecutionCount\":1"),
      expect.stringContaining("\"oracle_lifecycle_heartbeat_tick_snapshot\"")
    ]);
    expect(queries[0]?.params?.[4]).toEqual(expect.stringContaining("\"missingResolutionCaseCount\":1"));
    expect(queries[0]?.params?.[4]).toEqual(expect.stringContaining("\"warningBreakdown\""));
    expect(queries[0]?.params?.[4]).toEqual(expect.stringContaining("\"final_source_not_ready\":1"));
    expect(queries[0]?.params?.[4]).toEqual(expect.stringContaining("\"manual_resolution_parked\":1"));
    expect(queries[0]?.params?.[4]).toEqual(expect.stringContaining("\"disc-cm-nike-lag\""));
  });

  it("can send one-shot operator reminders after live heartbeat ticks", async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "oor_tick" }] })
        .mockResolvedValueOnce({ rows: [] })
    } as unknown as Pool;
    const notifier = {
      channel: "test",
      send: vi.fn(async () => undefined)
    };
    const runLifecycleRun = vi.fn().mockResolvedValueOnce(
      buildLifecycleRun({
        dryRun: false,
        phases: {
          ...buildLifecycleRun().phases,
          inbox: {
            objectType: "oracle_resolve_inbox",
            generatedAt: "2026-05-10T10:00:00.000Z",
            marketId: null,
            missingCaseCount: 1,
            recommendedCaseCount: 0,
            missingCases: [
              {
                itemType: "missing_case",
                marketId: "disc-cm-closed",
                marketTitle: "Closed proof market",
                marketStatus: "closed",
                closeAt: null,
                closedAt: "2026-05-10T09:00:00.000Z",
                ageHours: 1,
                resolutionSource: null,
                resolutionRules: null,
                fallbackResolutionAllowed: false,
                fallbackEvidenceStandard: null,
                primarySourceUrl: null,
                nextAction: "create_resolution_case",
                suggestedCommand: "inspect"
              }
            ],
            recommendedCases: []
          }
        }
      })
    );

    const result = await runOracleLifecycleHeartbeat(db, {
      maxTicks: 1,
      intervalMs: 0,
      dryRun: false,
      operatorRemindersEnabled: true,
      operatorReminderNotifier: notifier,
      runLifecycleRun
    });

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(result.operatorReminderSentCount).toBe(1);
    expect(result.ticks[0]).toMatchObject({
      operatorReminderSentCount: 1,
      operatorReminderFailedCount: 0
    });
  });
});
