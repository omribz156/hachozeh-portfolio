import type {
  MarketFamilyClassification,
  MarketCreationDraft,
  MarketCreationDraftSnapshot,
  MarketContractV1,
  ReviewFeedbackItem,
  ReviewHandoffItem,
  ReviewQueueSnapshot,
  SourceRegistryEntry
} from "./contracts";
import { buildMarketContractV1 } from "./market-contract";
import {
  buildReadinessDuplicateKey,
  resolveEventIdentity,
  resolveFamilyKey
} from "./creation-contract-identity";
import {
  buildCreationNotes,
  computeLiquidityB,
  computeReserveSeedAmount,
  resolveCreationCategoryKey,
  toDraftOutcome
} from "./creation-draft-shape";
import {
  buildDelayPolicy,
  buildPayoutPolicy,
  buildResolutionRules,
  formatHebrewResolutionSource
} from "./creation-resolution-rules";
import {
  buildFamilyClassification,
  buildOracleSourcePolicy,
  evaluateCreationGate,
  isDuplicateCreationDraft,
  parseCloseAtFromShape,
  resolveContractLifecycle,
  resolveContractTopRisks,
  resolveFeedbackCategory,
  type MarketCreationBlocker
} from "./creation-gate";
import {
  persistMarketCreationDraftSnapshot,
  readReviewFeedbackLog,
  readReviewQueueHistory
} from "./persistence";
import { resolveMarketKindIdForRecurringTemplate } from "./market-family-registry";
import { listSeerSources, seededSeerSourceRegistry } from "./source-registry";

export type { MarketCreationBlocker } from "./creation-gate";

export type MarketCreationReadinessItem = {
  candidateMarketId: string;
  reviewItemId: string;
  question: string;
  category: string | undefined;
  latestAction: ReviewFeedbackItem["action"] | "unreviewed";
  blockers: MarketCreationBlocker[];
  fetchNeeds: string[];
  sourceRolePlan?: ReviewHandoffItem["sourceRolePlan"];
  contract?: MarketContractV1;
  familyClassification?: MarketFamilyClassification;
  marketShaping?: ReviewHandoffItem["marketShaping"];
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  reviewedAt: string;
};

type MarketCreationBuildOptions = {
  sourceRegistry?: SourceRegistryEntry[];
};

function estimateExpectedResolutionAt(
  item: Pick<ReviewHandoffItem, "recurringTemplateId" | "topSourceIds">,
  closeAt: string | null
): string | null {
  const closeTimestamp = closeAt ? Date.parse(closeAt) : Number.NaN;

  if (!Number.isFinite(closeTimestamp)) {
    return null;
  }

  if (
    item.recurringTemplateId === "sports-match-winner-v1" ||
    item.recurringTemplateId === "sports-regulation-3way-v1"
  ) {
    return new Date(closeTimestamp + 3 * 60 * 60 * 1000).toISOString();
  }

  if (item.topSourceIds?.includes("src_eurovision_official")) {
    return new Date(closeTimestamp + 4 * 60 * 60 * 1000).toISOString();
  }

  return new Date(closeTimestamp).toISOString();
}
function describeRecurringFamily(item: ReviewHandoffItem): string | null {
  switch (item.recurringTemplateId) {
    case "boi-rate-decision-v1":
      return "סדרה חוזרת: החלטת ריבית של בנק ישראל.";
    case "fed-rate-decision-v1":
      return "Recurring series: Federal Reserve rate decision.";
    case "ecb-rate-decision-v1":
      return "Recurring series: ECB rate decision.";
    case "knesset-dissolution-before-date-v1":
      return "סדרה חוזרת: שוק דדליין פוליטי תחום בזמן.";
    case "sports-match-winner-v1":
      return "סדרה חוזרת: משחק ספורט מתוכנן עם מנצח רשמי.";
    case "sports-regulation-3way-v1":
      return "Recurring series: regulation-time football match market.";
    default:
      return null;
  }
}

