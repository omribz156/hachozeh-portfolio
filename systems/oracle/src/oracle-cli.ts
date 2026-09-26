import { createDbPool, loadAppEnv } from "../../back/src/platform-surface/oracle";
import {
  inspectOracleMarket,
  resolveMarketIdFromInput,
  type OracleInspectionRequest
} from "./inspect-market-service";
import {
  readOracleCaseDetail,
  readOracleCaseHistory,
  readOracleReviewQueue
} from "./review-queue-service";
import {
  approveOracleCloseConditionCase,
  approveOracleResolutionCase,
  rejectOracleCase,
  requestMoreEvidenceForOracleCase
} from "./review-action-service";
import {
  approveOracleResolutionCandidate,
  intakeOracleCandidateEvidence
} from "./candidate-intake-service";
import { operatorResolveMarket } from "./operator-resolve-service";
import { recordOperatorObservedEvent } from "./operator-observed-event-service";
import { voidMarket } from "../../back/src/platform-surface/oracle";
import { captureTradingViewFxSnapshot } from "./tradingview-fx-snapshot-service";
import { readOracleAlerts } from "./oracle-alerts-service";
import { runOracleOfficialFinalIntake } from "./official-final-intake-service";
import { readOracleResolveInbox } from "./resolve-inbox-service";
import { runOracleLifecycleRun } from "./lifecycle-run-service";
import { runOracleLifecycleHeartbeat } from "./lifecycle-heartbeat-service";
import {
  acquireOracleLifecycleHeartbeatLock,
  releaseOracleLifecycleHeartbeatLock
} from "./lifecycle-heartbeat-lock";
import { checkOracleSourceCapability } from "./source-capability-service";
import { findSeerSource } from "../../seer/src/source-registry";
import { runFamilyRouteAudit } from "./family-route-audit-service";
import { evaluateCredibleReportingEvidence } from "./credible-reporting-evaluator-service";
import {
  buildSources,
  parseArgs,
  parseOracleCaseHistoryCommandInput,
  parseOracleCapabilityCheckCommandInput,
  parseOracleCredibleReportingEvaluateCommandOptions,
  parseOracleAlertsCommandOptions,
  parseOracleLifecycleHeartbeatCommandOptions,
  parseOracleLifecycleRunCommandOptions,
  parseOracleObservedEventCommandInput,
  parseOracleOperatorResolveCommandExecutionInput,
  parseOracleReviewCaseCommandInput,
  parseOracleReadLimitCommandOptions,
  parseOracleReviewQueueCommandOptions,
  parseOracleTradingViewFxSnapshotCommandOptions,
  parseOracleVoidMarketCommandInput,
  parseList,
  readBooleanFlag,
  readDateFlag,
  requireFlag
} from "./oracle-cli-args";
import { printHelp } from "./oracle-cli-help";

function buildCandidateEvidence(flags: Map<string, string>) {
  const rawFetchReadiness = flags.get("fetch-readiness");
  const fetchReadiness: "live" | "planned" | "unknown" =
    rawFetchReadiness === "live" ||
    rawFetchReadiness === "planned" ||
    rawFetchReadiness === "unknown"
      ? rawFetchReadiness
      : "unknown";

  return {
    candidateEvidenceId:
      flags.get("candidate-evidence-id") ??
      `oce_cli_${Date.now().toString(36)}`,
    signalId: requireFlag(flags, "signal-id"),
    sourceId: requireFlag(flags, "source-id"),
    sourceLabel: requireFlag(flags, "source-label"),
    sourceUrl: requireFlag(flags, "source-url"),
    title: requireFlag(flags, "title"),
    summary: requireFlag(flags, "summary"),
    observedAt: requireFlag(flags, "observed-at"),
    configuredRoles: parseList(flags.get("configured-role")) as Array<
      | "close_condition_preferred"
      | "close_condition_fallback"
      | "resolution_preferred"
      | "resolution_fallback"
    >,
    authorityProfile: flags.get("authority-profile") ?? undefined,
    fetchReadiness,
    normalizationStatus: "candidate_only" as const,
    requiresHumanReview: true as const,
    reviewReasons: parseList(flags.get("review-reason"))
  };
}

