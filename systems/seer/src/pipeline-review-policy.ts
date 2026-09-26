import type {
  CandidateMarket,
  ConfidenceLabel,
  ProposedOutcome,
  RecommendedAction,
  WorthinessFailureReason
} from "./contracts";

function hasHebrewText(value: string | undefined): boolean {
  return /[\u0590-\u05ff]/u.test(value ?? "");
}

export function buildHebrewLocalizationRisks(question: string, outcomes: ProposedOutcome[]): string[] {
  const risks: string[] = [];

  if (!hasHebrewText(question)) {
    risks.push("hebrew-localization-needed: question must be Hebrew-first before approval.");
  }

  const nonHebrewOutcomes = outcomes
    .map((outcome) => outcome.label)
    .filter((label) => !hasHebrewText(label));

  if (nonHebrewOutcomes.length > 0) {
    risks.push(`hebrew-localization-needed: outcome labels need Hebrew display names (${nonHebrewOutcomes.join(", ")}).`);
  }

  return risks;
}

export function toHumanFailureReason(reason: WorthinessFailureReason): string {
  const labels: Record<WorthinessFailureReason, string> = {
    "stale-window": "timing window may be stale",
    "not-market-shaped": "market shape still too weak",
    "wording-too-vague": "wording still too vague",
    "outcomes-not-clean": "outcomes still need cleanup",
    "resolution-path-weak": "resolution path still weak",
    "relevance-too-low": "relevance still too low",
    "likely-duplicate": "duplicate pressure is high",
    "sensitivity-escalation": "sensitivity wants escalated review"
  };

  return labels[reason];
}

export function deriveRecommendedAction(
  failureReasons: WorthinessFailureReason[],
  readiness: ConfidenceLabel
): RecommendedAction {
  if (failureReasons.includes("sensitivity-escalation")) {
    return "escalate";
  }

  if (failureReasons.includes("likely-duplicate")) {
    return "merge";
  }

  if (failureReasons.includes("stale-window")) {
    return "hold";
  }

  if (failureReasons.includes("not-market-shaped") || failureReasons.includes("relevance-too-low")) {
    return "reject";
  }

  if (readiness === "high") {
    return "approve";
  }

  if (readiness === "medium") {
    return "approve-with-edits";
  }

  return "request-rework";
}

export function deriveCandidateStatus(action: RecommendedAction): CandidateMarket["status"] {
  if (action === "approve") return "review-ready";
  if (action === "approve-with-edits") return "grounded";
  if (action === "hold") return "held";
  if (action === "merge") return "merged";
  if (action === "reject") return "rejected";
  if (action === "escalate") return "escalated";
  return "rework-requested";
}

export function deriveActionWhy(action: RecommendedAction, failureReasons: WorthinessFailureReason[], summary: string): string {
  if (failureReasons.length === 0) {
    return summary;
  }

  const because = failureReasons.map(toHumanFailureReason).join("; ");

  if (action === "approve-with-edits" || action === "request-rework") {
    return `${summary} Main friction: ${because}.`;
  }

  return `Recommended ${action} because ${because}.`;
}
