import { randomUUID } from "node:crypto";

import type {
  EarlyCloseRecommendation,
  EvidencePacket,
  OracleAmbiguityLevel,
  OracleCase,
  OracleEvidenceSource,
  OracleFallbackResolutionPolicy,
  OracleInspectionResult,
  OracleReviewSignal,
  ResolutionRecommendation
} from "./contracts";
import { OracleInspectionError } from "./inspect-market-errors";
import type { OracleMarketContext } from "./inspect-market-read-model";
import type { OracleInspectionRequest } from "./inspect-market-types";

function readIsoTimestamp(value?: string | null): string {
  const timestamp = value ?? new Date().toISOString();
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    throw new OracleInspectionError(`Invalid ISO timestamp: ${timestamp}`);
  }

  return parsed.toISOString();
}

function readTrimmed(value: string | null | undefined, fieldName: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new OracleInspectionError(`${fieldName} is required.`);
  }

  return trimmed;
}

function buildEvidenceSources(
  request: OracleInspectionRequest,
  capturedAt: string
): OracleEvidenceSource[] {
  if (request.sources.length === 0) {
    throw new OracleInspectionError("At least one evidence source is required.");
  }

  return request.sources.map((source) => ({
    sourceId: source.sourceId?.trim() || undefined,
    sourceUrl: readTrimmed(source.sourceUrl, "sourceUrl"),
    sourceLabel: readTrimmed(source.sourceLabel, "sourceLabel"),
    sourceType: readTrimmed(source.sourceType, "sourceType"),
    independentGroupId: source.independentGroupId?.trim() || undefined,
    claimSummary: readTrimmed(source.claimSummary, "claimSummary"),
    capturedAt: readIsoTimestamp(source.capturedAt ?? capturedAt)
  }));
}

function resolveWinningOutcome(
  market: OracleMarketContext,
  request: OracleInspectionRequest
): OracleMarketContext["outcomes"][number] | null {
  if (request.winningOutcomeId) {
    const byId = market.outcomes.find((outcome) => outcome.outcomeId === request.winningOutcomeId);

    if (!byId) {
      throw new OracleInspectionError(`Winning outcome does not belong to market: ${request.winningOutcomeId}`);
    }

    return byId;
  }

  if (request.winningOutcomeKey) {
    const byKey = market.outcomes.find((outcome) => outcome.outcomeKey === request.winningOutcomeKey);

    if (!byKey) {
      throw new OracleInspectionError(`Winning outcome key does not belong to market: ${request.winningOutcomeKey}`);
    }

    return byKey;
  }

  const existingWinner = market.outcomes.find((outcome) => outcome.isWinner === true);
  return existingWinner ?? null;
}

function deriveSummary(input: {
  request: OracleInspectionRequest;
  market: OracleMarketContext;
  winner: OracleMarketContext["outcomes"][number] | null;
}): string {
  if (input.request.summary?.trim()) {
    return input.request.summary.trim();
  }

  if (input.request.caseType === "close_condition_check") {
    return input.request.closeConditionSatisfied
      ? `Oracle inspected "${input.market.title}" and found the close condition satisfied.`
      : `Oracle inspected "${input.market.title}" and did not confirm the close condition yet.`;
  }

  if (input.winner) {
    return `Oracle inspected "${input.market.title}" and mapped winner truth to "${input.winner.label}".`;
  }

  return `Oracle inspected "${input.market.title}" but could not map a winner confidently yet.`;
}

function deriveEvidenceSummary(input: {
  request: OracleInspectionRequest;
  winner: OracleMarketContext["outcomes"][number] | null;
}): string {
  if (input.request.evidenceSummary?.trim()) {
    return input.request.evidenceSummary.trim();
  }

  if (input.request.caseType === "close_condition_check") {
    return input.request.closeConditionSatisfied
      ? "Source bundle indicates the market event completed before scheduled close."
      : "Source bundle does not yet justify early close.";
  }

  if (input.winner) {
    return `Source bundle points to "${input.winner.label}" as the winning outcome.`;
  }

  return "Source bundle is not strong enough to map a winning outcome.";
}

function deriveReasonSummary(
  request: OracleInspectionRequest,
  fallback: string
): string {
  return request.reasonSummary?.trim() || fallback;
}

