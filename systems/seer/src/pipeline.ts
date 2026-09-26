import type {
  CandidateMarket,
  ConfidenceLabel,
  IntakeLane,
  LineageRef,
  PlatformShapeExample,
  ReviewHandoffItem,
  TrackedEvent,
  TrackedEventMaturity,
  WorthinessFailureReason
} from "./contracts";
import { deriveDuplicateAssessment, deriveLineageContext } from "./duplicate-assessment";
import { isLiveLane, isPlannedLane, normalizeIntakeLane } from "./intake-lanes";
import { describeRecurringTemplate } from "./planned-event-templates";
import { slugify } from "./text";
import { assessMarketWorthiness } from "./market-worthiness";
import { buildMarketContractV1 } from "./market-contract";
import { readLatestPlatformShapeSnapshots, readManualSeerSignals } from "./persistence";
import { buildReviewQueueFromClusters as buildReviewQueueFromClusterItems } from "./pipeline-review-queue";
import { buildReviewLearningMemory, type ReviewLearningMemory } from "./review-memory";
import { seerSeedSignals } from "./seed-signals";
import {
  normalizeManualSignal,
  normalizeSeedSignal,
  type SeerSignal
} from "./signal-normalization";
import { deriveSourceRolePlan } from "./pipeline-source-role-plan";
import {
  extractFetchNeeds,
  pickPrimarySignal,
  pickProposalSignal
} from "./pipeline-signal-ranking";
import {
  buildHebrewLocalizationRisks,
  deriveActionWhy,
  deriveCandidateStatus,
  deriveRecommendedAction,
  toHumanFailureReason
} from "./pipeline-review-policy";
import { listSeerSources } from "./source-registry";

export { buildLayeredReviewQueueFromClusters, buildReviewQueueFromClusters } from "./pipeline-review-queue";
export type { SeerSignal } from "./signal-normalization";

type SeerCluster = {
  clusterKey: string;
  signals: SeerSignal[];
  lineage: LineageRef;
  trackedEvent: TrackedEvent;
  candidateMarket?: CandidateMarket;
  reviewItem?: ReviewHandoffItem;
};

export type SeerRuntimeContext = {
  learningMemory: ReviewLearningMemory;
  platformShapeExamples: PlatformShapeExample[];
};

const PRIORITY_SEER_CATEGORIES = new Set(["economy", "economics", "sports", "politics", "weather", "crypto"]);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isPrioritySeerCategory(category: string | undefined): boolean {
  return Boolean(category && PRIORITY_SEER_CATEGORIES.has(category.trim().toLowerCase()));
}

function deriveClusterIntakeLane(signals: SeerSignal[]): IntakeLane {
  return signals.some((signal) => isPlannedLane(signal.intakeLane)) ? "planned" : "live";
}

function toConfidence(signalCount: number): ConfidenceLabel {
  if (signalCount >= 3) return "high";
  if (signalCount >= 2) return "medium";
  return "low";
}

function toMaturity(signalCount: number): TrackedEventMaturity {
  if (signalCount >= 3) return "grounded";
  if (signalCount >= 2) return "developing";
  return "emerging";
}

function buildLiveEventGroundingNeeds(signals: SeerSignal[]): string[] {
  const sourceClassesSeen = new Set(signals.map((signal) => signal.sourceClass));
  const notes = signals.flatMap((signal) => [...(signal.ambiguityNotes ?? []), ...(signal.riskFlags ?? [])]);
  const fetchNeeds = unique(notes.flatMap((note) => extractFetchNeeds([note])));
  const needs = [...fetchNeeds];

  if (!sourceClassesSeen.has("authority") && !sourceClassesSeen.has("context")) {
    needs.push("credible-or-official-grounding-source");
  }

  if (!signals.some((signal) => signal.suggestedResolutionAnchor)) {
    needs.push("resolution-source-anchor");
  }

  if (!signals.some((signal) => signal.suggestedCloseShape)) {
    needs.push("timeline-close-shape");
  }

  return unique(needs);
}

