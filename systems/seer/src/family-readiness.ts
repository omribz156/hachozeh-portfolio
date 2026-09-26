import type {
  MarketFamilyRegistryEntry,
  MarketFamilySourceCandidate,
  MarketMeasurementKind,
  MarketResultShape,
  OracleCapabilityStatus,
  SourceRegistryEntry
} from "./contracts";

export type FamilyReadinessStatus =
  | "supported_full_cycle"
  | "supported_final_only"
  | "credible_reporting"
  | "manual_resolution_required"
  | "blocked"
  | "policy_review"
  | "adapter_needed"
  | "source_registry_missing"
  | "source_registry_missing_capability";

export type FamilyReadinessSourceRoute = {
  objectType: "family_readiness_source_route";
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string | null;
  measurementKind: MarketMeasurementKind;
  resultShape: MarketResultShape;
  adapterReadiness: MarketFamilySourceCandidate["adapterReadiness"];
  registryStatus: SourceRegistryEntry["status"] | null;
  oracleCapability: OracleCapabilityStatus | null;
  readinessStatus: FamilyReadinessStatus;
  operatorNextAction:
    | "ready_to_create"
    | "build_oracle_adapter"
    | "survey_source"
    | "update_source_registry"
    | "policy_review"
    | "park_family";
  notes: string[];
};

export type FamilyReadinessItem = {
  objectType: "family_readiness_item";
  familyKey: string;
  category: string;
  labelHe: string;
  labelEn: string;
  marketForms: MarketFamilyRegistryEntry["marketForms"];
  sensitivityLevel: MarketFamilyRegistryEntry["sensitivityLevel"];
  sourceRoutes: FamilyReadinessSourceRoute[];
  bestReadinessStatus: FamilyReadinessStatus;
  operatorNextAction:
    | "ready_to_create"
    | "build_oracle_adapter"
    | "survey_source"
    | "update_source_registry"
    | "policy_review"
    | "park_family";
};

export type FamilyReadinessSnapshot = {
  objectType: "family_readiness_snapshot";
  generatedAt: string;
  familyCount: number;
  routeCount: number;
  statusCounts: Record<FamilyReadinessStatus, number>;
  items: FamilyReadinessItem[];
};

const readinessRank: Record<FamilyReadinessStatus, number> = {
  supported_full_cycle: 8,
  supported_final_only: 7,
  credible_reporting: 6,
  manual_resolution_required: 5,
  policy_review: 4,
  adapter_needed: 3,
  source_registry_missing_capability: 2,
  source_registry_missing: 1,
  blocked: 0
};

function findLifecycleCapability(
  source: SourceRegistryEntry | undefined,
  candidate: MarketFamilySourceCandidate
): OracleCapabilityStatus | null {
  return (
    source?.lifecycleCapabilities?.find(
      (capability) =>
        capability.measurementKind === candidate.route.measurementKind &&
        capability.resultShape === candidate.route.resultShape
    )?.oracleCapability ?? null
  );
}

function readinessForCandidate(
  candidate: MarketFamilySourceCandidate,
  source: SourceRegistryEntry | undefined
): FamilyReadinessStatus {
  const oracleCapability = findLifecycleCapability(source, candidate);

  if (oracleCapability) {
    return oracleCapability;
  }

  if (candidate.adapterReadiness === "policy_review") {
    return "policy_review";
  }

  if (!source) {
    return "source_registry_missing";
  }

  if (candidate.adapterReadiness === "built") {
    return "source_registry_missing_capability";
  }

  return "adapter_needed";
}

function actionForStatus(
  status: FamilyReadinessStatus
): FamilyReadinessSourceRoute["operatorNextAction"] {
  switch (status) {
    case "supported_full_cycle":
    case "supported_final_only":
      return "ready_to_create";
    case "credible_reporting":
      return "ready_to_create";
    case "manual_resolution_required":
      return "park_family";
    case "blocked":
      return "park_family";
    case "policy_review":
      return "policy_review";
    case "source_registry_missing":
      return "survey_source";
    case "source_registry_missing_capability":
      return "update_source_registry";
    case "adapter_needed":
      return "build_oracle_adapter";
  }
}

function notesForStatus(status: FamilyReadinessStatus): string[] {
  switch (status) {
    case "supported_full_cycle":
      return ["Oracle can inspect close/liveness and final resolution for this route."];
    case "supported_final_only":
      return ["Oracle can inspect final resolution; close stays scheduled/manual."];
    case "credible_reporting":
      return ["Oracle can evaluate independent credible-reporting evidence and create a human-gated case."];
    case "manual_resolution_required":
      return ["Valid contract route, but explicit manual Oracle handling is required."];
    case "blocked":
      return ["Route is explicitly blocked for normal lifecycle publishing."];
    case "policy_review":
      return ["Family/source is sensitive enough to require policy review before public use."];
    case "source_registry_missing":
      return ["Market family names this source, but Seer source registry has no source entry yet."];
    case "source_registry_missing_capability":
      return ["Adapter is marked built in the family map, but source registry has no matching lifecycle capability."];
    case "adapter_needed":
      return ["Source family is known, but Oracle adapter support is not built/proven yet."];
  }
}

function bestStatus(routes: FamilyReadinessSourceRoute[]): FamilyReadinessStatus {
  return routes
    .map((route) => route.readinessStatus)
    .sort((left, right) => readinessRank[right] - readinessRank[left])[0] ?? "source_registry_missing";
}

export function buildFamilyReadinessSnapshot(
  families: MarketFamilyRegistryEntry[],
  sources: SourceRegistryEntry[],
  generatedAt: string
): FamilyReadinessSnapshot {
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  const statusCounts = Object.fromEntries(
    Object.keys(readinessRank).map((status) => [status, 0])
  ) as Record<FamilyReadinessStatus, number>;

  const items = families.map((family): FamilyReadinessItem => {
    const sourceRoutes = family.sourceCandidates.map((candidate): FamilyReadinessSourceRoute => {
      const source = sourcesById.get(candidate.sourceId);
      const readinessStatus = readinessForCandidate(candidate, source);
      statusCounts[readinessStatus] += 1;

      return {
        objectType: "family_readiness_source_route",
        sourceId: candidate.sourceId,
        sourceLabel: source?.label ?? candidate.label,
        sourceUrl: source?.homepage ?? null,
        measurementKind: candidate.route.measurementKind,
        resultShape: candidate.route.resultShape,
        adapterReadiness: candidate.adapterReadiness,
        registryStatus: source?.status ?? null,
        oracleCapability: findLifecycleCapability(source, candidate),
        readinessStatus,
        operatorNextAction: actionForStatus(readinessStatus),
        notes: [...(candidate.notes ?? []), ...notesForStatus(readinessStatus)]
      };
    });
    const bestReadinessStatus = bestStatus(sourceRoutes);

    return {
      objectType: "family_readiness_item",
      familyKey: family.familyKey,
      category: family.category,
      labelHe: family.labelHe,
      labelEn: family.labelEn,
      marketForms: family.marketForms,
      sensitivityLevel: family.sensitivityLevel,
      sourceRoutes,
      bestReadinessStatus,
      operatorNextAction: actionForStatus(bestReadinessStatus)
    };
  });

  return {
    objectType: "family_readiness_snapshot",
    generatedAt,
    familyCount: items.length,
    routeCount: items.reduce((total, item) => total + item.sourceRoutes.length, 0),
    statusCounts,
    items
  };
}