function buildFallbackPolicy(
  request: OracleInspectionRequest
): OracleFallbackResolutionPolicy | undefined {
  if (!request.fallbackResolution) {
    return undefined;
  }

  if (request.caseType !== "resolution_check") {
    throw new OracleInspectionError("fallbackResolution is only valid for resolution cases.");
  }

  return {
    evidenceStandard: readTrimmed(request.fallbackEvidenceStandard, "fallbackEvidenceStandard"),
    primarySourceUrl: readTrimmed(request.primarySourceUrl, "primarySourceUrl"),
    primaryFailureReason: readTrimmed(request.primaryFailureReason, "primaryFailureReason")
  };
}

function buildEvidenceNotes(input: {
  request: OracleInspectionRequest;
  fallbackPolicy: OracleFallbackResolutionPolicy | undefined;
}): string | undefined {
  const notes = [
    input.request.reviewNotes?.trim(),
    input.fallbackPolicy
      ? [
          "fallback_resolution=true",
          `fallback_evidence_standard=${input.fallbackPolicy.evidenceStandard}`,
          `primary_source_url=${input.fallbackPolicy.primarySourceUrl}`,
          `primary_failure_reason=${input.fallbackPolicy.primaryFailureReason}`
        ].join("; ")
      : null
  ].filter((note): note is string => Boolean(note));

  return notes.length > 0 ? notes.join("\n") : undefined;
}

function deriveAmbiguityLevel(
  request: OracleInspectionRequest,
  reviewOutput: boolean
): OracleAmbiguityLevel {
  if (request.ambiguityLevel) {
    return request.ambiguityLevel;
  }

  if (reviewOutput) {
    return "high";
  }

  if (request.requiresHumanReview) {
    return "medium";
  }

  return "low";
}

function buildReviewSignal(input: {
  oracleCaseId: string;
  marketId: string;
  evidencePacketId: string;
  createdAt: string;
  request: OracleInspectionRequest;
  fallbackType: OracleReviewSignal["reviewType"];
  fallbackSummary: string;
}): OracleReviewSignal {
  return {
    objectType: "oracle_review_signal",
    oracleReviewSignalId: `ors_${randomUUID()}`,
    oracleCaseId: input.oracleCaseId,
    marketId: input.marketId,
    severity: input.request.reviewSeverity ?? "high",
    reviewType: input.request.reviewType ?? input.fallbackType,
    summary: input.request.reviewSummary?.trim() || input.fallbackSummary,
    evidencePacketId: input.evidencePacketId,
    recommendedNextAction: input.request.recommendedNextAction ?? "inspect",
    createdAt: input.createdAt,
    notes: input.request.reviewNotes?.trim() || undefined
  };
}

function buildEarlyCloseRecommendation(input: {
  oracleCaseId: string;
  marketId: string;
  evidencePacketId: string;
  createdAt: string;
  request: OracleInspectionRequest;
  reasonSummary: string;
}): EarlyCloseRecommendation {
  const closeConditionSatisfied = input.request.closeConditionSatisfied === true;

  return {
    objectType: "early_close_recommendation",
    earlyCloseRecommendationId: `ecr_${randomUUID()}`,
    oracleCaseId: input.oracleCaseId,
    marketId: input.marketId,
    triggerType: "oracle_confirmed_event_completion",
    recommendedAction: closeConditionSatisfied
      ? (input.request.requiresHumanReview ? "review_first" : "close_now")
      : "take_no_action",
    reasonSummary: input.reasonSummary,
    evidencePacketId: input.evidencePacketId,
    requiresHumanReview: input.request.requiresHumanReview || undefined,
    reviewReason:
      input.request.requiresHumanReview
        ? input.request.reviewType ?? "human review required by policy"
        : undefined,
    createdAt: input.createdAt
  };
}

function buildResolutionRecommendation(input: {
  oracleCaseId: string;
  marketId: string;
  evidencePacketId: string;
  winningOutcomeKey: string;
  createdAt: string;
  request: OracleInspectionRequest;
  reasonSummary: string;
  fallbackPolicy: OracleFallbackResolutionPolicy | undefined;
}): ResolutionRecommendation {
  return {
    objectType: "resolution_recommendation",
    resolutionRecommendationId: `rrc_${randomUUID()}`,
    oracleCaseId: input.oracleCaseId,
    marketId: input.marketId,
    winningOutcomeKey: input.winningOutcomeKey,
    reasonSummary: input.reasonSummary,
    evidencePacketId: input.evidencePacketId,
    requiresHumanReview: input.request.requiresHumanReview || undefined,
    reviewReason:
      input.request.requiresHumanReview
        ? input.request.reviewType ?? "human review required by policy"
        : undefined,
    resolvedAtObserved: input.request.resolvedAtObserved
      ? readIsoTimestamp(input.request.resolvedAtObserved)
      : undefined,
    fallbackPolicy: input.fallbackPolicy,
    createdAt: input.createdAt
  };
}

