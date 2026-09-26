import { describe, expect, it, vi } from "vitest";

import {
  buildOracleOperatorReminderCandidates,
  sendOracleOperatorReminders
} from "../../../../oracle/src/operator-reminder-service";
import type { OracleLifecycleRunResult } from "../../../../oracle/src/lifecycle-run-service";

function buildLifecycleRun(
  inbox: OracleLifecycleRunResult["phases"]["inbox"]
): OracleLifecycleRunResult {
  return {
    objectType: "oracle_lifecycle_run",
    runId: "olr_reminder",
    startedAt: "2026-05-30T10:00:00.000Z",
    completedAt: "2026-05-30T10:00:01.000Z",
    status: "completed_with_actions",
    dryRun: false,
    mutationMode: "execute_safe_actions",
    marketId: null,
    nextRecommendedRunAt: "2026-05-30T10:05:00.000Z",
    phases: {
      preflight: { objectType: "oracle_lifecycle_preflight_phase" },
      closeDueMarkets: {
        objectType: "horizon_close_sweep_result",
        evaluatedAt: "2026-05-30T10:00:00.000Z",
        dryRun: false,
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
        dryRun: false,
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
        dryRun: false,
        results: [],
        credibleReportingResults: []
      },
      eventUpdates: {
        objectType: "source_lag_event_update_result",
        generatedAt: "2026-05-30T10:00:00.000Z",
        upsertedCount: 0,
        skippedCount: 0,
        items: []
      },
      inbox
    },
    actions: [],
    blockers: [],
    warnings: [],
    receipts: []
  };
}