async function buildCredibleReportingCandidateEvidence(
  flags: Map<string, string>,
  marketId: string
) {
  const sourceId = requireFlag(flags, "source-id");
  const sourceEntry = await findSeerSource(sourceId);

  if (!sourceEntry) {
    throw new Error(`Unknown credible-reporting source id: ${sourceId}`);
  }

  if (sourceId === "src_credible_reporting_bundle") {
    throw new Error("--source-id must be a real external source, not src_credible_reporting_bundle.");
  }

  if (!sourceEntry.credibleReporting?.allowed || sourceEntry.credibleReporting.tier === "context-only") {
    throw new Error(`Source is not allowed for credible-reporting intake: ${sourceId}`);
  }

  const observedAt = requireFlag(flags, "observed-at");
  const sourceLabel = flags.get("source-label") ?? sourceEntry.label;
  const claimSummary = requireFlag(flags, "claim-summary");

  return {
    candidateEvidenceId:
      flags.get("candidate-evidence-id") ??
      `ocre_cli_${Date.now().toString(36)}`,
    signalId:
      flags.get("signal-id") ??
      `credible-report:${marketId}:${sourceId}:${observedAt}`,
    sourceId,
    sourceLabel,
    sourceUrl: requireFlag(flags, "source-url"),
    independentGroupId: sourceEntry.independentGroupId,
    title: flags.get("title") ?? `Credible report from ${sourceLabel}`,
    summary: claimSummary,
    observedAt,
    configuredRoles: ["resolution_preferred" as const],
    authorityProfile: "credible_reporting",
    fetchReadiness: "unknown" as const,
    normalizationStatus: "candidate_only" as const,
    requiresHumanReview: true as const,
    reviewReasons: [
      "credible-reporting-human-gated",
      ...(sourceEntry.credibleReporting.notes ?? [])
    ]
  };
}