function buildLiveEventUnderstanding(signals: SeerSignal[], authorityReadiness: ConfidenceLabel): TrackedEvent["liveEvent"] {
  const primary = pickPrimarySignal(signals);
  const proposal = pickProposalSignal(signals);
  const groundingNeeds = buildLiveEventGroundingNeeds(signals);
  const sourceRefs = unique(signals.map((signal) => signal.sourceRef).filter((value) => value.length > 0));
  const sourceIds = unique(signals.map((signal) => signal.sourceId));
  const marketability = proposal?.marketability ?? primary.marketability;
  const nextGate =
    groundingNeeds.length > 0
      ? "ground-sources"
      : proposal?.question
        ? "review-ready"
        : marketability === "watch-only"
          ? "park"
          : "shape-market";

  return {
    objectType: "live_event_understanding_v0",
    claim: proposal?.question ?? primary.summary,
    observedAt: primary.observedAt,
    evidenceRefs: sourceRefs,
    evidenceSourceIds: sourceIds,
    groundingNeeds,
    marketability,
    authorityReadiness,
    nextGate,
    notes: [
      "live-event-v0: tracked_event compatibility object",
      ...(sourceRefs.length === 0 ? ["missing-evidence-ref"] : [])
    ]
  };
}

function nonFetchNotes(notes?: string[]): string[] {
  return (notes ?? []).filter((note) => !/^fetch-needed=/i.test(note));
}

function normalizeLineageIdSegment(lineageLabel: string): string {
  const slug = slugify(lineageLabel);
  return slug.startsWith("lin_") ? slug.slice(4) : slug;
}

function keepSharedAmbiguityNote(note: string): boolean {
  return (
    !note.startsWith("grounding: canonical-sides=") &&
    !note.startsWith("grounding: competition=") &&
    !note.startsWith("grounding: event-date=") &&
    !note.startsWith("grounding: fixture-context=") &&
    !/^fetch-needed=/i.test(note)
  );
}

function groupSignals(signals: SeerSignal[]): SeerSignal[][] {
  const groups = new Map<string, SeerSignal[]>();

  for (const signal of signals) {
    const bucket = groups.get(signal.clusterKey) ?? [];
    bucket.push(signal);
    groups.set(signal.clusterKey, bucket);
  }

  return [...groups.values()];
}

function buildReviewHints(
  cluster: SeerCluster,
  learningMemory: ReviewLearningMemory,
  platformShapeExamples: PlatformShapeExample[]
): string[] | undefined {
  if (!cluster.candidateMarket) {
    return undefined;
  }

  const hints: string[] = [];
  const recurringTemplateId = cluster.candidateMarket.recurringTemplateId;

  if (recurringTemplateId) {
    hints.push(describeRecurringTemplate(recurringTemplateId));
  }

  const lineageMemory = learningMemory.lineageMemory.get(cluster.lineage.lineageId);

  if (lineageMemory?.approveCount) {
    hints.push(`Lineage memory: ${lineageMemory.approveCount} prior positive review actions in this story family.`);
  }

  if (lineageMemory?.duplicateCount) {
    hints.push(`Lineage memory: duplicate pressure already showed up ${lineageMemory.duplicateCount} time(s).`);
  }

  const sourceNotes = cluster.candidateMarket.topSourceIds
    ?.map((sourceId) => learningMemory.sourceMemory.get(sourceId))
    .filter((memory): memory is NonNullable<typeof memory> => Boolean(memory))
    .filter((memory) => memory.approveCount > 0);

  if (sourceNotes && sourceNotes.length > 0) {
    hints.push("Source memory: this source mix has prior positive review signal.");
  }

  const candidateCategory = cluster.candidateMarket.category.trim().toLowerCase();
  const categoryScopedExamples = platformShapeExamples.filter(
    (example) => example.category?.trim().toLowerCase() === candidateCategory
  );
  const scopedExamples = categoryScopedExamples.length > 0 ? categoryScopedExamples : platformShapeExamples;
  const platformMatches = scopedExamples.filter((example) => example.marketForm === cluster.candidateMarket?.marketForm);

  if (platformMatches.length > 0) {
    hints.push(
      categoryScopedExamples.length > 0
        ? `Platform shape memory: ${platformMatches.length} recent Polymarket/Kalshi reference example(s) in ${cluster.candidateMarket.category} share this ${cluster.candidateMarket.marketForm} form.`
        : `Platform shape memory: ${platformMatches.length} recent Polymarket/Kalshi reference example(s) share this ${cluster.candidateMarket.marketForm} form.`
    );
  }

  return hints.length > 0 ? hints : undefined;
}

