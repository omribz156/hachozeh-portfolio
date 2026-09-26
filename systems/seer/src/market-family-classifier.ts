import type {
  ConfidenceLabel,
  MarketFamilyClassification,
  MarketFamilyRegistryEntry,
  MarketFamilySourceCandidate,
  MarketMeasurementKind,
  MarketResultShape,
  ReviewFeedbackItem,
  ReviewHandoffItem,
  SourceRegistryEntry
} from "./contracts";
import type { MarketFamilyClassificationInput } from "./contracts";
import { seededMarketFamilyRegistry } from "./market-family-registry";
import { slugify } from "./text";

const categoryAliases: Record<string, string> = {
  economics: "economy",
  weather: "weather",
  climate: "weather",
  culture: "culture",
  entertainment: "culture",
  awards: "culture",
  sports: "sports",
  crypto: "crypto",
  politics: "politics",
  security: "security",
  legislation: "legislation",
  law: "legislation",
  technology: "technology",
  tech: "technology",
  health: "health",
  energy: "energy",
  education: "education",
  science: "technology",
  travel: "security"
};

function normalizeCategory(category: string | undefined): string {
  const normalized = category?.trim().toLowerCase() ?? "";
  return categoryAliases[normalized] ?? normalized;
}

function normalizedText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasKeyword(question: string, family: MarketFamilyRegistryEntry): boolean {
  const text = normalizedText(question);
  return (family.keywords ?? []).some((keyword) => text.includes(keyword.toLowerCase()));
}

function lifecycleCapabilityForRoute(
  sourceIds: string[],
  measurementKind: MarketMeasurementKind,
  resultShape: MarketResultShape,
  sourceRegistry: SourceRegistryEntry[]
): MarketFamilyClassification["oracleCapability"] {
  const requested = new Set(sourceIds);

  return sourceRegistry
    .filter((sourceEntry) => requested.has(sourceEntry.sourceId))
    .flatMap((sourceEntry) => sourceEntry.lifecycleCapabilities ?? [])
    .find(
      (capability) =>
        capability.measurementKind === measurementKind &&
        capability.resultShape === resultShape
    )?.oracleCapability;
}

function familySupportsSource(
  family: MarketFamilyRegistryEntry,
  sourceIds: string[],
  input?: Pick<MarketFamilyClassificationInput, "marketForm" | "measurementKind" | "resultShape">
): MarketFamilySourceCandidate | undefined {
  const candidates = family.sourceCandidates.filter((candidate) => sourceIds.includes(candidate.sourceId));
  const exact = candidates.find(
    (candidate) =>
      candidate.route.measurementKind === input?.measurementKind &&
      candidate.route.resultShape === input?.resultShape
  );

  if (exact) {
    return exact;
  }

  if (input?.marketForm === "binary" || input?.marketForm === "threshold") {
    return candidates.find((candidate) => candidate.route.resultShape === "yes_no") ?? candidates[0];
  }

  if (input?.marketForm === "multi-outcome" || input?.marketForm === "range") {
    return candidates.find((candidate) => candidate.route.resultShape === "multi_outcome") ?? candidates[0];
  }

  if (input?.marketForm === "date-bucket") {
    return candidates.find((candidate) => candidate.route.resultShape === "date_bucket") ?? candidates[0];
  }

  return candidates[0];
}

function scoreFamily(
  family: MarketFamilyRegistryEntry,
  input: MarketFamilyClassificationInput
): { score: number; reasons: string[]; strongSignal: boolean } {
  const sourceIds = input.sourceIds ?? [];
  const reasons: string[] = [];
  let score = 0;
  let strongSignal = false;

  if (input.recurringTemplateId && family.recurringTemplateIds?.includes(input.recurringTemplateId)) {
    score += 100;
    strongSignal = true;
    reasons.push(`recurring-template=${input.recurringTemplateId}`);
  }

  if (familySupportsSource(family, sourceIds, input)) {
    score += 45;
    strongSignal = true;
    reasons.push("source-family-match");
  }

  if (normalizeCategory(input.category) === family.category) {
    score += 8;
    reasons.push(`category=${family.category}`);
  }

  if (family.marketForms.includes(input.marketForm)) {
    score += 6;
    reasons.push(`market-form=${input.marketForm}`);
  }

  if (input.measurementKind && input.measurementKind === family.measurementKind) {
    score += 4;
    reasons.push(`measurement-kind=${input.measurementKind}`);
  }

  if (input.resultShape && input.resultShape === family.resultShape) {
    score += 4;
    reasons.push(`result-shape=${input.resultShape}`);
  }

  if (hasKeyword(input.question, family)) {
    score += 20;
    strongSignal = true;
    reasons.push("keyword-match");
  }

  return { score, reasons, strongSignal };
}

