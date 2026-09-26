import type {
  ProposedOutcome,
  ReworkAttemptItem,
  RecommendedAction,
  ReviewFeedbackItem,
  ReviewHandoffItem,
  ReviewQueueSnapshot,
  ReviewReasonCategory,
  SourceRegistryEntry
} from "./contracts";
import { readReviewFeedbackLog, readReviewQueueHistory } from "./persistence";
import { readReworkAttemptLog } from "./persistence";
import { fingerprintReviewItem } from "./rework-loop";

type SourceLearningMemory = {
  reviewCount: number;
  approveCount: number;
  rejectCount: number;
  holdCount: number;
  duplicateCount: number;
  groundingIssueCount: number;
  lastReviewedAt: string;
  lastUsefulAt?: string;
};

type LineageLearningMemory = {
  reviewCount: number;
  approveCount: number;
  mergeCount: number;
  rejectCount: number;
  duplicateCount: number;
  lastReviewedAt: string;
};

type CandidateLearningMemory = {
  action: RecommendedAction;
  reasonCategory: ReviewReasonCategory;
  reviewedAt: string;
  reviewItemId?: string;
  reviewedFingerprint?: string;
  reworkStatus?: ReworkAttemptItem["status"];
  reworkGeneratedAt?: string;
  revisedFingerprint?: string;
  revisedQuestion?: string;
  revisedMarketForm?: import("./contracts").MarketForm;
  revisedOutcomes?: ProposedOutcome[];
  reworkSummary?: string;
  requiredChanges?: string[];
};

export type ReviewLearningMemory = {
  sourceMemory: Map<string, SourceLearningMemory>;
  lineageMemory: Map<string, LineageLearningMemory>;
  candidateMemory: Map<string, CandidateLearningMemory>;
};

export function canonicalReasonCategory(reasonCategory: ReviewReasonCategory): ReviewReasonCategory {
  const aliasMap: Partial<Record<ReviewReasonCategory, ReviewReasonCategory>> = {
    fit: "good-as-is",
    wording: "wording-needs-improvement",
    duplicate: "duplicate-or-overlap",
    timing: "too-early",
    outcomes: "outcome-structure-needs-improvement",
    authority: "insufficient-grounding",
    sensitivity: "sensitivity-risk",
    other: "proposal-quality-weak"
  };

  return aliasMap[reasonCategory] ?? reasonCategory;
}

function isPositiveAction(action: RecommendedAction): boolean {
  return action === "approve" || action === "approve-with-edits";
}

function updateIfLater(current: string | undefined, next: string): string {
  return !current || Date.parse(next) > Date.parse(current) ? next : current;
}

function normalizeSurface(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
}

function matchSourceIds(item: ReviewHandoffItem | undefined, sources: SourceRegistryEntry[]): string[] {
  if (!item) {
    return [];
  }

  if (item.topSourceIds?.length) {
    return item.topSourceIds;
  }

  const refs = item.topSourceRefs ?? [];
  const normalizedRefs = refs.map(normalizeSurface);

  return sources
    .filter((source) => {
      if (refs.includes(source.sourceId)) {
        return true;
      }

      if (!source.homepage) {
        return false;
      }

      return normalizedRefs.includes(normalizeSurface(source.homepage));
    })
    .map((source) => source.sourceId);
}