function buildDescription(item: ReviewHandoffItem, resolutionSource: string): string | null {
  const parts = [
    describeRecurringFamily(item),
    item.whyNow.trim(),
    item.topSupport.trim(),
    `מקור הכרעה: ${resolutionSource.trim()}`
  ].filter((value) => value && value.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function findReviewItem(queueHistory: ReviewQueueSnapshot[], feedback: ReviewFeedbackItem): ReviewHandoffItem | undefined {
  const snapshots = [...queueHistory].sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt));

  for (const snapshot of snapshots) {
    const exact = snapshot.items.find((item) => item.reviewItemId === feedback.reviewItemId);

    if (exact) {
      return exact;
    }

    const byCandidate = snapshot.items.find((item) => item.candidateMarketId === feedback.candidateMarketId);

    if (byCandidate) {
      return byCandidate;
    }
  }

  return undefined;
}

function latestFeedbackByCandidate(feedbackLog: ReviewFeedbackItem[]): ReviewFeedbackItem[] {
  const latest = new Map<string, ReviewFeedbackItem>();

  for (const item of feedbackLog) {
    const current = latest.get(item.candidateMarketId);

    if (!current || Date.parse(item.reviewedAt) >= Date.parse(current.reviewedAt)) {
      latest.set(item.candidateMarketId, item);
    }
  }

  return [...latest.values()];
}

function latestReviewItemsByCandidate(
  queueHistory: ReviewQueueSnapshot[]
): Array<{ item: ReviewHandoffItem; snapshotGeneratedAt: string }> {
  const latestSnapshot = [...queueHistory].sort(
    (left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt)
  )[0];

  if (!latestSnapshot) {
    return [];
  }

  const latest = new Map<string, { item: ReviewHandoffItem; snapshotGeneratedAt: string }>();

  for (const item of latestSnapshot.items) {
    latest.set(item.candidateMarketId, {
      item,
      snapshotGeneratedAt: latestSnapshot.generatedAt
    });
  }

  return [...latest.values()];
}