function reviewFallbackForRequest(input: {
  request: OracleInspectionRequest;
  winner: OracleMarketContext["outcomes"][number] | null;
}): Pick<Parameters<typeof buildReviewSignal>[0], "fallbackType" | "fallbackSummary"> {
  if (input.request.caseType === "resolution_check" && input.winner === null) {
    return {
      fallbackType: "mapping_ambiguity",
      fallbackSummary: "Oracle could not map a winning outcome from the supplied evidence."
    };
  }

  return {
    fallbackType: "insufficient_evidence",
    fallbackSummary: "Oracle could not produce a confident close recommendation from the supplied evidence."
  };
}

export function buildOracleInspectionResult(input: {
  market: OracleMarketContext;
  request: OracleInspectionRequest;
}): OracleInspectionResult {
  const { market, request } = input;
  const createdAt = readIsoTimestamp(request.capturedAt);
  const winner = resolveWinningOutcome(market, request);
  const evidenceSources = buildEvidenceSources(request, createdAt);
  const needsReviewSignal =
    Boolean(request.reviewType) ||
    (request.caseType === "resolution_check" && winner === null) ||
    (request.caseType === "close_condition_check" &&
      typeof request.closeConditionSatisfied !== "boolean");
  const oracleCaseId = `orc_${randomUUID()}`;
  const evidencePacketId = `evp_${randomUUID()}`;
  const summary = deriveSummary({
    request,
    market,
    winner
  });
  const evidenceSummary = deriveEvidenceSummary({
    request,
    winner
  });
  const reasonSummary = deriveReasonSummary(request, evidenceSummary);
  const fallbackPolicy = buildFallbackPolicy(request);
  const ambiguityLevel = deriveAmbiguityLevel(request, needsReviewSignal);
  const evidencePacket: EvidencePacket = {
    objectType: "evidence_packet",
    evidencePacketId,
    oracleCaseId,
    marketId: market.marketId,
    evidenceSummary,
    sources: evidenceSources,
    capturedAt: createdAt,
    winningOutcomeKey: request.caseType === "resolution_check" ? winner?.outcomeKey : undefined,
    closeConditionSatisfied:
      request.caseType === "close_condition_check"
        ? request.closeConditionSatisfied ?? undefined
        : undefined,
    notes: buildEvidenceNotes({
      request,
      fallbackPolicy
    })
  };
  const oracleCase: OracleCase = {
    objectType: "oracle_case",
    oracleCaseId,
    marketId: market.marketId,
    marketStatus: market.marketStatus,
    caseType: request.caseType,
    createdAt,
    updatedAt: createdAt,
    scheduledCloseAt: market.scheduledCloseAt,
    currentWinningOutcomeKey: winner?.outcomeKey,
    ambiguityLevel,
    summary
  };

  if (request.caseType === "close_condition_check" && !needsReviewSignal) {
    return {
      objectType: "oracle_inspection_result",
      market,
      oracleCase,
      evidencePacket,
      output: buildEarlyCloseRecommendation({
        oracleCaseId,
        marketId: market.marketId,
        evidencePacketId,
        createdAt,
        request,
        reasonSummary
      })
    };
  }

  if (request.caseType === "resolution_check" && winner && !needsReviewSignal) {
    return {
      objectType: "oracle_inspection_result",
      market,
      oracleCase,
      evidencePacket,
      output: buildResolutionRecommendation({
        oracleCaseId,
        marketId: market.marketId,
        evidencePacketId,
        winningOutcomeKey: winner.outcomeKey,
        createdAt,
        request,
        reasonSummary,
        fallbackPolicy
      })
    };
  }

  const fallbackReview = reviewFallbackForRequest({
    request,
    winner
  });

  return {
    objectType: "oracle_inspection_result",
    market,
    oracleCase,
    evidencePacket,
    output: buildReviewSignal({
      oracleCaseId,
      marketId: market.marketId,
      evidencePacketId,
      createdAt,
      request,
      fallbackType: fallbackReview.fallbackType,
      fallbackSummary: fallbackReview.fallbackSummary
    })
  };
}
