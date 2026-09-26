import { createHash } from "node:crypto";

import type {
  MarketForm,
  ProposedOutcome,
  ReworkAttemptItem,
  RecommendedAction,
  ReviewFeedbackItem,
  ReviewHandoffItem,
  ReviewQueueSnapshot,
  ReviewReasonCategory
} from "./contracts";
import { canonicalReasonCategory } from "./review-memory";
import { slugify } from "./text";

function fingerprintQuestionShape(question: string, outcomes: ProposedOutcome[]): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        question: question.trim(),
        outcomes: outcomes.map((outcome) => outcome.label.trim().toLowerCase())
      })
    )
    .digest("hex");
}

export function fingerprintReviewItem(item: ReviewHandoffItem): string {
  return fingerprintQuestionShape(item.question, item.proposedOutcomes);
}

function normalizeRateDecisionOutcomes(outcomes: ProposedOutcome[]): ProposedOutcome[] | undefined {
  const labels = outcomes.map((outcome) => outcome.label.trim().toLowerCase());

  if (
    labels.length === 3 &&
    labels.includes("rate cut") &&
    labels.includes("no change") &&
    labels.includes("rate hike")
  ) {
    return [
      { label: "50+ bps decrease", kind: "named-outcome" },
      { label: "25 bps decrease", kind: "named-outcome" },
      { label: "No change", kind: "named-outcome" },
      { label: "25 bps increase", kind: "named-outcome" },
      { label: "50+ bps increase", kind: "named-outcome" }
    ];
  }

  return undefined;
}

function reviseCountryWinnerMarket(
  question: string,
  outcomes: ProposedOutcome[]
): { revisedQuestion: string; revisedMarketForm: MarketForm; revisedOutcomes: ProposedOutcome[] } | undefined {
  const normalizedQuestion = question.trim();
  const labels = outcomes.map((outcome) => outcome.label.trim());
  const hasIsrael = labels.some((label) => label.toLowerCase() === "israel");

  if (!hasIsrael || !/^Which country will win /i.test(normalizedQuestion)) {
    return undefined;
  }

  return {
    revisedQuestion: normalizedQuestion.replace(/^Which country will win /i, "Will Israel win "),
    revisedMarketForm: "binary",
    revisedOutcomes: [
      { label: "Yes", kind: "binary-side" },
      { label: "No", kind: "binary-side" }
    ]
  };
}

function buildRequiredChanges(reasonCategory: ReviewReasonCategory, reasonSummary: string): string[] {
  const requiredChanges = [reasonSummary.trim()].filter((value) => value.length > 0);

  const defaults: Partial<Record<ReviewReasonCategory, string>> = {
    "wording-needs-improvement": "tighten wording before the next review pass",
    "outcome-structure-needs-improvement": "reshape outcomes into a cleaner market set",
    "duplicate-or-overlap": "separate from overlapping lineage branch or merge away",
    "too-early": "wait for a fresher event window or stronger trigger",
    "insufficient-grounding": "add stronger official grounding before replay",
    "proposal-quality-weak": "rewrite the proposal shape before replay"
  };

  const fallback = defaults[reasonCategory];
  if (fallback && !requiredChanges.includes(fallback)) {
    requiredChanges.push(fallback);
  }

  return requiredChanges;
}