function buildCluster(signals: SeerSignal[]): SeerCluster {
  const primary = pickPrimarySignal(signals);
  const proposalSignal = pickProposalSignal(signals);
  const intakeLane = deriveClusterIntakeLane(signals);
  const sourceRefs = unique(signals.map((signal) => signal.sourceRef));
  const sourceIds = unique(signals.map((signal) => signal.sourceId));
  const sourceClassesSeen = unique(signals.map((signal) => signal.sourceClass));
  const authorityReadiness: ConfidenceLabel = sourceClassesSeen.includes("authority") ? "high" : "medium";
  const signalCount = signals.length;
  const observedAt = signals.map((signal) => signal.observedAt).sort();
  const createdAt = observedAt[0]!;
  const updatedAt = observedAt[observedAt.length - 1]!;
  const lineageId = `lin_${normalizeLineageIdSegment(primary.lineageLabel)}`;
  const trackedEventId = `evt_${slugify(primary.clusterKey)}`;
  const candidateMarketId = `cm_${slugify(primary.clusterKey)}`;
  const reviewItemId = `rh_${slugify(primary.clusterKey)}`;
  const sharedAmbiguities = unique(signals.flatMap((signal) => (signal.ambiguityNotes ?? []).filter(keepSharedAmbiguityNote)));
  const ambiguities = unique([...(proposalSignal?.ambiguityNotes ?? primary.ambiguityNotes ?? []), ...sharedAmbiguities]);
  const riskFlags = unique(signals.flatMap((signal) => signal.riskFlags ?? []));
  const fetchNeeds = extractFetchNeeds(ambiguities);
  const topSupport = unique(signals.map((signal) => signal.sourceSummary)).join(" | ");
  const candidateMarket: CandidateMarket | undefined = proposalSignal && isPrioritySeerCategory(proposalSignal.category)
      ? {
        objectType: "candidate_market" as const,
        candidateMarketId,
        trackedEventId,
        intakeLane,
        recurringTemplateId: proposalSignal.recurringTemplateId,
        lineageId,
        question: proposalSignal.question!,
        marketAngle: proposalSignal.marketAngle ?? `Market draft around ${proposalSignal.title}.`,
        marketForm: proposalSignal.marketForm!,
        proposedOutcomes: proposalSignal.proposedOutcomes!,
        category: proposalSignal.category,
        status: "candidate" as const,
        whyNow: proposalSignal.whyNow,
        marketWorthiness:
          proposalSignal.marketWorthiness ??
          "Signal cluster has enough shape for review, but wording or authority may still need polish.",
        resolutionFeasibility:
          proposalSignal.resolutionFeasibility ?? "Resolution path still needs a stronger anchor before publish.",
        authorityReadiness,
        sourceSummary: topSupport,
        duplicateAssessment: "distinct" as const,
        sensitivityLevel: proposalSignal.sensitivityLevel ?? "normal",
        ambiguities,
        riskFlags,
        fetchNeeds,
        sourceRolePlan: undefined,
        worthinessAssessment: assessMarketWorthiness({
          observedAt: updatedAt,
          signalCount,
          question: proposalSignal.question,
          marketAngle: proposalSignal.marketAngle,
          marketForm: proposalSignal.marketForm,
          proposedOutcomes: proposalSignal.proposedOutcomes,
          resolutionFeasibility: proposalSignal.resolutionFeasibility,
          suggestedResolutionAnchor: proposalSignal.suggestedResolutionAnchor,
          suggestedCloseShape: proposalSignal.suggestedCloseShape,
          sourceClassesSeen,
          category: proposalSignal.category,
          duplicateAssessment: "distinct",
          sensitivityLevel: proposalSignal.sensitivityLevel ?? "normal",
          ambiguities,
          riskFlags
        }),
        suggestedCloseShape: proposalSignal.suggestedCloseShape,
        suggestedResolutionAnchor: proposalSignal.suggestedResolutionAnchor,
        topSourceRefs: sourceRefs,
        topSourceIds: sourceIds,
        draftedByEnrichment: proposalSignal.draftedByEnrichment,
        notes: proposalSignal.draftedByEnrichment ? ["drafted-by-signal-enrichment"] : undefined,
        createdAt,
        updatedAt
      }
    : undefined;
  const sourceRolePlan = candidateMarket ? deriveSourceRolePlan(signals, candidateMarket) : undefined;
  const contract =
    candidateMarket && sourceRolePlan
      ? buildMarketContractV1({
          question: candidateMarket.question,
          category: candidateMarket.category,
          marketForm: candidateMarket.marketForm,
          proposedOutcomes: candidateMarket.proposedOutcomes,
          suggestedCloseShape: candidateMarket.suggestedCloseShape,
          suggestedResolutionAnchor: candidateMarket.suggestedResolutionAnchor,
          sourceRolePlan,
          fetchNeeds: candidateMarket.fetchNeeds,
          topSourceIds: candidateMarket.topSourceIds,
          topSourceRefs: candidateMarket.topSourceRefs,
          topRisks: unique([...candidateMarket.ambiguities, ...candidateMarket.riskFlags]),
          resolutionRule: candidateMarket.resolutionFeasibility
        })
      : undefined;
  const reviewItem: ReviewHandoffItem | undefined = candidateMarket
      ? {
        objectType: "review_handoff_item" as const,
        reviewItemId,
        candidateMarketId,
        intakeLane,
        recurringTemplateId: candidateMarket.recurringTemplateId,
        lineageId,
        category: candidateMarket.category,
        headline: `Review: ${primary.title}`,
        question: candidateMarket.question,
        marketForm: candidateMarket.marketForm,
        proposedOutcomes: candidateMarket.proposedOutcomes,
        whyNow: candidateMarket.whyNow,
        decisionSummary: candidateMarket.worthinessAssessment.summary,
        maturity: candidateMarket.worthinessAssessment.reviewReadiness === "high" ? ("review-ready" as const) : ("grounded" as const),
        confidence: toConfidence(signalCount),
        authorityReadiness: candidateMarket.authorityReadiness,
        lineageContext: "new-market" as const,
        topSupport,
        topRisks: [],
        fetchNeeds: candidateMarket.fetchNeeds,
        sourceRolePlan,
        contract,
        marketShaping: candidateMarket.worthinessAssessment.marketShaping,
        recommendedAction: "approve" as const,
        recommendedActionWhy: candidateMarket.worthinessAssessment.summary,
        worthinessSummary: candidateMarket.worthinessAssessment.summary,
        failureReasons: candidateMarket.worthinessAssessment.failureReasons,
        suggestedCloseShape: candidateMarket.suggestedCloseShape,
        suggestedResolutionAnchor: candidateMarket.suggestedResolutionAnchor,
        sensitivityLevel: candidateMarket.sensitivityLevel,
        topSourceRefs: sourceRefs,
        topSourceIds: sourceIds,
        draftedByEnrichment: candidateMarket.draftedByEnrichment,
        createdAt
      }
    : undefined;

  if (candidateMarket && sourceRolePlan) {
    candidateMarket.sourceRolePlan = sourceRolePlan;
    candidateMarket.contract = contract;
  }

  return {
    clusterKey: primary.clusterKey,
    signals,
    lineage: {
      objectType: "lineage_ref",
      lineageId,
      lineageLabel: primary.lineageLabel,
      category: primary.category,
      status: "active",
      lineageSummary: `${primary.title} and closely related follow-up markets.`,
      currentFocus: primary.title,
      keyEntities: unique(signals.flatMap((signal) => signal.keyEntities)),
      relatedCandidateIds: candidateMarket ? [candidateMarketId] : [],
      createdAt,
      updatedAt,
      lastHeartbeatAt: updatedAt
    },
    trackedEvent: {
      objectType: "tracked_event",
      trackedEventId,
      eventLane: normalizeIntakeLane(intakeLane),
      lineageId,
      title: primary.title,
      summary: primary.summary,
      category: primary.category,
      status: "active",
      maturity: toMaturity(signalCount),
      signalStrength: toConfidence(signalCount),
      relevanceStrength: "high",
      sourceClassesSeen,
      whyNow: primary.whyNow,
      lastObservedAt: updatedAt,
      nextSuggestedAction: proposalSignal ? "propose-market" : "keep-watching",
      createdAt,
      updatedAt,
      keyEntities: unique(signals.flatMap((signal) => signal.keyEntities)),
      topSourceRefs: sourceRefs,
      liveEvent: isLiveLane(intakeLane) ? buildLiveEventUnderstanding(signals, authorityReadiness) : undefined,
      notes: proposalSignal
        ? undefined
        : unique([
            "Cluster is visible in tracking but still lacks enough market-shape detail for proposal.",
            ...signals.flatMap((signal) => signal.inferenceNotes)
          ])
    },
    candidateMarket,
    reviewItem
  };
}

