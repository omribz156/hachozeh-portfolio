import type {
  CandidateMarket,
  DuplicateAssessment,
  LineageContext,
  LineageRef
} from "./contracts";
import { extractCutoffLabelFromCloseShape } from "./market-cutoff-labels";
import type { ReviewLearningMemory } from "./review-memory";

type DuplicateAssessmentCluster = {
  clusterKey: string;
  lineage: Pick<LineageRef, "lineageId">;
  candidateMarket?: Pick<
    CandidateMarket,
    "candidateMarketId" | "question" | "recurringTemplateId" | "suggestedCloseShape"
  >;
};

function questionTokens(question: string | undefined): string[] {
  if (!question) {
    return [];
  }

  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["what", "will", "which", "with", "that", "their", "from"].includes(token));
}

function monthTokens(question: string | undefined): string[] {
  if (!question) {
    return [];
  }

  const knownMonths = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ];

  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => knownMonths.includes(token));
}

function overlapRatio(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const denominator = Math.max(leftSet.size, rightSet.size);

  return denominator === 0 ? 0 : intersection / denominator;
}

export function deriveDuplicateAssessment(
  cluster: DuplicateAssessmentCluster,
  allClusters: DuplicateAssessmentCluster[],
  learningMemory: ReviewLearningMemory
): DuplicateAssessment {
  if (!cluster.candidateMarket) {
    return "distinct";
  }

  const existingFeedback = learningMemory.candidateMemory.get(cluster.candidateMarket.candidateMarketId);

  if (existingFeedback?.reasonCategory === "duplicate-or-overlap" || existingFeedback?.action === "merge") {
    return "likely-duplicate";
  }

  const peers = allClusters.filter(
    (other) => other.clusterKey !== cluster.clusterKey && other.lineage.lineageId === cluster.lineage.lineageId && other.candidateMarket
  );

  if (peers.length === 0) {
    return "distinct";
  }

  const currentCutoffLabel = extractCutoffLabelFromCloseShape(cluster.candidateMarket.suggestedCloseShape);
  const hasDistinctCutoffPeer = peers.some((peer) => {
    const peerCutoffLabel = extractCutoffLabelFromCloseShape(peer.candidateMarket?.suggestedCloseShape);
    return Boolean(currentCutoffLabel && peerCutoffLabel && currentCutoffLabel !== peerCutoffLabel);
  });

  if (cluster.candidateMarket.recurringTemplateId && hasDistinctCutoffPeer) {
    return "follow-up-branch";
  }

  const currentTokens = questionTokens(cluster.candidateMarket.question);
  const currentMonths = monthTokens(cluster.candidateMarket.question);
  const strongestPeerOverlap = peers.reduce((best, peer) => {
    const overlap = overlapRatio(currentTokens, questionTokens(peer.candidateMarket?.question));
    return overlap > best ? overlap : best;
  }, 0);
  const hasDistinctMonthPeer = peers.some((peer) => {
    const peerMonths = monthTokens(peer.candidateMarket?.question);

    return currentMonths.length > 0 && peerMonths.length > 0 && currentMonths.some((month) => !peerMonths.includes(month));
  });
  const lineageMemory = learningMemory.lineageMemory.get(cluster.lineage.lineageId);

  if (strongestPeerOverlap >= 0.75) {
    return "likely-duplicate";
  }

  if (strongestPeerOverlap >= 0.45) {
    if (hasDistinctMonthPeer && strongestPeerOverlap < 0.8) {
      return "follow-up-branch";
    }

    return "close-sibling";
  }

  if (strongestPeerOverlap >= 0.25 && (lineageMemory?.duplicateCount ?? 0) > 0) {
    return "close-sibling";
  }

  return "follow-up-branch";
}

export function deriveLineageContext(duplicateAssessment: DuplicateAssessment, siblingCount: number): LineageContext {
  if (duplicateAssessment === "likely-duplicate") {
    return "possible-duplicate";
  }

  if (duplicateAssessment === "follow-up-branch") {
    return "follow-up-branch";
  }

  if (siblingCount > 0) {
    return "sibling-candidate";
  }

  return "new-market";
}
