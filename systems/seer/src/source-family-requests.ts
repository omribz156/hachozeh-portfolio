import type {
  MarketMeasurementKind,
  MarketResultShape,
  SourceFamilyRequest
} from "./contracts";
import type { MarketCreationReadinessItem } from "./creation-drafts";
import { slugify } from "./text";

export type BuildSourceFamilyRequestsOptions = {
  includeManual?: boolean;
};

function isReferenceOnlySource(item: MarketCreationReadinessItem): boolean {
  const sourceIds = item.contract?.resolutionSource.sourceIds ?? [];

  return (
    item.blockers.includes("reference-only-resolution-source") ||
    sourceIds.some((sourceId) => /polymarket|kalshi|reference/.test(sourceId))
  );
}

function isInternalHarnessSource(sourceId: string): boolean {
  return sourceId === "src_navi_gauntlet_control";
}

function sourceFamilyRequestStatus(
  item: MarketCreationReadinessItem
): SourceFamilyRequest["status"] | null {
  if (item.blockers.includes("missing-oracle-capability") || item.blockers.includes("market-family-adapter-needed")) {
    return "adapter_needed";
  }

  if (item.blockers.includes("oracle-capability-blocked")) {
    return "blocked_by_contract";
  }

  if (item.contract?.oracleCapability === "manual_resolution_required") {
    return "manual_resolution_requested";
  }

  return null;
}

function nextActionForStatus(
  status: SourceFamilyRequest["status"]
): SourceFamilyRequest["operatorNextAction"] {
  if (status === "adapter_needed") {
    return "run_oracle_capability_check";
  }

  if (status === "blocked_by_contract") {
    return "park_family";
  }

  return "run_oracle_capability_check";
}

function buildRequestKey(
  sourceId: string,
  measurementKind: MarketMeasurementKind,
  resultShape: MarketResultShape
): string {
  return `${sourceId}::${measurementKind}::${resultShape}`;
}

export function buildSourceFamilyRequestsFromReadiness(
  readinessItems: MarketCreationReadinessItem[],
  generatedAt: string,
  options: BuildSourceFamilyRequestsOptions = {}
): SourceFamilyRequest[] {
  const grouped = new Map<string, SourceFamilyRequest>();

  for (const item of readinessItems) {
    const contract = item.contract;
    const status = sourceFamilyRequestStatus(item);
    const sourceId = contract?.resolutionSource.sourceIds?.[0];

    if (
      !contract ||
      !status ||
      !sourceId ||
      !contract.measurementKind ||
      !contract.resultShape ||
      isReferenceOnlySource(item) ||
      isInternalHarnessSource(sourceId) ||
      (status === "manual_resolution_requested" && !options.includeManual)
    ) {
      continue;
    }

    const key = buildRequestKey(sourceId, contract.measurementKind, contract.resultShape);
    const existing = grouped.get(key);

    if (existing) {
      grouped.set(key, {
        ...existing,
        requestedByCandidateMarketIds: [
          ...new Set([...existing.requestedByCandidateMarketIds, item.candidateMarketId])
        ],
        requestedByReviewItemIds: [...new Set([...existing.requestedByReviewItemIds, item.reviewItemId])],
        exampleQuestions: [...new Set([...existing.exampleQuestions, item.question])],
        updatedAt: generatedAt
      });
      continue;
    }

    grouped.set(key, {
      objectType: "source_family_request",
      requestId: `sfr_${slugify(`${sourceId}_${contract.measurementKind}_${contract.resultShape}`)}`,
      sourceId,
      sourceLabel: contract.resolutionSource.label,
      sourceUrl: contract.resolutionSource.url,
      measurementKind: contract.measurementKind,
      resultShape: contract.resultShape,
      resolutionAuthorityType: contract.resolutionAuthorityType,
      status,
      marketFamilyKey: item.familyClassification?.familyKey ?? undefined,
      marketFamilyLabelHe: item.familyClassification?.familyLabelHe ?? undefined,
      marketFamilyClassificationStatus: item.familyClassification?.status,
      requestedByCandidateMarketIds: [item.candidateMarketId],
      requestedByReviewItemIds: [item.reviewItemId],
      exampleQuestions: [item.question],
      operatorNextAction: nextActionForStatus(status),
      createdAt: generatedAt,
      updatedAt: generatedAt,
      notes: [
        "Operator/Codex handoff: run Oracle capability-check before making this family publishable.",
        ...(item.familyClassification?.familyKey
          ? [`market-family=${item.familyClassification.familyKey}`]
          : [])
      ]
    });
  }

  return [...grouped.values()].sort((left, right) => left.requestId.localeCompare(right.requestId));
}