describe("oracle operator reminder service", () => {
  it("builds the two operator reminder message types from resolve inbox pressure", () => {
    const lifecycleRun = buildLifecycleRun({
      objectType: "oracle_resolve_inbox",
      generatedAt: "2026-05-30T10:00:00.000Z",
      marketId: null,
      missingCaseCount: 1,
      recommendedCaseCount: 1,
      missingCases: [
        {
          itemType: "missing_case",
          marketId: "disc-cm-weather",
          marketTitle: "Highest temperature in TLV?",
          marketStatus: "closed",
          closeAt: "2026-05-30T18:00:00.000Z",
          closedAt: "2026-05-30T18:01:00.000Z",
          ageHours: 1,
          resolutionSource: null,
          resolutionRules: null,
          fallbackResolutionAllowed: false,
          fallbackEvidenceStandard: null,
          primarySourceUrl: null,
          nextAction: "create_resolution_case",
          suggestedCommand: "npm --prefix systems/back run oracle -- inspect-resolution --market disc-cm-weather"
        }
      ],
      recommendedCases: [
        {
          itemType: "recommended_case",
          marketId: "disc-cm-nba",
          marketTitle: "NBA proof market",
          oracleCaseId: "orc_nba",
          caseStatus: "recommended",
          ambiguityLevel: "low",
          winningOutcomeId: "out_yes",
          winningOutcomeLabel: "Yes",
          evidencePacketId: "ep_nba",
          evidenceSummary: "Official final.",
          sourceCount: 1,
          nextAction: "approve_reject_or_request_more_evidence",
          suggestedApproveCommand: "approve",
          suggestedRejectCommand: "reject",
          suggestedMoreEvidenceCommand: "more"
        }
      ]
    });

    const candidates = buildOracleOperatorReminderCandidates(lifecycleRun);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      reminderKey: "market-closed:disc-cm-weather:2026-05-30T18:01:00.000Z",
      reminderType: "market_closed",
      oracleStatus: "missing_resolution_case",
      suggestedHumanPrompt: "check closed market disc-cm-weather"
    });
    expect(candidates[0]?.messageText).toBe([
      "Hachozeh: market closed",
      "Highest temperature in TLV?",
      "ID: disc-cm-weather",
      "Closed: 30/05/26 21:01 Israel",
      "Next: wait for case"
    ].join("\n"));
    expect(candidates[1]).toMatchObject({
      reminderKey: "market-case-ready:orc_nba",
      reminderType: "resolution_case_ready",
      oracleCaseId: "orc_nba",
      suggestedHumanPrompt: "review resolution case orc_nba"
    });
    expect(candidates[1]?.messageText).toBe([
      "Hachozeh: market case ready",
      "NBA proof market",
      "ID: disc-cm-nba",
      "Case: orc_nba",
      "Outcome: Yes",
      "Evidence: Official final.",
      "",
      "Paste to Codex: review this resolution case"
    ].join("\n"));
    expect(candidates[1]?.messageText.match(/orc_nba/g)).toHaveLength(1);
  });

  it("can hold fresh market-closed reminders during the grace window", () => {
    const lifecycleRun = buildLifecycleRun({
      objectType: "oracle_resolve_inbox",
      generatedAt: "2026-05-30T10:00:00.000Z",
      marketId: null,
      missingCaseCount: 1,
      recommendedCaseCount: 0,
      missingCases: [
        {
          itemType: "missing_case",
          marketId: "disc-cm-fast-weather",
          marketTitle: "Fast weather proof",
          marketStatus: "closed",
          closeAt: "2026-05-30T18:00:00.000Z",
          closedAt: "2026-05-30T18:01:00.000Z",
          ageHours: 0.05,
          resolutionSource: null,
          resolutionRules: null,
          fallbackResolutionAllowed: false,
          fallbackEvidenceStandard: null,
          primarySourceUrl: null,
          nextAction: "create_resolution_case",
          suggestedCommand: "inspect fast"
        }
      ],
      recommendedCases: []
    });

    expect(
      buildOracleOperatorReminderCandidates(lifecycleRun, {
        closedNoticeGraceMinutes: 10
      })
    ).toHaveLength(0);
    expect(
      buildOracleOperatorReminderCandidates(lifecycleRun, {
        closedNoticeGraceMinutes: 1
      })
    ).toHaveLength(1);
  });

  it("keeps scheduled measurements quiet until their expected resolution time", () => {
    const lifecycleRun = buildLifecycleRun({
      objectType: "oracle_resolve_inbox",
      generatedAt: "2026-06-10T21:10:00.000Z",
      marketId: null,
      missingCaseCount: 1,
      recommendedCaseCount: 0,
      missingCases: [
        {
          itemType: "missing_case",
          marketId: "disc-cm-weather",
          marketTitle: "Weather proof",
          marketStatus: "closed",
          closeAt: "2026-06-10T20:59:00.000Z",
          closedAt: "2026-06-10T20:59:14.000Z",
          ageHours: 0.18,
          resolutionSource: null,
          resolutionRules: null,
          fallbackResolutionAllowed: false,
          fallbackEvidenceStandard: null,
          primarySourceUrl: null,
          lifecycleFit: "scheduled_measurement",
          expectedResolutionAt: "2026-06-11T06:00:00.000Z",
          nextAction: "create_resolution_case",
          suggestedCommand: "inspect weather"
        }
      ],
      recommendedCases: []
    });

    expect(
      buildOracleOperatorReminderCandidates(lifecycleRun, {
        closedNoticeGraceMinutes: 10,
        now: new Date("2026-06-10T21:10:00.000Z")
      })
    ).toHaveLength(0);
    expect(
      buildOracleOperatorReminderCandidates(lifecycleRun, {
        closedNoticeGraceMinutes: 10,
        now: new Date("2026-06-11T06:01:00.000Z")
      })
    ).toHaveLength(1);
  });

  it("keeps event-full-cycle close notices aware of expected result time", () => {
    const lifecycleRun = buildLifecycleRun({
      objectType: "oracle_resolve_inbox",
      generatedAt: "2026-06-23T18:00:00.000Z",
      marketId: null,
      missingCaseCount: 1,
      recommendedCaseCount: 0,
      missingCases: [
        {
          itemType: "missing_case",
          marketId: "disc-cm-winner-league",
          marketTitle: "הפועל תל אביב נגד מכבי תל אביב",
          marketStatus: "closed",
          closeAt: "2026-06-23T17:50:00.000Z",
          closedAt: "2026-06-23T17:50:29.000Z",
          ageHours: 0.2,
          resolutionSource: null,
          resolutionRules: null,
          fallbackResolutionAllowed: false,
          fallbackEvidenceStandard: null,
          primarySourceUrl: null,
          lifecycleFit: "event_full_cycle",
          expectedResolutionAt: "2026-06-23T20:30:00.000Z",
          nextAction: "create_resolution_case",
          suggestedCommand: "inspect sports"
        }
      ],
      recommendedCases: []
    });

    const candidates = buildOracleOperatorReminderCandidates(lifecycleRun, {
      closedNoticeGraceMinutes: 10,
      now: new Date("2026-06-23T18:02:00.000Z")
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.messageText).toBe([
      "Hachozeh: market closed",
      "הפועל תל אביב נגד מכבי תל אביב",
      "ID: disc-cm-winner-league",
      "Closed: 23/06/26 20:50 Israel",
      "Result: expected 23/06/26 23:30 Israel"
    ].join("\n"));
  });

  it("sends only reminders that were not already claimed", async () => {
    const lifecycleRun = buildLifecycleRun({
      objectType: "oracle_resolve_inbox",
      generatedAt: "2026-05-30T10:00:00.000Z",
      marketId: null,
      missingCaseCount: 2,
      recommendedCaseCount: 0,
      missingCases: [
        {
          itemType: "missing_case",
          marketId: "disc-cm-one",
          marketTitle: "One",
          marketStatus: "closed",
          closeAt: null,
          closedAt: "2026-05-30T18:01:00.000Z",
          ageHours: 1,
          resolutionSource: null,
          resolutionRules: null,
          fallbackResolutionAllowed: false,
          fallbackEvidenceStandard: null,
          primarySourceUrl: null,
          nextAction: "create_resolution_case",
          suggestedCommand: "inspect one"
        },
        {
          itemType: "missing_case",
          marketId: "disc-cm-two",
          marketTitle: "Two",
          marketStatus: "closed",
          closeAt: null,
          closedAt: "2026-05-30T18:02:00.000Z",
          ageHours: 1,
          resolutionSource: null,
          resolutionRules: null,
          fallbackResolutionAllowed: false,
          fallbackEvidenceStandard: null,
          primarySourceUrl: null,
          nextAction: "create_resolution_case",
          suggestedCommand: "inspect two"
        }
      ],
      recommendedCases: []
    });
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: "oor_one" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
    };
    const notifier = {
      channel: "test",
      send: vi.fn(async () => undefined)
    };

    const result = await sendOracleOperatorReminders(db, {
      lifecycleRun,
      notifier,
      generatedAt: "2026-05-30T10:00:01.000Z"
    });

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      enabled: true,
      candidateCount: 2,
      sentCount: 1,
      skippedExistingCount: 1,
      failedCount: 0
    });
  });
});