export function enrichSeerClusters(clusters: SeerCluster[], learningMemory: ReviewLearningMemory): SeerCluster[] {
  return enrichSeerClustersWithRuntime(clusters, learningMemory, []);
}

export function enrichSeerClustersWithRuntime(
  clusters: SeerCluster[],
  learningMemory: ReviewLearningMemory,
  platformShapeExamples: PlatformShapeExample[]
): SeerCluster[] {
  return clusters.map((cluster) => {
    if (!cluster.candidateMarket || !cluster.reviewItem) {
      return cluster;
    }

    const candidateMemory = learningMemory.candidateMemory.get(cluster.candidateMarket.candidateMarketId);
    const revisedQuestion = candidateMemory?.revisedQuestion?.trim();
    const revisedMarketForm = candidateMemory?.revisedMarketForm;
    const revisedOutcomes = candidateMemory?.revisedOutcomes?.length ? candidateMemory.revisedOutcomes : undefined;
    const candidateMarket = {
      ...cluster.candidateMarket,
      question: revisedQuestion ?? cluster.candidateMarket.question,
      marketForm: revisedMarketForm ?? cluster.candidateMarket.marketForm,
      proposedOutcomes: revisedOutcomes ?? cluster.candidateMarket.proposedOutcomes
    };
    const reviewItem = {
      ...cluster.reviewItem,
      question: revisedQuestion ?? cluster.reviewItem.question,
      marketForm: revisedMarketForm ?? cluster.reviewItem.marketForm,
      proposedOutcomes: revisedOutcomes ?? cluster.reviewItem.proposedOutcomes
    };
    const hebrewLocalizationRisks = buildHebrewLocalizationRisks(
      candidateMarket.question,
      candidateMarket.proposedOutcomes
    );
    const peers = clusters.filter(
      (other) => other.clusterKey !== cluster.clusterKey && other.lineage.lineageId === cluster.lineage.lineageId && other.candidateMarket
    );
    const duplicateAssessment = deriveDuplicateAssessment(cluster, clusters, learningMemory);
    const worthinessAssessment = assessMarketWorthiness({
      observedAt: cluster.trackedEvent.lastObservedAt,
      signalCount: cluster.signals.length,
      question: candidateMarket.question,
      marketAngle: candidateMarket.marketAngle,
      marketForm: candidateMarket.marketForm,
      proposedOutcomes: candidateMarket.proposedOutcomes,
      resolutionFeasibility: candidateMarket.resolutionFeasibility,
      suggestedResolutionAnchor: candidateMarket.suggestedResolutionAnchor,
      suggestedCloseShape: candidateMarket.suggestedCloseShape,
      sourceClassesSeen: cluster.trackedEvent.sourceClassesSeen,
      category: candidateMarket.category,
      platformShapeExamples,
      duplicateAssessment,
      sensitivityLevel: candidateMarket.sensitivityLevel,
      ambiguities: candidateMarket.ambiguities,
      riskFlags: candidateMarket.riskFlags
    });
    const recommendedAction = deriveRecommendedAction(worthinessAssessment.failureReasons, worthinessAssessment.reviewReadiness);
    const reviewHints = buildReviewHints(cluster, learningMemory, platformShapeExamples);
    const lineageMemory = learningMemory.lineageMemory.get(cluster.lineage.lineageId);
    const topRisks = unique([
      ...nonFetchNotes(candidateMarket.ambiguities),
      ...candidateMarket.riskFlags,
      ...hebrewLocalizationRisks,
      ...worthinessAssessment.failureReasons.map(toHumanFailureReason)
    ]);
    const sourceRolePlan = deriveSourceRolePlan(cluster.signals, {
      ...candidateMarket,
      status: deriveCandidateStatus(recommendedAction),
      duplicateAssessment,
      worthinessAssessment
    });
    const contract = buildMarketContractV1({
      question: candidateMarket.question,
      category: candidateMarket.category,
      marketForm: candidateMarket.marketForm,
      proposedOutcomes: candidateMarket.proposedOutcomes,
      suggestedCloseShape: candidateMarket.suggestedCloseShape,
      suggestedResolutionAnchor: candidateMarket.suggestedResolutionAnchor,
      sourceRolePlan,
        fetchNeeds: candidateMarket.fetchNeeds,
        topSourceIds: candidateMarket.topSourceIds,
        topSourceRefs: candidateMarket.topSourceRefs,
        topRisks,
        resolutionRule: candidateMarket.resolutionFeasibility
      });
    const nextSuggestedAction =
      recommendedAction === "merge"
        ? "merge"
        : recommendedAction === "escalate"
          ? "escalate"
          : cluster.candidateMarket
            ? "propose-market"
            : "keep-watching";

    return {
      ...cluster,
      lineage: {
        ...cluster.lineage,
        status:
          (lineageMemory?.rejectCount ?? 0) > (lineageMemory?.approveCount ?? 0) && peers.length === 0 ? "cooling" : "active",
        notes: lineageMemory?.duplicateCount ? [`duplicate-memory=${lineageMemory.duplicateCount}`] : cluster.lineage.notes
      },
      trackedEvent: {
        ...cluster.trackedEvent,
        nextSuggestedAction
      },
      candidateMarket: {
        ...candidateMarket,
        status: deriveCandidateStatus(recommendedAction),
        duplicateAssessment,
        worthinessAssessment,
        riskFlags: unique([...candidateMarket.riskFlags, ...hebrewLocalizationRisks]),
        marketShaping: worthinessAssessment.marketShaping,
        sourceRolePlan,
        contract
      },
      reviewItem: {
        ...reviewItem,
        maturity: worthinessAssessment.reviewReadiness === "high" ? "review-ready" : "grounded",
        lineageContext: deriveLineageContext(duplicateAssessment, peers.length),
        topRisks,
        fetchNeeds: candidateMarket.fetchNeeds,
        sourceRolePlan,
        contract,
        marketShaping: worthinessAssessment.marketShaping,
        recommendedAction,
        recommendedActionWhy: deriveActionWhy(recommendedAction, worthinessAssessment.failureReasons, worthinessAssessment.summary),
        worthinessSummary: worthinessAssessment.summary,
        failureReasons: worthinessAssessment.failureReasons,
        reviewHints: unique([
          ...(reviewHints ?? []),
          ...(candidateMemory?.reworkSummary ? [candidateMemory.reworkSummary] : []),
          ...(candidateMemory?.requiredChanges?.length
            ? [`Rework target: ${candidateMemory.requiredChanges.join(" | ")}`]
            : []),
          ...hebrewLocalizationRisks
        ])
      }
    };
  });
}