export function buildMarketCreationDraftsFromData(
  feedbackLog: ReviewFeedbackItem[],
  queueHistory: ReviewQueueSnapshot[],
  generatedAt: string,
  options: MarketCreationBuildOptions = {}
): MarketCreationDraft[] {
  const sourceRegistry = options.sourceRegistry ?? seededSeerSourceRegistry;
  const latestFeedback = latestFeedbackByCandidate(feedbackLog);
  const drafts: MarketCreationDraft[] = [];
  const seenDraftDuplicateKeys = new Set<string>();

  for (const feedback of [...latestFeedback].sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt))) {
    const item = findReviewItem(queueHistory, feedback);

    if (!item) {
      continue;
    }

    const gate = evaluateCreationGate(item, feedback, sourceRegistry);

    if (!gate.okay) {
      continue;
    }

    if (isDuplicateCreationDraft(item, feedback, seenDraftDuplicateKeys)) {
      continue;
    }

    const question = feedback.editedQuestion?.trim() || item.question;
    const proposedOutcomes = feedback.editedOutcomes?.length ? feedback.editedOutcomes : item.proposedOutcomes;
    const category = resolveFeedbackCategory(item, feedback) ?? item.category;
    const resolutionSource =
      (feedback.editedResolutionAnchor?.trim() || item.suggestedResolutionAnchor) ??
      item.sourceRolePlan?.resolve?.[0] ??
      "Official result";
    const familyKey = resolveFamilyKey(item) ?? undefined;
    const marketKindId =
      gate.familyClassification.familyKey ??
      resolveMarketKindIdForRecurringTemplate(item.recurringTemplateId) ??
      item.contract?.marketKindId;
    const eventIdentity = resolveEventIdentity(item, {
      closeAt: gate.closeAt,
      familyKey,
      question,
      resolutionSource
    });
    const liquidityB = computeLiquidityB({
      recurringTemplateId: item.recurringTemplateId,
      categoryKey: gate.categoryKey,
      familyKey,
      outcomeCount: proposedOutcomes.length
    });
    const seedAmount = computeReserveSeedAmount({
      liquidityB,
      outcomeCount: proposedOutcomes.length
    });
    const resolutionRules = buildResolutionRules(item, {
      question,
      proposedOutcomes,
      suggestedResolutionAnchor: resolutionSource
    });
    const expectedResolutionAt = estimateExpectedResolutionAt(item, gate.closeAt);
    const lifecycle = resolveContractLifecycle(item, sourceRegistry);
    const contractTopRisks = resolveContractTopRisks(item, lifecycle);
    const contract = buildMarketContractV1({
      question,
      marketForm: item.marketForm,
      proposedOutcomes,
      category,
      suggestedCloseShape: feedback.editedCloseShape?.trim() || item.suggestedCloseShape,
      suggestedResolutionAnchor: resolutionSource,
      sourceRolePlan: item.sourceRolePlan,
      fetchNeeds: item.fetchNeeds,
      topSourceIds: item.topSourceIds,
      topSourceRefs: item.topSourceRefs,
      topRisks: contractTopRisks,
      marketKindId,
      resolutionRule: resolutionRules,
      delayPolicy: buildDelayPolicy(item),
      payoutPolicy: buildPayoutPolicy(),
      expectedResolutionAt,
      measurementKind: lifecycle.measurementKind,
      resultShape: lifecycle.resultShape,
      oracleCapability: lifecycle.oracleCapability
    });

    drafts.push({
      objectType: "market_creation_draft",
      creationDraftId: `mcd_${item.candidateMarketId}`,
      reviewItemId: item.reviewItemId,
      candidateMarketId: item.candidateMarketId,
      familyKey,
      eventId: eventIdentity.eventId,
      eventTitle: eventIdentity.eventTitle,
      eventDescription: eventIdentity.eventDescription,
      eventIcon: null,
      eventResolutionPolicy: eventIdentity.eventResolutionPolicy,
      eventChildLabel: eventIdentity.eventChildLabel,
      intakeLane: item.intakeLane,
      recurringTemplateId: item.recurringTemplateId,
      category,
      categoryKey: gate.categoryKey,
      title: question,
      description: buildDescription(item, resolutionSource),
      openAt: generatedAt,
      closeAt: gate.closeAt,
      resolutionSource,
      resolutionRules,
      oracleSourcePolicy: buildOracleSourcePolicy(item, sourceRegistry),
      liquidityB,
      seedAmount,
      closeOnEventCompletion: true,
      eventCompletionCloseRequiresHumanApproval: true,
      outcomes: proposedOutcomes.map((outcome, index) =>
        toDraftOutcome(item.candidateMarketId, item.recurringTemplateId, outcome, index)
      ),
      idempotencyKey: `seer-create:${item.candidateMarketId}:${feedback.reviewedAt}`,
      whyNow: item.whyNow,
      createdAt: generatedAt,
      sourceRolePlan: item.sourceRolePlan,
      contract,
      familyClassification: gate.familyClassification,
      marketShaping: item.marketShaping,
      topSourceRefs: item.topSourceRefs,
      topSourceIds: item.topSourceIds,
      notes: buildCreationNotes(
        item,
        feedback,
        gate.closeAt,
        gate.categoryKey,
        liquidityB,
        seedAmount,
        familyKey,
        marketKindId,
        {
          eventId: eventIdentity.eventId,
          eventResolutionPolicy: eventIdentity.eventResolutionPolicy
        }
      )
    });
  }

  return drafts.sort((left, right) => left.title.localeCompare(right.title));
}

