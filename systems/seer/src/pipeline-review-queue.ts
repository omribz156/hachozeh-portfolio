import type {
  CandidateMarket,
  ConfidenceLabel,
  ReviewHandoffItem,
  ReviewQueueSections
} from "./contracts";
import { isLiveLane, isPlannedLane } from "./intake-lanes";
import {
  extractCutoffLabelFromCloseShape,
  extractCutoffLabelFromQuestion,
  hasCutoffPassed
} from "./market-cutoff-labels";
import { plannedDuplicateKeyForReviewItem } from "./planned-registry";
import type { ReviewLearningMemory } from "./review-memory";
import {
  extractFirstUrl,
  normalizeFingerprintText,
  normalizeSourceUrlForFingerprint
} from "./source-reference-text";

const ACTIVE_AUTO_DRAFT_LIMIT = 5;
const ACTIVE_LIVE_EVENT_LIMIT = 2;
const ACTIVE_RECURRING_PLANNED_EVENT_LIMIT = 8;
const ACTIVE_PLANNED_EVENT_FAMILY_LIMIT = 3;

type ReviewQueueCluster = {
  clusterKey: string;
  candidateMarket?: Pick<CandidateMarket, "candidateMarketId" | "recurringTemplateId" | "suggestedCloseShape">;
  reviewItem?: ReviewHandoffItem;
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function confidenceWeight(label: ConfidenceLabel): number {
  if (label === "high") return 30;
  if (label === "medium") return 15;
  if (label === "low") return 5;
  return 0;
}

function closeDateKeyFromShape(value: string | undefined): string | null {
  const match = value?.match(/([A-Za-z]+ \d{1,2}, 20\d{2})(?: at \d{1,2}:\d{2})?/);

  if (!match?.[1]) {
    return null;
  }

  const parsed = new Date(`${match[1]} UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isCalendarEventTemplate(templateId: string | undefined): boolean {
  return (
    templateId === "boi-rate-decision-v1" ||
    templateId === "fed-rate-decision-v1" ||
    templateId === "ecb-rate-decision-v1" ||
    templateId === "knesset-dissolution-before-date-v1"
  );
}

function buildReviewDuplicateKey(item: ReviewHandoffItem): string | null {
  const plannedDuplicateKey = plannedDuplicateKeyForReviewItem(item);

  if (plannedDuplicateKey) {
    return plannedDuplicateKey;
  }

  const closeDate = closeDateKeyFromShape(item.suggestedCloseShape);

  if (!closeDate) {
    return null;
  }

  if (isCalendarEventTemplate(item.recurringTemplateId)) {
    return `calendar:${item.recurringTemplateId}:${closeDate}`;
  }

  const sourceText = item.suggestedResolutionAnchor || item.sourceRolePlan?.resolve?.[0] || item.topSourceRefs?.[0];
  const sourceKey = normalizeSourceUrlForFingerprint(sourceText);
  const questionKey = normalizeFingerprintText(item.question);

  if (item.recurringTemplateId === "sports-match-winner-v1" || item.recurringTemplateId === "sports-regulation-3way-v1") {
    return `sports:${item.recurringTemplateId}:${closeDate}:${sourceKey || questionKey}`;
  }

  return `market:${closeDate}:${sourceKey}:${questionKey}`;
}

function reviewContractBlockers(item: ReviewHandoffItem): string[] {
  const blockers: string[] = [];
  const resolutionText = [item.suggestedResolutionAnchor, ...(item.sourceRolePlan?.resolve ?? [])].filter(
    (value): value is string => Boolean(value?.trim())
  );
  const resolutionSourceUrl =
    resolutionText.map(extractFirstUrl).find((value): value is string => Boolean(value)) ??
    (item.topSourceRefs ?? []).map(extractFirstUrl).find((value): value is string => Boolean(value));

  if (!item.suggestedCloseShape?.trim()) {
    blockers.push("missing timeline/close shape");
  }

  if (resolutionText.length === 0) {
    blockers.push("missing resolution rule/source anchor");
  }

  if (!resolutionSourceUrl) {
    blockers.push("missing explicit source URL");
  }

  if ((item.fetchNeeds?.length ?? 0) > 0) {
    blockers.push(`open fetch needs: ${item.fetchNeeds?.join(", ")}`);
  }

  return blockers;
}

function sportsReviewPriority(item: ReviewHandoffItem): number {
  if (!/\bvs\.?\b/i.test(item.question)) {
    return 0;
  }

  const topRisks = item.topRisks.map((risk) => risk.toLowerCase());
  const hasExplicitDate = topRisks.some((risk) => risk.startsWith("grounding: event-date=") && !risk.includes("observed-trend-window"));
  const hasProvisionalDate = topRisks.some((risk) => risk.includes("observed-trend-window"));
  const hasFixtureContext = topRisks.some((risk) => risk.includes("fixture-context=coverage-match-page"));
  const hasCompetitionGrounding =
    topRisks.some((risk) => risk.includes("grounding: competition=")) || /\([^,]+,\s*[a-z]{3}\s+\d{1,2}\)$/i.test(item.question);
  const hasDrawBucket = item.proposedOutcomes.some((outcome) => outcome.label.trim().toLowerCase() === "draw");

  return (
    (hasExplicitDate ? 45 : 0) +
    (hasCompetitionGrounding ? 25 : 0) +
    (hasFixtureContext ? 10 : 0) +
    (hasDrawBucket ? 5 : 0) -
    (hasProvisionalDate ? 25 : 0) -
    (item.fetchNeeds?.length ?? 0) * 8
  );
}

function plannedEventReviewPriority(item: ReviewHandoffItem): number {
  if (!isPlannedLane(item.intakeLane)) {
    return 0;
  }

  const fetchNeedCount = item.fetchNeeds?.length ?? 0;
  const hasGroundPlan = (item.sourceRolePlan?.ground?.length ?? 0) > 0;
  const hasResolvePlan = (item.sourceRolePlan?.resolve?.length ?? 0) > 0;

  return (
    25 +
    (item.authorityReadiness === "high" ? 25 : 0) +
    (fetchNeedCount === 0 ? 25 : 0) +
    (hasGroundPlan ? 10 : 0) +
    (hasResolvePlan ? 10 : 0)
  );
}

function activeReviewPriority(item: ReviewHandoffItem): number {
  const recommendedActionWeight =
    item.recommendedAction === "approve"
      ? 60
      : item.recommendedAction === "approve-with-edits"
        ? 40
        : item.recommendedAction === "request-rework"
          ? 20
          : 0;

  return (
    recommendedActionWeight +
    confidenceWeight(item.authorityReadiness) +
    confidenceWeight(item.confidence) +
    sportsReviewPriority(item) +
    plannedEventReviewPriority(item) -
    (item.fetchNeeds?.length ?? 0) * 10
  );
}

function compareReviewItems(left: ReviewHandoffItem, right: ReviewHandoffItem): number {
  const priorityDelta = activeReviewPriority(right) - activeReviewPriority(left);

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const createdAtDelta = (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0);

  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.question.localeCompare(right.question);
}

function parkActiveOverflow(
  sections: ReviewQueueSections,
  item: ReviewHandoffItem,
  reason: string,
  hint: string
): void {
  sections.rework.push({
    ...item,
    recommendedAction: "hold",
    recommendedActionWhy: reason,
    reviewHints: [...(item.reviewHints ?? []), hint]
  });
}

function parseEventDateLabelFromReviewItem(item: ReviewHandoffItem): string | undefined {
  const groundedRisk = item.topRisks.find((risk) => risk.startsWith("grounding: event-date="));

  if (!groundedRisk) {
    return undefined;
  }

  return groundedRisk
    .replace("grounding: event-date=", "")
    .replace("observed-trend-window:", "")
    .trim();
}

function extractClusterCutoffLabel(cluster: ReviewQueueCluster): string | undefined {
  const fromCloseShape = extractCutoffLabelFromCloseShape(cluster.candidateMarket?.suggestedCloseShape);

  if (fromCloseShape) {
    return fromCloseShape;
  }

  const reviewItem = cluster.reviewItem;

  if (!reviewItem) {
    return undefined;
  }

  const fromGroundedEventDate = parseEventDateLabelFromReviewItem(reviewItem);

  if (fromGroundedEventDate) {
    return fromGroundedEventDate;
  }

  return extractCutoffLabelFromQuestion(reviewItem.question);
}

function isStaleReviewItem(cluster: ReviewQueueCluster, now = new Date()): boolean {
  if (!cluster.reviewItem) {
    return false;
  }

  const cutoffLabel = extractClusterCutoffLabel(cluster);

  if (!cutoffLabel) {
    return false;
  }

  return hasCutoffPassed(cutoffLabel, now);
}

function toQueueSectionName(
  cluster: ReviewQueueCluster,
  learningMemory: ReviewLearningMemory
): keyof ReviewQueueSections {
  const candidateMarketId = cluster.candidateMarket?.candidateMarketId;

  if (!candidateMarketId) {
    return "active";
  }

  const candidateMemory = learningMemory.candidateMemory.get(candidateMarketId);

  if (!candidateMemory) {
    return "active";
  }

  if (
    candidateMemory.reworkStatus === "auto-revised" &&
    candidateMemory.reviewedFingerprint &&
    candidateMemory.revisedFingerprint &&
    candidateMemory.reviewedFingerprint !== candidateMemory.revisedFingerprint
  ) {
    return "active";
  }

  if (["hold", "request-rework", "approve-with-edits", "reject"].includes(candidateMemory.action)) {
    return "rework";
  }

  return "reviewed";
}

export function buildLayeredReviewQueueFromClusters(
  clusters: ReviewQueueCluster[],
  learningMemory: ReviewLearningMemory
): ReviewQueueSections {
  const sections: ReviewQueueSections = {
    active: [],
    rework: [],
    reviewed: []
  };

  for (const cluster of clusters) {
    if (!cluster.reviewItem) {
      continue;
    }

    const section = toQueueSectionName(cluster, learningMemory);

    if (isStaleReviewItem(cluster)) {
      continue;
    }

    sections[section].push(cluster.reviewItem);
  }

  sections.active.sort(compareReviewItems);
  sections.rework.sort(compareReviewItems);

  let activeAutoDraftCount = 0;
  let activeLiveEventCount = 0;
  let activeRecurringPlannedEventCount = 0;
  const activePlannedEventFamilyCounts = new Map<string, number>();
  const activeDuplicateKeys = new Set<string>();
  const nextActive: ReviewHandoffItem[] = [];

  for (const item of sections.active) {
    const duplicateKey = buildReviewDuplicateKey(item);

    if (duplicateKey && activeDuplicateKeys.has(duplicateKey)) {
      parkActiveOverflow(
        sections,
        item,
        "Duplicate market contract candidate already active; keep this copy parked until the operator merges or deletes the overlap.",
        `Duplicate contract guard: parked duplicate key ${duplicateKey}.`
      );
      continue;
    }

    if (duplicateKey) {
      activeDuplicateKeys.add(duplicateKey);
    }

    const contractBlockers = reviewContractBlockers(item);

    if (contractBlockers.length > 0) {
      parkActiveOverflow(
        sections,
        item,
        `Contract incomplete before review: ${contractBlockers.join("; ")}.`,
        `Contract gate: ${contractBlockers.join("; ")}.`
      );
      continue;
    }

    if (isPlannedLane(item.intakeLane) && item.recurringTemplateId) {
      activeRecurringPlannedEventCount += 1;

      if (activeRecurringPlannedEventCount > ACTIVE_RECURRING_PLANNED_EVENT_LIMIT) {
        parkActiveOverflow(
          sections,
          item,
          `Planned lane capped at ${ACTIVE_RECURRING_PLANNED_EVENT_LIMIT} active recurring market(s); keep this item warmed but parked.`,
          `Planned cap: parked after ${ACTIVE_RECURRING_PLANNED_EVENT_LIMIT} active recurring candidate(s).`
        );
        continue;
      }
    }

    if (isPlannedLane(item.intakeLane) && item.lineageId) {
      const familyCount = activePlannedEventFamilyCounts.get(item.lineageId) ?? 0;

      if (familyCount >= ACTIVE_PLANNED_EVENT_FAMILY_LIMIT) {
        parkActiveOverflow(
          sections,
          item,
          `Recurring family live cap reached at ${ACTIVE_PLANNED_EVENT_FAMILY_LIMIT} active sibling market(s); keep this later sibling warmed but parked.`,
          `Recurring family cap: parked after ${ACTIVE_PLANNED_EVENT_FAMILY_LIMIT} active sibling market(s) in this series.`
        );
        continue;
      }

      activePlannedEventFamilyCounts.set(item.lineageId, familyCount + 1);
    }

    if (isLiveLane(item.intakeLane)) {
      activeLiveEventCount += 1;

      if (activeLiveEventCount > ACTIVE_LIVE_EVENT_LIMIT) {
        parkActiveOverflow(
          sections,
          item,
          `Live lane capped at ${ACTIVE_LIVE_EVENT_LIMIT} active fast-break candidate(s); keep this item parked until a cleaner opening appears.`,
          `Live cap: parked after ${ACTIVE_LIVE_EVENT_LIMIT} active breaking candidate(s).`
        );
        continue;
      }
    }

    if (item.draftedByEnrichment) {
      activeAutoDraftCount += 1;

      if (activeAutoDraftCount > ACTIVE_AUTO_DRAFT_LIMIT) {
        parkActiveOverflow(
          sections,
          item,
          `Auto-draft budget capped at ${ACTIVE_AUTO_DRAFT_LIMIT} active enrichment draft(s); keep this candidate parked for a later pass.`,
          `Auto-draft budget cap: parked after ${ACTIVE_AUTO_DRAFT_LIMIT} active enrichment draft(s).`
        );
        continue;
      }
    }

    nextActive.push(item);
  }

  sections.active = nextActive;
  sections.rework.sort(compareReviewItems);

  return sections;
}

export function buildReviewQueueFromClusters(
  clusters: ReviewQueueCluster[],
  learningMemory: ReviewLearningMemory
): ReviewHandoffItem[] {
  const sections = buildLayeredReviewQueueFromClusters(clusters, learningMemory);
  return [...sections.active, ...sections.rework];
}