export function buildSeerClustersFromSignals(
  signals: SeerSignal[],
  learningMemory: ReviewLearningMemory
): SeerCluster[] {
  return enrichSeerClustersWithRuntime(groupSignals(signals).map(buildCluster), learningMemory, []);
}

export function buildSeerClustersFromSignalsWithRuntime(
  signals: SeerSignal[],
  learningMemory: ReviewLearningMemory,
  platformShapeExamples: PlatformShapeExample[]
): SeerCluster[] {
  return enrichSeerClustersWithRuntime(groupSignals(signals).map(buildCluster), learningMemory, platformShapeExamples);
}

async function buildSeerRuntimeContext(): Promise<SeerRuntimeContext> {
  const sources = await listSeerSources();
  const learningMemory = await buildReviewLearningMemory(sources);
  const platformShapeSnapshots = await readLatestPlatformShapeSnapshots();

  return {
    learningMemory,
    platformShapeExamples: platformShapeSnapshots.flatMap((snapshot) => snapshot.examples)
  };
}

function mergeLineages(clusters: SeerCluster[]): LineageRef[] {
  const merged = new Map<string, LineageRef>();

  for (const cluster of clusters) {
    const existing = merged.get(cluster.lineage.lineageId);
    const nextCandidateIds = cluster.candidateMarket ? [cluster.candidateMarket.candidateMarketId] : [];

    if (!existing) {
      merged.set(cluster.lineage.lineageId, {
        ...cluster.lineage,
        relatedCandidateIds: nextCandidateIds
      });
      continue;
    }

    merged.set(cluster.lineage.lineageId, {
      ...existing,
      status: existing.status === "active" || cluster.lineage.status === "active" ? "active" : cluster.lineage.status,
      currentFocus:
        Date.parse(cluster.lineage.updatedAt) >= Date.parse(existing.updatedAt) ? cluster.lineage.currentFocus : existing.currentFocus,
      keyEntities: unique([...(existing.keyEntities ?? []), ...(cluster.lineage.keyEntities ?? [])]),
      relatedCandidateIds: unique([...(existing.relatedCandidateIds ?? []), ...nextCandidateIds]),
      updatedAt: Date.parse(cluster.lineage.updatedAt) >= Date.parse(existing.updatedAt) ? cluster.lineage.updatedAt : existing.updatedAt,
      lastHeartbeatAt:
        Date.parse(cluster.lineage.lastHeartbeatAt ?? cluster.lineage.updatedAt) >=
        Date.parse(existing.lastHeartbeatAt ?? existing.updatedAt)
          ? cluster.lineage.lastHeartbeatAt ?? cluster.lineage.updatedAt
          : existing.lastHeartbeatAt ?? existing.updatedAt
    });
  }

  return [...merged.values()];
}