export async function buildMarketCreationDrafts(generatedAt: string): Promise<MarketCreationDraft[]> {
  const [feedbackLog, queueHistory, sourceRegistry] = await Promise.all([
    readReviewFeedbackLog(),
    readReviewQueueHistory(),
    listSeerSources()
  ]);
  return buildMarketCreationDraftsFromData(feedbackLog, queueHistory, generatedAt, { sourceRegistry });
}

export function buildMarketCreationReadinessFromData(
  feedbackLog: ReviewFeedbackItem[],
  queueHistory: ReviewQueueSnapshot[],
  options: MarketCreationBuildOptions = {}
): MarketCreationReadinessItem[] {
  const sourceRegistry = options.sourceRegistry ?? seededSeerSourceRegistry;
  const latestFeedback = latestFeedbackByCandidate(feedbackLog);
  const reviewedCandidateIds = new Set(latestFeedback.map((feedback) => feedback.candidateMarketId));
  const latestQueueItems = latestReviewItemsByCandidate(queueHistory);
  const readiness: MarketCreationReadinessItem[] = [];

  for (const { item, snapshotGeneratedAt } of latestQueueItems) {
    if (reviewedCandidateIds.has(item.candidateMarketId)) {
      continue;
    }

    const familyClassification = buildFamilyClassification(item, sourceRegistry);
    const marketKindId =
      item.contract?.marketKindId ??
      familyClassification.familyKey ??
      resolveMarketKindIdForRecurringTemplate(item.recurringTemplateId);

    readiness.push({
      candidateMarketId: item.candidateMarketId,
      reviewItemId: item.reviewItemId,
      question: item.question,
      category: item.category,
      latestAction: "unreviewed",
      blockers: ["review-feedback-missing"],
      fetchNeeds: item.fetchNeeds ?? [],
      sourceRolePlan: item.sourceRolePlan,
      contract: item.contract
        ? {
            ...item.contract,
            marketKindId
          }
        : undefined,
      familyClassification,
      marketShaping: item.marketShaping,
      suggestedCloseShape: item.suggestedCloseShape,
      suggestedResolutionAnchor: item.suggestedResolutionAnchor,
      reviewedAt: snapshotGeneratedAt
    });
  }

  for (const feedback of latestFeedback) {
    const item = findReviewItem(queueHistory, feedback);

    if (!item) {
      readiness.push({
        candidateMarketId: feedback.candidateMarketId,
        reviewItemId: feedback.reviewItemId,
        question: feedback.editedQuestion ?? feedback.candidateMarketId,
        category: undefined,
        latestAction: feedback.action,
        blockers: ["no-review-item"],
        fetchNeeds: [],
        reviewedAt: feedback.reviewedAt
      });
      continue;
    }

    const gate = evaluateCreationGate(item, feedback, sourceRegistry);
    const lifecycle = resolveContractLifecycle(item, sourceRegistry);
    const contractTopRisks = resolveContractTopRisks(item, lifecycle);
    const marketKindId =
      gate.familyClassification.familyKey ??
      resolveMarketKindIdForRecurringTemplate(item.recurringTemplateId) ??
      item.contract?.marketKindId;

    readiness.push({
      candidateMarketId: item.candidateMarketId,
      reviewItemId: item.reviewItemId,
      question: feedback.editedQuestion?.trim() || item.question,
      category: resolveFeedbackCategory(item, feedback),
      latestAction: feedback.action,
      blockers: gate.okay ? [] : gate.blockers,
      fetchNeeds: item.fetchNeeds ?? [],
      sourceRolePlan: item.sourceRolePlan,
      contract: buildMarketContractV1({
        question: feedback.editedQuestion?.trim() || item.question,
        marketForm: item.marketForm,
        proposedOutcomes: feedback.editedOutcomes?.length ? feedback.editedOutcomes : item.proposedOutcomes,
        category: resolveFeedbackCategory(item, feedback),
        suggestedCloseShape: feedback.editedCloseShape?.trim() || item.suggestedCloseShape,
        suggestedResolutionAnchor: feedback.editedResolutionAnchor?.trim() || item.suggestedResolutionAnchor,
        sourceRolePlan: item.sourceRolePlan,
        fetchNeeds: item.fetchNeeds,
        topSourceIds: item.topSourceIds,
        topSourceRefs: item.topSourceRefs,
        topRisks: contractTopRisks,
        marketKindId,
        resolutionRule: buildResolutionRules(item, {
          question: feedback.editedQuestion?.trim() || item.question,
          proposedOutcomes: feedback.editedOutcomes?.length ? feedback.editedOutcomes : item.proposedOutcomes,
          suggestedResolutionAnchor: feedback.editedResolutionAnchor?.trim() || item.suggestedResolutionAnchor
        }),
        delayPolicy: buildDelayPolicy(item),
        payoutPolicy: buildPayoutPolicy(),
        expectedResolutionAt: estimateExpectedResolutionAt(item, expectedResolutionCloseAt(item, feedback, gate)),
        measurementKind: lifecycle.measurementKind,
        resultShape: lifecycle.resultShape,
        oracleCapability: lifecycle.oracleCapability
      }),
      familyClassification: gate.familyClassification,
      marketShaping: item.marketShaping,
      suggestedCloseShape: feedback.editedCloseShape?.trim() || item.suggestedCloseShape,
      suggestedResolutionAnchor: feedback.editedResolutionAnchor?.trim() || item.suggestedResolutionAnchor,
      reviewedAt: feedback.reviewedAt
    });
  }

  return keepBestReadinessPerContract(readiness).sort((left, right) => {
    if (left.blockers.length !== right.blockers.length) {
      return right.blockers.length - left.blockers.length;
    }

    return left.question.localeCompare(right.question);
  });
}