export function buildReworkAttempt(
  feedback: ReviewFeedbackItem,
  item: ReviewHandoffItem
): ReworkAttemptItem {
  const reasonCategory = canonicalReasonCategory(feedback.reasonCategory);
  const reviewedFingerprint = fingerprintReviewItem(item);
  let revisedQuestion = feedback.editedQuestion?.trim() || item.question;
  let revisedMarketForm: MarketForm | undefined;
  let revisedOutcomes = feedback.editedOutcomes ?? item.proposedOutcomes;
  const notes: string[] = [];

  if (!feedback.editedOutcomes && reasonCategory === "outcome-structure-needs-improvement") {
    const normalized = normalizeRateDecisionOutcomes(item.proposedOutcomes);

    if (normalized) {
      revisedOutcomes = normalized;
      notes.push("Auto-rework: normalized coarse rate direction outcomes into explicit percentage-point steps.");
    } else {
      const winnerRevision = reviseCountryWinnerMarket(item.question, item.proposedOutcomes);

      if (winnerRevision) {
        revisedQuestion = winnerRevision.revisedQuestion;
        revisedMarketForm = winnerRevision.revisedMarketForm;
        revisedOutcomes = winnerRevision.revisedOutcomes;
        notes.push("Auto-rework: collapsed arbitrary winner shortlist into a locally relevant Israel binary market.");
      }
    }
  }

  if (feedback.editedQuestion?.trim()) {
    notes.push("Operator supplied a revised question during review.");
  }

  if (feedback.editedOutcomes?.length) {
    notes.push("Operator supplied revised outcomes during review.");
  }

  const revisedFingerprint = fingerprintQuestionShape(revisedQuestion, revisedOutcomes);
  const materiallyChanged = revisedFingerprint !== reviewedFingerprint;
  const status = resolveReworkStatus(materiallyChanged, reasonCategory);

  const changeSummary =
    status === "auto-revised"
      ? "Seer reshaped the candidate after review feedback and recorded a replayable revision."
      : status === "needs-operator-input"
        ? "Feedback was recorded, but no safe automatic reshape was available yet."
        : "Feedback was recorded; this candidate still needs a human-guided rethink before replay.";

  return {
    objectType: "rework_attempt_item",
    reworkAttemptId: `rwa_${slugify(`${feedback.reviewFeedbackId}_${item.candidateMarketId}`)}`,
    candidateMarketId: item.candidateMarketId,
    reviewItemId: item.reviewItemId,
    basedOnReviewFeedbackId: feedback.reviewFeedbackId,
    reviewedFingerprint,
    revisedFingerprint,
    status,
    reasonCategory,
    reasonSummary: feedback.reasonSummary,
    generatedAt: feedback.reviewedAt,
    lineageId: feedback.lineageId ?? item.lineageId,
    requiredChanges: buildRequiredChanges(reasonCategory, feedback.reasonSummary),
    changeSummary,
    revisedQuestion: materiallyChanged || feedback.editedQuestion ? revisedQuestion : undefined,
    revisedMarketForm,
    revisedOutcomes: materiallyChanged || feedback.editedOutcomes ? revisedOutcomes : undefined,
    notes: notes.length > 0 ? notes : undefined
  };
}

function resolveReworkStatus(
  materiallyChanged: boolean,
  reasonCategory: ReviewReasonCategory
): ReworkAttemptItem["status"] {
  if (materiallyChanged) {
    return "auto-revised";
  }

  return reasonCategory === "outcome-structure-needs-improvement"
    ? "needs-operator-input"
    : "no-safe-fix";
}

export function shouldCreateReworkAttempt(action: RecommendedAction): boolean {
  return action === "approve-with-edits" || action === "request-rework" || action === "reject";
}

export function buildMissingReworkAttempts(
  feedbackLog: ReviewFeedbackItem[],
  queueHistory: ReviewQueueSnapshot[],
  existingAttempts: ReworkAttemptItem[]
): ReworkAttemptItem[] {
  const existingAttemptsByFeedbackId = new Map(
    existingAttempts.map((attempt) => [attempt.basedOnReviewFeedbackId, attempt] as const)
  );

  return feedbackLog
    .filter((feedback) => shouldCreateReworkAttempt(feedback.action))
    .map((feedback) => {
      const sourceItem = findReviewItemForFeedback(queueHistory, feedback);

      if (!sourceItem) {
        return undefined;
      }

      const nextAttempt = buildReworkAttempt(feedback, sourceItem);
      const currentAttempt = existingAttemptsByFeedbackId.get(feedback.reviewFeedbackId);

      if (
        currentAttempt &&
        currentAttempt.status === nextAttempt.status &&
        currentAttempt.revisedFingerprint === nextAttempt.revisedFingerprint &&
        currentAttempt.revisedQuestion === nextAttempt.revisedQuestion &&
        currentAttempt.revisedMarketForm === nextAttempt.revisedMarketForm &&
        JSON.stringify(currentAttempt.revisedOutcomes ?? []) === JSON.stringify(nextAttempt.revisedOutcomes ?? [])
      ) {
        return undefined;
      }

      return nextAttempt;
    })
    .filter((attempt): attempt is ReworkAttemptItem => Boolean(attempt));
}

export function findReviewItemForFeedback(
  queueHistory: ReviewQueueSnapshot[],
  feedback: Pick<ReviewFeedbackItem, "reviewItemId" | "candidateMarketId" | "reviewedAt">
): ReviewHandoffItem | null {
  const reviewedAtMs = Date.parse(feedback.reviewedAt);
  const eligibleSnapshots = queueHistory
    .filter((snapshot) => Date.parse(snapshot.generatedAt) <= reviewedAtMs)
    .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt));
  const fallbackSnapshots =
    eligibleSnapshots.length > 0
      ? eligibleSnapshots
      : [...queueHistory].sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt));

  for (const snapshot of fallbackSnapshots) {
    const match =
      snapshot.items.find(
        (item) => item.reviewItemId === feedback.reviewItemId || item.candidateMarketId === feedback.candidateMarketId
      ) ?? null;

    if (match) {
      return match;
    }
  }

  return null;
}