export async function scanSeerSignals(): Promise<SeerSignal[]> {
  const manualSignals = await readManualSeerSignals();
  const normalizedManualSignals: SeerSignal[] = [];

  for (const signal of manualSignals) {
    normalizedManualSignals.push(await normalizeManualSignal(signal));
  }

  return [...seerSeedSignals.map(normalizeSeedSignal), ...normalizedManualSignals].sort(
    (left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)
  );
}

export async function buildSeerClusters(): Promise<SeerCluster[]> {
  const signals = await scanSeerSignals();
  const { learningMemory, platformShapeExamples } = await buildSeerRuntimeContext();
  return buildSeerClustersFromSignalsWithRuntime(signals, learningMemory, platformShapeExamples);
}

export async function buildSeerLineages(): Promise<LineageRef[]> {
  return mergeLineages(await buildSeerClusters());
}

export async function buildTrackedEvents(): Promise<TrackedEvent[]> {
  return (await buildSeerClusters()).map((cluster) => cluster.trackedEvent);
}

export async function buildCandidateMarkets(): Promise<CandidateMarket[]> {
  return (await buildSeerClusters())
    .map((cluster) => cluster.candidateMarket)
    .filter((market): market is CandidateMarket => Boolean(market));
}

export async function buildReviewQueue(): Promise<ReviewHandoffItem[]> {
  const clusters = await buildSeerClusters();
  const { learningMemory } = await buildSeerRuntimeContext();

  return buildReviewQueueFromClusterItems(clusters, learningMemory);
}
