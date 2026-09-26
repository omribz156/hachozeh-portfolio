import type { Pool } from "pg";

import type { RequestActor } from "../../back/src/platform-surface/oracle";
import {
  OracleCandidateIntakeError,
  type ApproveOracleResolutionCandidateRequest,
  type IntakeOracleCandidateEvidenceRequest
} from "./candidate-intake-requests";
import {
  inspectOracleMarket,
  OracleInspectionError
} from "./inspect-market-service";
import type { OracleCandidateEvidence } from "./candidate-evidence";
import { approveOracleResolutionCase } from "./review-action-service";

export {
  OracleCandidateIntakeError,
  parseApproveOracleResolutionCandidateRequest,
  parseIntakeOracleCandidateEvidenceRequest,
  type ApproveOracleResolutionCandidateRequest,
  type IntakeOracleCandidateEvidenceRequest
} from "./candidate-intake-requests";

export type ApproveOracleResolutionCandidateResult = {
  objectType: "oracle_candidate_resolution_approval_result";
  intake: Awaited<ReturnType<typeof inspectOracleMarket>>;
  approval: Awaited<ReturnType<typeof approveOracleResolutionCase>>;
};

function buildClaimSummary(candidate: OracleCandidateEvidence): string {
  const title = candidate.title.trim();
  const summary = candidate.summary.trim();

  if (!title) {
    return summary;
  }

  if (!summary || summary === title) {
    return title;
  }

  return `${title}. ${summary}`;
}

function buildReviewNotes(request: IntakeOracleCandidateEvidenceRequest): string | null {
  const lines = [
    request.reviewNotes?.trim() || null,
    `Candidate evidence id: ${request.candidateEvidence.candidateEvidenceId}`,
    `Shared-source signal id: ${request.candidateEvidence.signalId}`,
    `Fetch readiness: ${request.candidateEvidence.fetchReadiness}`,
    ...(request.candidateEvidence.reviewReasons ?? []).map((line) => `Review reason: ${line}`)
  ].filter((line): line is string => Boolean(line && line.trim()));

  return lines.length > 0 ? lines.join("\n") : null;
}

function normalizeOracleInspectionError(error: OracleInspectionError): OracleCandidateIntakeError {
  const message = error.message;

  if (message.startsWith("Market not found:")) {
    return new OracleCandidateIntakeError(404, "market_not_found", message);
  }

  if (
    message.startsWith("Invalid ISO timestamp:") ||
    message.endsWith(" is required.") ||
    message === "At least one evidence source is required."
  ) {
    return new OracleCandidateIntakeError(400, "invalid_request", message);
  }

  return new OracleCandidateIntakeError(409, "candidate_not_intakeable", message);
}

export async function intakeOracleCandidateEvidence(
  dbPool: Pool,
  request: IntakeOracleCandidateEvidenceRequest
) {
  try {
    return await inspectOracleMarket(
      dbPool,
      {
        marketId: request.marketId,
        caseType: request.caseType,
        sources: [
          {
            sourceId: request.candidateEvidence.sourceId,
            sourceUrl: request.candidateEvidence.sourceUrl!,
            sourceLabel: request.candidateEvidence.sourceLabel,
            sourceType: request.candidateEvidence.authorityProfile ?? "shared_source_candidate",
            independentGroupId: request.candidateEvidence.independentGroupId,
            claimSummary: buildClaimSummary(request.candidateEvidence),
            capturedAt: request.candidateEvidence.observedAt
          }
        ],
        closeConditionSatisfied: request.closeConditionSatisfied,
        winningOutcomeId: request.winningOutcomeId,
        winningOutcomeKey: request.winningOutcomeKey,
        evidenceSummary:
          request.evidenceSummary ??
          `Candidate evidence imported for Oracle review: ${request.candidateEvidence.title}`,
        reasonSummary: request.reasonSummary ?? request.candidateEvidence.summary,
        summary:
          request.summary ??
          `Oracle imported candidate evidence from ${request.candidateEvidence.sourceLabel}.`,
        ambiguityLevel: request.ambiguityLevel ?? null,
        requiresHumanReview: request.requiresHumanReview ?? true,
        reviewType: request.reviewType ?? null,
        reviewSeverity: request.reviewSeverity ?? null,
        reviewSummary: request.reviewSummary ?? null,
        reviewNotes: buildReviewNotes(request),
        recommendedNextAction: request.recommendedNextAction ?? "inspect",
        resolvedAtObserved: request.resolvedAtObserved ?? null,
        capturedAt: request.candidateEvidence.observedAt
      },
      {
        persistResult: request.persistResult ?? true
      }
    );
  } catch (error) {
    if (error instanceof OracleInspectionError) {
      throw normalizeOracleInspectionError(error);
    }

    throw error;
  }
}

export async function approveOracleResolutionCandidate(
  dbPool: Pool,
  actor: RequestActor,
  request: ApproveOracleResolutionCandidateRequest
): Promise<ApproveOracleResolutionCandidateResult> {
  const intake = await intakeOracleCandidateEvidence(dbPool, {
    ...request,
    requiresHumanReview: false,
    persistResult: true
  });

  if (intake.output.objectType !== "resolution_recommendation") {
    throw new OracleCandidateIntakeError(
      409,
      "candidate_not_approvable",
      "Candidate intake did not produce a resolution recommendation."
    );
  }

  const approval = await approveOracleResolutionCase(
    dbPool,
    intake.oracleCase.oracleCaseId,
    actor,
    {
      reviewNote: request.reviewNote ?? intake.output.reasonSummary,
      idempotencyKey: request.approvalIdempotencyKey
    }
  );

  return {
    objectType: "oracle_candidate_resolution_approval_result",
    intake,
    approval
  };
}