function printResult(result: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

function printJsonLine(result: unknown): void {
  console.log(JSON.stringify(result));
}

async function run(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.helpRequested || !parsed.command) {
    if (parsed.helpText) {
      console.log(parsed.helpText);
      return;
    }

    printHelp();
    return;
  }

  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);

  try {
    if (parsed.command === "review-queue") {
      const result = await readOracleReviewQueue(
        dbPool,
        parseOracleReviewQueueCommandOptions(parsed.flags)
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "resolve-inbox") {
      const result = await readOracleResolveInbox(
        dbPool,
        parseOracleReadLimitCommandOptions(parsed.flags)
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "official-final-intake") {
      const result = await runOracleOfficialFinalIntake(
        dbPool,
        parseOracleReadLimitCommandOptions(parsed.flags)
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "case-history") {
      const input = parseOracleCaseHistoryCommandInput(parsed.flags);
      const result = await readOracleCaseHistory(
        dbPool,
        input.marketId,
        input.options
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "case-detail") {
      const result = await readOracleCaseDetail(
        dbPool,
        requireFlag(parsed.flags, "case")
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "approve-resolution-case") {
      const input = parseOracleReviewCaseCommandInput(parsed.command, parsed.flags);
      const result = await approveOracleResolutionCase(
        dbPool,
        input.oracleCaseId,
        input.actor,
        input.request
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "approve-close-condition-case") {
      const input = parseOracleReviewCaseCommandInput(parsed.command, parsed.flags);
      const result = await approveOracleCloseConditionCase(
        dbPool,
        input.oracleCaseId,
        input.actor,
        input.request
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "reject-case") {
      const input = parseOracleReviewCaseCommandInput(parsed.command, parsed.flags);
      const result = await rejectOracleCase(
        dbPool,
        input.oracleCaseId,
        input.actor,
        input.request
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "request-more-evidence") {
      const input = parseOracleReviewCaseCommandInput(parsed.command, parsed.flags);
      const result = await requestMoreEvidenceForOracleCase(
        dbPool,
        input.oracleCaseId,
        input.actor,
        input.request
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "intake-candidate-evidence") {
      const result = await intakeOracleCandidateEvidence(dbPool, {
        marketId: resolveMarketIdFromInput(requireFlag(parsed.flags, "market")),
        caseType:
          requireFlag(parsed.flags, "case-type") === "close_condition_check"
            ? "close_condition_check"
            : "resolution_check",
        candidateEvidence: buildCandidateEvidence(parsed.flags),
        closeConditionSatisfied: readBooleanFlag(parsed.flags, "close-condition-satisfied"),
        winningOutcomeId: parsed.flags.get("winning-outcome-id") ?? null,
        winningOutcomeKey: parsed.flags.get("winning-outcome-key") ?? null,
        reasonSummary: parsed.flags.get("reason-summary") ?? null,
        summary: parsed.flags.get("summary-override") ?? null,
        reviewType: (parsed.flags.get("review-type") as
          | "conflicting_sources"
          | "insufficient_evidence"
          | "wording_ambiguity"
          | "mapping_ambiguity"
          | undefined) ?? null,
        reviewSummary: parsed.flags.get("review-summary") ?? null,
        reviewNotes: parsed.flags.get("review-notes") ?? null,
        requiresHumanReview: readBooleanFlag(parsed.flags, "requires-human-review"),
        resolvedAtObserved: parsed.flags.get("resolved-at-observed") ?? null,
        persistResult: readBooleanFlag(parsed.flags, "persist")
      });
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "intake-credible-report") {
      const marketId = resolveMarketIdFromInput(requireFlag(parsed.flags, "market"));
      const candidateEvidence = await buildCredibleReportingCandidateEvidence(parsed.flags, marketId);
      const result = await intakeOracleCandidateEvidence(dbPool, {
        marketId,
        caseType: "resolution_check",
        candidateEvidence,
        winningOutcomeKey: requireFlag(parsed.flags, "winning-outcome-key"),
        reasonSummary:
          parsed.flags.get("reason-summary") ??
          `Credible report from ${candidateEvidence.sourceLabel}: ${candidateEvidence.summary}`,
        summary:
          parsed.flags.get("summary-override") ??
          `Oracle imported credible-reporting evidence from ${candidateEvidence.sourceLabel}.`,
        reviewType: "insufficient_evidence",
        reviewSeverity: "low",
        reviewSummary:
          parsed.flags.get("review-summary") ??
          "Single credible-reporting source imported; evaluator must confirm independent-source agreement before recommendation.",
        recommendedNextAction: "wait",
        reviewNotes: [
          parsed.flags.get("review-notes") ?? null,
          `Credible source id: ${candidateEvidence.sourceId}`,
          candidateEvidence.independentGroupId
            ? `Independent group: ${candidateEvidence.independentGroupId}`
            : null
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
        requiresHumanReview: true,
        persistResult: true
      });
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "approve-resolution-candidate") {
      const marketId = resolveMarketIdFromInput(requireFlag(parsed.flags, "market"));
      const result = await approveOracleResolutionCandidate(
        dbPool,
        {
          actorId: parsed.flags.get("actor-id") ?? "oracle_cli_operator",
          mode: "session",
          sessionId: parsed.flags.get("session-id") ?? "oracle_cli_session",
          role: "admin"
        },
        {
          marketId,
          caseType: "resolution_check",
          candidateEvidence: buildCandidateEvidence(parsed.flags),
          winningOutcomeId: parsed.flags.get("winning-outcome-id") ?? null,
          winningOutcomeKey: parsed.flags.get("winning-outcome-key") ?? null,
          reasonSummary: parsed.flags.get("reason-summary") ?? null,
          reviewNote: parsed.flags.get("review-note") ?? null,
          resolvedAtObserved: parsed.flags.get("resolved-at-observed") ?? null,
          approvalIdempotencyKey:
            parsed.flags.get("idempotency-key") ??
            `oracle-approve-candidate:${marketId}:${new Date().toISOString()}`
        }
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "operator-resolve") {
      const input = parseOracleOperatorResolveCommandExecutionInput(parsed.flags);

      const result = await operatorResolveMarket(dbPool, input.actor, input.request);
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "operator-observed-event") {
      const input = parseOracleObservedEventCommandInput(parsed.flags);
      const result = await recordOperatorObservedEvent(
        dbPool,
        input.actor,
        input.request
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "void-market") {
      const input = parseOracleVoidMarketCommandInput(parsed.flags);
      const result = await voidMarket(
        dbPool,
        input.marketId,
        input.request,
        input.actor
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "capture-tradingview-fx-snapshot") {
      const result = await captureTradingViewFxSnapshot(
        dbPool,
        parseOracleTradingViewFxSnapshotCommandOptions(parsed.flags)
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "credible-reporting-evaluate") {
      const result = await evaluateCredibleReportingEvidence(
        dbPool,
        parseOracleCredibleReportingEvaluateCommandOptions(parsed.flags)
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "family-route-audit") {
      const result = await runFamilyRouteAudit({
        sourceId: parsed.flags.get("source-id") ?? null
      });
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "capability-check") {
      const result = checkOracleSourceCapability(
        parseOracleCapabilityCheckCommandInput(parsed.flags)
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "alerts") {
      const result = await readOracleAlerts(
        dbPool,
        parseOracleAlertsCommandOptions(parsed.flags)
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "lifecycle-run") {
      const result = await runOracleLifecycleRun(
        dbPool,
        parseOracleLifecycleRunCommandOptions(parsed.flags)
      );
      printResult(result, parsed.jsonMode);
      return;
    }

    if (parsed.command === "lifecycle-heartbeat") {
      const input = parseOracleLifecycleHeartbeatCommandOptions(parsed.flags);
      const lockClient = input.requireLock === false
        ? null
        : await acquireOracleLifecycleHeartbeatLock(dbPool);

      if (input.requireLock !== false && !lockClient) {
        const event = {
          objectType: "oracle_lifecycle_heartbeat_lock_event",
          status: "lock_not_acquired",
          at: new Date().toISOString()
        };
        if (parsed.jsonlMode) {
          printJsonLine(event);
        } else {
          printResult(event, parsed.jsonMode);
        }
        return;
      }

      try {
        const result = await runOracleLifecycleHeartbeat(dbPool, {
          ...input,
          onTick: parsed.jsonlMode ? printJsonLine : undefined
        });
        if (parsed.jsonlMode) {
          printJsonLine(result);
        } else {
          printResult(result, parsed.jsonMode);
        }
      } finally {
        await releaseOracleLifecycleHeartbeatLock(lockClient);
      }
      return;
    }

    const marketId = resolveMarketIdFromInput(requireFlag(parsed.flags, "market"));
    const caseType =
      parsed.command === "inspect-close-condition"
        ? "close_condition_check"
        : parsed.command === "inspect-resolution"
          ? "resolution_check"
          : requireFlag(parsed.flags, "case-type") === "close_condition_check"
            ? "close_condition_check"
            : "resolution_check";
    const request: OracleInspectionRequest = {
      marketId,
      caseType,
      sources: buildSources(parsed.flags),
      closeConditionSatisfied: readBooleanFlag(parsed.flags, "close-condition-satisfied"),
      winningOutcomeId: parsed.flags.get("winning-outcome-id") ?? null,
      winningOutcomeKey: parsed.flags.get("winning-outcome-key") ?? null,
      evidenceSummary: parsed.flags.get("evidence-summary") ?? null,
      reasonSummary: parsed.flags.get("reason-summary") ?? null,
      summary: parsed.flags.get("summary") ?? null,
      ambiguityLevel: (parsed.flags.get("ambiguity-level") as OracleInspectionRequest["ambiguityLevel"]) ?? null,
      requiresHumanReview: readBooleanFlag(parsed.flags, "requires-human-review") ?? false,
      reviewType: (parsed.flags.get("review-type") as OracleInspectionRequest["reviewType"]) ?? null,
      reviewSeverity:
        (parsed.flags.get("review-severity") as OracleInspectionRequest["reviewSeverity"]) ?? null,
      reviewSummary: parsed.flags.get("review-summary") ?? null,
      reviewNotes: parsed.flags.get("review-notes") ?? null,
      recommendedNextAction:
        (parsed.flags.get("recommended-next-action") as OracleInspectionRequest["recommendedNextAction"]) ?? null,
      resolvedAtObserved: parsed.flags.get("resolved-at-observed") ?? null,
      fallbackResolution: readBooleanFlag(parsed.flags, "fallback-resolution") ?? false,
      fallbackEvidenceStandard: parsed.flags.get("fallback-evidence-standard") ?? null,
      primarySourceUrl: parsed.flags.get("primary-source-url") ?? null,
      primaryFailureReason: parsed.flags.get("primary-failure-reason") ?? null,
      capturedAt: parsed.flags.get("captured-at")
    };
    const persistResult = readBooleanFlag(parsed.flags, "persist") ?? true;
    const result = await inspectOracleMarket(dbPool, request, {
      persistResult
    });
    printResult(result, parsed.jsonMode);
  } finally {
    await dbPool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
