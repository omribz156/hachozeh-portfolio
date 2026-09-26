import type {
  MarketMeasurementKind,
  MarketResultShape,
  OracleCapabilityStatus,
  SourceRegistryEntry
} from "../../seer/src/contracts";
import { listSeerSources } from "../../seer/src/source-registry";
import {
  checkOracleSourceCapability,
  type OracleSourceCapabilityCheck,
  type OracleSourceCapabilityCheckInput,
  type OracleSourceCapabilityCheckStatus
} from "./source-capability-service";
import { getOracleLifecycleSourceAdapters } from "./source-adapter-registry";
import type { OracleLifecycleSourceAdapter } from "./source-adapter-contracts";

export type FamilyRouteAuditSeverity = "clean" | "warning" | "blocker";

export type FamilyRouteAuditIssueCode =
  | "seer_supported_but_oracle_missing"
  | "seer_supported_but_credentials_missing"
  | "seer_overstates_oracle_capability"
  | "seer_understates_oracle_capability"
  | "seer_parked_but_oracle_supports"
  | "oracle_route_missing_from_seer_registry"
  | "oracle_source_missing_from_seer_registry";

export type FamilyRouteAuditRoute = {
  routeKey: string;
  sourceId: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  measurementKind: MarketMeasurementKind;
  resultShape: MarketResultShape;
  seerCapability: OracleCapabilityStatus | null;
  oracleStatus: OracleSourceCapabilityCheckStatus;
  expectedSeerCapability: OracleCapabilityStatus | null;
  adapterFamily: string | null;
  adapterLabel: string | null;
};

export type FamilyRouteAuditIssue = FamilyRouteAuditRoute & {
  severity: Exclude<FamilyRouteAuditSeverity, "clean">;
  issueCode: FamilyRouteAuditIssueCode;
  message: string;
  nextAction:
    | "build_oracle_adapter"
    | "configure_credentials"
    | "update_seer_registry"
    | "downgrade_seer_capability"
    | "consider_capability_upgrade";
};

export type FamilyRouteAuditResult = {
  objectType: "family_route_audit_result";
  generatedAt: string;
  status: "clean" | "warnings" | "blocked";
  checkedRouteCount: number;
  issueCount: number;
  blockerCount: number;
  warningCount: number;
  routes: FamilyRouteAuditRoute[];
  issues: FamilyRouteAuditIssue[];
};

export type RunFamilyRouteAuditOptions = {
  generatedAt?: string;
  sourceId?: string | null;
  sources?: SourceRegistryEntry[];
  adapters?: OracleLifecycleSourceAdapter[];
  checkCapability?: (input: OracleSourceCapabilityCheckInput) => OracleSourceCapabilityCheck;
};

type RouteSeed = {
  sourceId: string;
  measurementKind: MarketMeasurementKind;
  resultShape: MarketResultShape;
};

const ALLOWED_MEASUREMENT_KINDS = new Set<string>([
  "final_winner",
  "rate_direction",
  "deadline_yes_no",
  "threshold_crossing",
  "date_bucket",
  "official_value",
  "reported_claim"
]);

const ALLOWED_RESULT_SHAPES = new Set<string>([
  "home_away_winner",
  "three_way_result",
  "cut_hold_hike",
  "yes_no",
  "date_bucket",
  "multi_outcome"
]);

function isMarketMeasurementKind(value: string): value is MarketMeasurementKind {
  return ALLOWED_MEASUREMENT_KINDS.has(value);
}

function isMarketResultShape(value: string): value is MarketResultShape {
  return ALLOWED_RESULT_SHAPES.has(value);
}

function routeKey(seed: RouteSeed): string {
  return `${seed.sourceId}::${seed.measurementKind}::${seed.resultShape}`;
}

function oracleStatusToSeerCapability(
  status: OracleSourceCapabilityCheckStatus
): OracleCapabilityStatus | null {
  switch (status) {
    case "full_cycle_supported":
      return "supported_full_cycle";
    case "final_only_supported":
      return "supported_final_only";
    case "credible_reporting_supported":
      return "credible_reporting";
    default:
      return null;
  }
}

function capabilityRank(capability: OracleCapabilityStatus | null): number {
  switch (capability) {
    case "supported_full_cycle":
      return 3;
    case "supported_final_only":
      return 2;
    case "credible_reporting":
      return 2;
    case "manual_resolution_required":
      return 1;
    case "blocked":
      return 0;
    default:
      return -1;
  }
}

function buildAdapterRouteSeeds(adapters: OracleLifecycleSourceAdapter[]): RouteSeed[] {
  const seeds: RouteSeed[] = [];

  for (const adapter of adapters) {
    for (const sourceId of adapter.sourceIds) {
      const routes = adapter.routes?.length
        ? adapter.routes
        : adapter.measurementKinds.flatMap((measurementKind) =>
            adapter.resultShapes.map((resultShape) => ({ measurementKind, resultShape }))
          );

      for (const route of routes) {
        if (!isMarketMeasurementKind(route.measurementKind) || !isMarketResultShape(route.resultShape)) {
          continue;
        }

        seeds.push({
          sourceId,
          measurementKind: route.measurementKind,
          resultShape: route.resultShape
        });
      }
    }
  }

  return seeds;
}

function buildRegistryRouteSeeds(sources: SourceRegistryEntry[]): RouteSeed[] {
  const seeds: RouteSeed[] = [];

  for (const source of sources) {
    for (const capability of source.lifecycleCapabilities ?? []) {
      seeds.push({
        sourceId: source.sourceId,
        measurementKind: capability.measurementKind,
        resultShape: capability.resultShape
      });
    }
  }

  return seeds;
}