function chooseFamily(input: MarketFamilyClassificationInput): {
  family: MarketFamilyRegistryEntry | null;
  reasons: string[];
  confidence: ConfidenceLabel;
} {
  const scored = seededMarketFamilyRegistry
    .map((family) => ({ family, ...scoreFamily(family, input) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = scored[0];

  if (!best || !best.strongSignal) {
    return {
      family: null,
      reasons: best?.reasons ?? [],
      confidence: "low"
    };
  }

  return {
    family: best.family,
    reasons: best.reasons,
    confidence: confidenceForFamilyScore(best.score)
  };
}

function confidenceForFamilyScore(score: number): ConfidenceLabel {
  if (score >= 80) {
    return "high";
  }

  return score >= 40 ? "medium" : "low";
}

function operatorNextActionForStatus(
  status: MarketFamilyClassification["status"]
): MarketFamilyClassification["operatorNextAction"] {
  switch (status) {
    case "classified":
      return "operator_decide";
    case "source_family_needed":
      return "pick_source_family";
    case "adapter_needed":
      return "build_oracle_adapter";
    case "policy_review":
      return "policy_review";
    case "blocked":
      return "park_family";
    case "family_proposal":
    default:
      return "create_family_proposal";
  }
}

export function classifyMarketFamily(
  input: MarketFamilyClassificationInput,
  sourceRegistry: SourceRegistryEntry[]
): MarketFamilyClassification {
  const sourceIds = input.sourceIds ?? [];
  const { family, reasons, confidence } = chooseFamily(input);

  if (!family) {
    return {
      objectType: "market_family_classification",
      status: "family_proposal",
      familyKey: null,
      familyLabelHe: null,
      category: normalizeCategory(input.category) || input.category || "unknown",
      matchedSourceIds: sourceIds,
      operatorNextAction: "create_family_proposal",
      confidence,
      reasons: reasons.length ? reasons : ["no strong market-family match"],
      blockers: ["market-family-not-classified"]
    };
  }

  const matchedSource = familySupportsSource(family, sourceIds, input);
  const route = matchedSource?.route ?? {
    measurementKind: family.measurementKind,
    resultShape: family.resultShape
  };
  const registryCapability = lifecycleCapabilityForRoute(
    sourceIds,
    route.measurementKind,
    route.resultShape,
    sourceRegistry
  );
  const oracleCapability = registryCapability;
  let status: MarketFamilyClassification["status"] = "classified";
  const blockers: string[] = [];

  if (family.sensitivityLevel === "high" || input.sensitivityLevel === "high") {
    status = "policy_review";
    blockers.push("policy-review-required");
  } else if (sourceIds.length === 0) {
    status = "source_family_needed";
    blockers.push("source-family-needed");
  } else if (
    !matchedSource &&
    (oracleCapability === "supported_full_cycle" ||
      oracleCapability === "supported_final_only" ||
      oracleCapability === "credible_reporting")
  ) {
    status = "classified";
    blockers.length = 0;
  } else if (!matchedSource) {
    status = "adapter_needed";
    blockers.push("source-not-in-market-family");
  } else if (oracleCapability === "blocked") {
    status = "blocked";
    blockers.push("oracle-capability-blocked");
  } else if (oracleCapability === "credible_reporting") {
    status = "classified";
    blockers.length = 0;
  } else if (!oracleCapability || oracleCapability === "manual_resolution_required") {
    status = matchedSource.adapterReadiness === "policy_review" ? "policy_review" : "adapter_needed";
    blockers.push(oracleCapability === "manual_resolution_required" ? "manual-resolution-route" : "adapter-capability-missing");
  }

  return {
    objectType: "market_family_classification",
    status,
    familyKey: family.familyKey,
    familyLabelHe: family.labelHe,
    category: family.category,
    measurementKind: route.measurementKind,
    resultShape: route.resultShape,
    oracleCapability,
    matchedSourceIds: sourceIds.filter((sourceId) =>
      family.sourceCandidates.some((candidate) => candidate.sourceId === sourceId)
    ),
    operatorNextAction: operatorNextActionForStatus(status),
    confidence,
    reasons,
    blockers
  };
}

export function classifyReviewHandoffMarketFamily(
  item: ReviewHandoffItem,
  sourceRegistry: SourceRegistryEntry[],
  feedback?: ReviewFeedbackItem
): MarketFamilyClassification {
  return classifyMarketFamily(
    {
      category: feedback?.editedCategory?.trim() || item.category,
      question: feedback?.editedQuestion?.trim() || item.question,
      marketForm: item.marketForm,
      recurringTemplateId: item.recurringTemplateId,
      sourceIds: item.topSourceIds ?? item.contract?.resolutionSource.sourceIds,
      measurementKind: item.contract?.measurementKind,
      resultShape: item.contract?.resultShape,
      sensitivityLevel: item.sensitivityLevel,
      feedback
    },
    sourceRegistry
  );
}

export function buildMarketFamilyProposalKey(item: Pick<ReviewHandoffItem, "category" | "question">): string {
  return `family-proposal-${slugify(`${normalizeCategory(item.category)}-${item.question}`)}`;
}