export function buildReviewLearningMemoryFromData(
  sources: SourceRegistryEntry[],
  feedbackLog: ReviewFeedbackItem[],
  queueHistory: ReviewQueueSnapshot[],
  reworkAttempts: ReworkAttemptItem[] = []
): ReviewLearningMemory {
  const reviewItemLookup = new Map<string, ReviewHandoffItem>();
  const candidateLookup = new Map<string, ReviewHandoffItem>();
  const sourceMemory = new Map<string, SourceLearningMemory>();
  const lineageMemory = new Map<string, LineageLearningMemory>();
  const candidateMemory = new Map<string, CandidateLearningMemory>();

  for (const snapshot of queueHistory) {
    for (const item of snapshot.items) {
      reviewItemLookup.set(item.reviewItemId, item);
      candidateLookup.set(item.candidateMarketId, item);
    }
  }

  for (const feedback of feedbackLog) {
    const reasonCategory = canonicalReasonCategory(feedback.reasonCategory);
    const item = reviewItemLookup.get(feedback.reviewItemId) ?? candidateLookup.get(feedback.candidateMarketId);
    const sourceIds = matchSourceIds(item, sources);
    const lineageId = feedback.lineageId ?? item?.lineageId;

    candidateMemory.set(feedback.candidateMarketId, {
      action: feedback.action,
      reasonCategory,
      reviewedAt: feedback.reviewedAt,
      reviewItemId: feedback.reviewItemId,
      reviewedFingerprint: item ? fingerprintReviewItem(item) : undefined
    });

    for (const sourceId of sourceIds) {
      const current = sourceMemory.get(sourceId) ?? {
        reviewCount: 0,
        approveCount: 0,
        rejectCount: 0,
        holdCount: 0,
        duplicateCount: 0,
        groundingIssueCount: 0,
        lastReviewedAt: feedback.reviewedAt
      };

      current.reviewCount += 1;
      current.lastReviewedAt = updateIfLater(current.lastReviewedAt, feedback.reviewedAt);

      if (isPositiveAction(feedback.action)) {
        current.approveCount += 1;
        current.lastUsefulAt = updateIfLater(current.lastUsefulAt, feedback.reviewedAt);
      }

      if (feedback.action === "reject") {
        current.rejectCount += 1;
      }

      if (feedback.action === "hold") {
        current.holdCount += 1;
      }

      if (reasonCategory === "duplicate-or-overlap") {
        current.duplicateCount += 1;
      }

      if (reasonCategory === "insufficient-grounding") {
        current.groundingIssueCount += 1;
      }

      sourceMemory.set(sourceId, current);
    }

    if (!lineageId) {
      continue;
    }

    const currentLineage = lineageMemory.get(lineageId) ?? {
      reviewCount: 0,
      approveCount: 0,
      mergeCount: 0,
      rejectCount: 0,
      duplicateCount: 0,
      lastReviewedAt: feedback.reviewedAt
    };

    currentLineage.reviewCount += 1;
    currentLineage.lastReviewedAt = updateIfLater(currentLineage.lastReviewedAt, feedback.reviewedAt);

    if (isPositiveAction(feedback.action)) {
      currentLineage.approveCount += 1;
    }

    if (feedback.action === "merge") {
      currentLineage.mergeCount += 1;
    }

    if (feedback.action === "reject") {
      currentLineage.rejectCount += 1;
    }

    if (reasonCategory === "duplicate-or-overlap") {
      currentLineage.duplicateCount += 1;
    }

    lineageMemory.set(lineageId, currentLineage);
  }

  for (const attempt of reworkAttempts) {
    const current = candidateMemory.get(attempt.candidateMarketId);

    if (!current) {
      continue;
    }

    if (current.reworkGeneratedAt && Date.parse(current.reworkGeneratedAt) > Date.parse(attempt.generatedAt)) {
      continue;
    }

    candidateMemory.set(attempt.candidateMarketId, {
      ...current,
      reviewedFingerprint: attempt.reviewedFingerprint,
      reworkStatus: attempt.status,
      reworkGeneratedAt: attempt.generatedAt,
      revisedFingerprint: attempt.revisedFingerprint,
      revisedQuestion: attempt.revisedQuestion,
      revisedMarketForm: attempt.revisedMarketForm,
      revisedOutcomes: attempt.revisedOutcomes,
      reworkSummary: attempt.changeSummary,
      requiredChanges: attempt.requiredChanges
    });
  }

  return {
    sourceMemory,
    lineageMemory,
    candidateMemory
  };
}

export async function buildReviewLearningMemory(sources: SourceRegistryEntry[]): Promise<ReviewLearningMemory> {
  const [feedbackLog, queueHistory, reworkAttempts] = await Promise.all([
    readReviewFeedbackLog(),
    readReviewQueueHistory(),
    readReworkAttemptLog()
  ]);
  return buildReviewLearningMemoryFromData(sources, feedbackLog, queueHistory, reworkAttempts);
}