function uniqueRouteSeeds(seeds: RouteSeed[], sourceId?: string | null): RouteSeed[] {
  const byKey = new Map<string, RouteSeed>();

  for (const seed of seeds) {
    if (sourceId && seed.sourceId !== sourceId) {
      continue;
    }

    byKey.set(routeKey(seed), seed);
  }

  return [...byKey.values()].sort((left, right) => routeKey(left).localeCompare(routeKey(right)));
}

function findSeerCapability(
  source: SourceRegistryEntry | undefined,
  seed: RouteSeed
): OracleCapabilityStatus | null {
  return (
    source?.lifecycleCapabilities?.find(
      (capability) =>
        capability.measurementKind === seed.measurementKind &&
        capability.resultShape === seed.resultShape
    )?.oracleCapability ?? null
  );
}

function buildIssue(route: FamilyRouteAuditRoute): FamilyRouteAuditIssue | null {
  if (!route.sourceLabel && route.expectedSeerCapability) {
    return {
      ...route,
      severity: "warning",
      issueCode: "oracle_source_missing_from_seer_registry",
      message: "Oracle has an adapter route, but Seer has no source registry entry for this sourceId.",
      nextAction: "update_seer_registry"
    };
  }

  if (!route.seerCapability && route.expectedSeerCapability) {
    return {
      ...route,
      severity: "warning",
      issueCode: "oracle_route_missing_from_seer_registry",
      message: "Oracle supports this route, but Seer registry does not declare the lifecycle capability.",
      nextAction: "update_seer_registry"
    };
  }

  if (
    (route.seerCapability === "supported_full_cycle" ||
      route.seerCapability === "supported_final_only" ||
      route.seerCapability === "credible_reporting") &&
    route.oracleStatus === "adapter_not_implemented"
  ) {
    return {
      ...route,
      severity: "blocker",
      issueCode: "seer_supported_but_oracle_missing",
      message: "Seer marks this route supported, but Oracle has no matching adapter.",
      nextAction: "build_oracle_adapter"
    };
  }

  if (
    (route.seerCapability === "supported_full_cycle" ||
      route.seerCapability === "supported_final_only" ||
      route.seerCapability === "credible_reporting") &&
    route.oracleStatus === "registered_no_credentials"
  ) {
    return {
      ...route,
      severity: "warning",
      issueCode: "seer_supported_but_credentials_missing",
      message: "Oracle adapter exists, but runtime credentials are missing.",
      nextAction: "configure_credentials"
    };
  }

  if (
    (route.seerCapability === "manual_resolution_required" || route.seerCapability === "blocked") &&
    route.expectedSeerCapability
  ) {
    return {
      ...route,
      severity: "warning",
      issueCode: "seer_parked_but_oracle_supports",
      message: "Seer parks this route, but Oracle has adapter support.",
      nextAction: "consider_capability_upgrade"
    };
  }

  if (
    route.seerCapability &&
    route.expectedSeerCapability &&
    capabilityRank(route.seerCapability) > capabilityRank(route.expectedSeerCapability)
  ) {
    return {
      ...route,
      severity: "blocker",
      issueCode: "seer_overstates_oracle_capability",
      message: "Seer capability is stronger than Oracle can currently prove.",
      nextAction: "downgrade_seer_capability"
    };
  }

  if (
    route.seerCapability &&
    route.expectedSeerCapability &&
    capabilityRank(route.seerCapability) < capabilityRank(route.expectedSeerCapability)
  ) {
    return {
      ...route,
      severity: "warning",
      issueCode: "seer_understates_oracle_capability",
      message: "Oracle can support a stronger route than Seer currently declares.",
      nextAction: "update_seer_registry"
    };
  }

  return null;
}

export async function runFamilyRouteAudit(
  options: RunFamilyRouteAuditOptions = {}
): Promise<FamilyRouteAuditResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const sources = options.sources ?? (await listSeerSources());
  const adapters = options.adapters ?? getOracleLifecycleSourceAdapters();
  const checkCapability = options.checkCapability ?? checkOracleSourceCapability;
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  const seeds = uniqueRouteSeeds(
    [...buildRegistryRouteSeeds(sources), ...buildAdapterRouteSeeds(adapters)],
    options.sourceId
  );
  const routes = seeds.map((seed): FamilyRouteAuditRoute => {
    const source = sourcesById.get(seed.sourceId);
    const oracle = checkCapability({
      sourceId: seed.sourceId,
      measurementKind: seed.measurementKind,
      resultShape: seed.resultShape,
      sourceUrl: source?.homepage ?? null
    });

    return {
      routeKey: routeKey(seed),
      sourceId: seed.sourceId,
      sourceLabel: source?.label ?? null,
      sourceUrl: source?.homepage ?? null,
      measurementKind: seed.measurementKind,
      resultShape: seed.resultShape,
      seerCapability: findSeerCapability(source, seed),
      oracleStatus: oracle.status,
      expectedSeerCapability: oracleStatusToSeerCapability(oracle.status),
      adapterFamily: oracle.adapterFamily,
      adapterLabel: oracle.adapterLabel
    };
  });
  const issues = routes
    .map((route) => buildIssue(route))
    .filter((issue): issue is FamilyRouteAuditIssue => issue !== null);
  const blockerCount = issues.filter((issue) => issue.severity === "blocker").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return {
    objectType: "family_route_audit_result",
    generatedAt,
    status: routeAuditStatus(blockerCount, warningCount),
    checkedRouteCount: routes.length,
    issueCount: issues.length,
    blockerCount,
    warningCount,
    routes,
    issues
  };
}

function routeAuditStatus(blockerCount: number, warningCount: number): FamilyRouteAuditResult["status"] {
  if (blockerCount > 0) {
    return "blocked";
  }

  return warningCount > 0 ? "warnings" : "clean";
}