function expectedResolutionCloseAt(
  item: ReviewHandoffItem,
  feedback: ReviewFeedbackItem,
  gate: { okay: boolean; closeAt?: string | null }
): string | null {
  if (gate.okay) {
    return gate.closeAt ?? null;
  }

  return parseCloseAtFromShape(feedback.editedCloseShape?.trim() || item.suggestedCloseShape);
}

function readinessRank(item: MarketCreationReadinessItem): number {
  const actionScore = item.latestAction === "approve" || item.latestAction === "approve-with-edits" ? 100 : 0;
  const blockerScore = item.blockers.length === 0 ? 50 : -item.blockers.length * 10;
  return actionScore + blockerScore + (Date.parse(item.reviewedAt) || 0) / 1_000_000_000;
}

function keepBestReadinessPerContract(items: MarketCreationReadinessItem[]): MarketCreationReadinessItem[] {
  const bestByKey = new Map<string, MarketCreationReadinessItem>();
  const unkeyed: MarketCreationReadinessItem[] = [];

  for (const item of items) {
    const duplicateKey = buildReadinessDuplicateKey(item);

    if (!duplicateKey) {
      unkeyed.push(item);
      continue;
    }

    const current = bestByKey.get(duplicateKey);

    if (!current || readinessRank(item) > readinessRank(current)) {
      bestByKey.set(duplicateKey, item);
    }
  }

  return [...unkeyed, ...bestByKey.values()];
}

export async function buildMarketCreationReadiness(): Promise<MarketCreationReadinessItem[]> {
  const [feedbackLog, queueHistory, sourceRegistry] = await Promise.all([
    readReviewFeedbackLog(),
    readReviewQueueHistory(),
    listSeerSources()
  ]);
  return buildMarketCreationReadinessFromData(feedbackLog, queueHistory, { sourceRegistry });
}

export async function buildAndPersistMarketCreationDraftSnapshot(
  generatedAt: string
): Promise<MarketCreationDraftSnapshot> {
  const drafts = await buildMarketCreationDrafts(generatedAt);
  return persistMarketCreationDraftSnapshot(drafts, generatedAt);
}
