import { randomUUID } from "node:crypto";

import type { Queryable } from "../../back/src/platform-surface/oracle";
import {
  persistOracleRuntimeSnapshot,
  readRecentOracleRuntimeSnapshots,
  type OracleRuntimeSnapshotSummary
} from "./runtime-snapshot-service";
import {
  readEligibleMarkets,
  readLatestOracleCases,
  type EligibleMarket,
  type OracleCasePressure
} from "./oracle-alerts-read-model";

export type OracleAlertItem = {
  objectType: "oracle_alert_item";
  alertItemId: string;
  marketId: string;
  marketTitle: string;
  marketStatus: "open" | "closed";
  severity: "low" | "medium" | "high";
  alertType:
    | "source-run-failed"
    | "fetch-gap-pressure"
    | "missing-resolve-plan"
    | "stale-review-case"
    | "stale-recommended-case"
    | "missing-resolution-case";
  summary: string;
  detectedAt: string;
  requiredHumanAction: "inspect" | "review" | "retry";
  oracleCaseId?: string;
  caseType?: "close_condition_check" | "resolution_check";
  caseStatus?: "recommended" | "review_needed" | "no_action";
  hoursSinceCaseUpdate?: number;
  fetchNeeds?: string[];
};

export type OracleAlertsResult = {
  objectType: "oracle_alerts_result";
  generatedAt: string;
  marketStatusFilter: "open" | "closed" | "all";
  runtimeSnapshotId?: string;
  recentRuntimeSnapshots: OracleRuntimeSnapshotSummary[];
  heartbeatSummary: {
    eligibleMarketCount: number;
    checkedMarketCount: number;
    candidateEvidenceCount: number;
    marketsWithCandidates: number;
    sourceRunCount: number;
    failedSourceRunCount: number;
  };
  alertCounts: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  alerts: OracleAlertItem[];
  recommendations: string[];
};

export type ReadOracleAlertsOptions = {
  marketStatus?: "open" | "closed" | "all";
  persistSnapshot?: boolean;
  evaluatedAt?: string;
  reviewStaleHours?: number;
  recommendedStaleHours?: number;
  closedResolutionGraceHours?: number;
  precloseFetchGapHours?: number;
};

function readIsoTimestamp(value?: string): string {
  const timestamp = value ?? new Date().toISOString();
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${timestamp}`);
  }

  return parsed.toISOString();
}

function hoursBetween(earlierIso: string, laterIso: string): number {
  return Number(
    ((Date.parse(laterIso) - Date.parse(earlierIso)) / 3_600_000).toFixed(2)
  );
}

function readPositiveHours(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function buildLifecyclePressureAlerts(input: {
  eligibleMarkets: EligibleMarket[];
  evaluatedAt: string;
  precloseFetchGapHours: number;
}): OracleAlertItem[] {
  const alerts: OracleAlertItem[] = [];

  for (const market of input.eligibleMarkets) {
    const hoursUntilClose = hoursBetween(input.evaluatedAt, market.closeAt);
    const fetchGapIsPressing =
      market.marketStatus === "closed" ||
      hoursUntilClose <= input.precloseFetchGapHours;

    if (fetchGapIsPressing && market.contractHints.fetchNeeds.length > 0) {
      alerts.push({
        objectType: "oracle_alert_item",
        alertItemId: `oal_${randomUUID()}`,
        marketId: market.marketId,
        marketTitle: market.marketTitle,
        marketStatus: market.marketStatus,
        severity: market.marketStatus === "closed" ? "high" : "medium",
        alertType: "fetch-gap-pressure",
        summary:
          market.marketStatus === "closed"
            ? `Closed market still lacks follow-up fetch for: ${market.contractHints.fetchNeeds.join(", ")}.`
            : `Market is near close and still lacks follow-up fetch for: ${market.contractHints.fetchNeeds.join(", ")}.`,
        detectedAt: input.evaluatedAt,
        requiredHumanAction: "inspect",
        fetchNeeds: market.contractHints.fetchNeeds
      });
    }

    if (
      market.marketStatus === "closed" &&
      market.contractHints.sourceRolePlan.resolve.length === 0
    ) {
      alerts.push({
        objectType: "oracle_alert_item",
        alertItemId: `oal_${randomUUID()}`,
        marketId: market.marketId,
        marketTitle: market.marketTitle,
        marketStatus: market.marketStatus,
        severity: "high",
        alertType: "missing-resolve-plan",
        summary:
          "Closed market has no stamped resolve-role plan. Evidence can inform review, not impersonate verdict doctrine.",
        detectedAt: input.evaluatedAt,
        requiredHumanAction: "inspect"
      });
    }
  }

  return alerts;
}

function buildCaseAlerts(input: {
  eligibleMarkets: Map<string, EligibleMarket>;
  latestCases: OracleCasePressure[];
  evaluatedAt: string;
  reviewStaleHours: number;
  recommendedStaleHours: number;
}): OracleAlertItem[] {
  const alerts: OracleAlertItem[] = [];

  for (const oracleCase of input.latestCases) {
    const market = input.eligibleMarkets.get(oracleCase.marketId);

    if (!market || (market.marketStatus !== "open" && market.marketStatus !== "closed")) {
      continue;
    }

    const hoursSinceUpdate = hoursBetween(oracleCase.updatedAt, input.evaluatedAt);

    if (
      oracleCase.caseStatus === "review_needed" &&
      hoursSinceUpdate >= input.reviewStaleHours
    ) {
      alerts.push({
        objectType: "oracle_alert_item",
        alertItemId: `oal_${randomUUID()}`,
        marketId: market.marketId,
        marketTitle: market.marketTitle,
        marketStatus: market.marketStatus,
        severity: "high",
        alertType: "stale-review-case",
        summary: `Review-needed Oracle case has been waiting ${hoursSinceUpdate}h without progress.`,
        detectedAt: input.evaluatedAt,
        requiredHumanAction: "review",
        oracleCaseId: oracleCase.oracleCaseId,
        caseType: oracleCase.caseType,
        caseStatus: oracleCase.caseStatus,
        hoursSinceCaseUpdate: hoursSinceUpdate,
        fetchNeeds: oracleCase.contractHints.fetchNeeds
      });
      continue;
    }

    if (
      oracleCase.caseStatus === "recommended" &&
      hoursSinceUpdate >= input.recommendedStaleHours
    ) {
      alerts.push({
        objectType: "oracle_alert_item",
        alertItemId: `oal_${randomUUID()}`,
        marketId: market.marketId,
        marketTitle: market.marketTitle,
        marketStatus: market.marketStatus,
        severity: "medium",
        alertType: "stale-recommended-case",
        summary: `Recommended Oracle case has been sitting ${hoursSinceUpdate}h without approval or rejection.`,
        detectedAt: input.evaluatedAt,
        requiredHumanAction: "review",
        oracleCaseId: oracleCase.oracleCaseId,
        caseType: oracleCase.caseType,
        caseStatus: oracleCase.caseStatus,
        hoursSinceCaseUpdate: hoursSinceUpdate,
        fetchNeeds: oracleCase.contractHints.fetchNeeds
      });
    }
  }

  return alerts;
}

function buildMissingResolutionCaseAlerts(input: {
  eligibleMarkets: EligibleMarket[];
  latestCases: OracleCasePressure[];
  evaluatedAt: string;
  closedResolutionGraceHours: number;
}): OracleAlertItem[] {
  const alerts: OracleAlertItem[] = [];
  const resolutionCaseMarketIds = new Set(
    input.latestCases
      .filter((oracleCase) => oracleCase.caseType === "resolution_check")
      .map((oracleCase) => oracleCase.marketId)
  );

  for (const market of input.eligibleMarkets) {
    if (market.marketStatus !== "closed") {
      continue;
    }

    const hoursSinceClose = hoursBetween(market.closeAt, input.evaluatedAt);

    if (
      hoursSinceClose >= input.closedResolutionGraceHours &&
      !resolutionCaseMarketIds.has(market.marketId)
    ) {
      alerts.push({
        objectType: "oracle_alert_item",
        alertItemId: `oal_${randomUUID()}`,
        marketId: market.marketId,
        marketTitle: market.marketTitle,
        marketStatus: market.marketStatus,
        severity: "high",
        alertType: "missing-resolution-case",
        summary: `Closed market has no Oracle resolution case ${hoursSinceClose}h after close.`,
        detectedAt: input.evaluatedAt,
        requiredHumanAction: "inspect",
        fetchNeeds: market.contractHints.fetchNeeds
      });
    }
  }

  return alerts;
}

function countAlerts(alerts: OracleAlertItem[]) {
  return {
    total: alerts.length,
    high: alerts.filter((alert) => alert.severity === "high").length,
    medium: alerts.filter((alert) => alert.severity === "medium").length,
    low: alerts.filter((alert) => alert.severity === "low").length
  };
}

function buildRecommendations(alerts: OracleAlertItem[]): string[] {
  const recommendations: string[] = [];

  if (alerts.some((alert) => alert.alertType === "stale-review-case")) {
    recommendations.push(
      "Some review-needed Oracle cases are stale. Human eyes now, not tomorrow cosplay."
    );
  }

  if (alerts.some((alert) => alert.alertType === "missing-resolution-case")) {
    recommendations.push(
      "Some closed markets still have no Oracle resolution case. Heartbeat alone is not enough; open the review trail."
    );
  }

  if (alerts.some((alert) => alert.alertType === "fetch-gap-pressure")) {
    recommendations.push(
      "Fetch gaps are now time pressure, not just docs garnish. Expand source coverage or review with explicit caution."
    );
  }

  return [...new Set(recommendations)];
}

export async function readOracleAlerts(
  db: Queryable,
  options: ReadOracleAlertsOptions
): Promise<OracleAlertsResult> {
  const evaluatedAt = readIsoTimestamp(options.evaluatedAt);
  const reviewStaleHours = readPositiveHours(options.reviewStaleHours, 6);
  const recommendedStaleHours = readPositiveHours(options.recommendedStaleHours, 12);
  const closedResolutionGraceHours = readPositiveHours(
    options.closedResolutionGraceHours,
    2
  );
  const precloseFetchGapHours = readPositiveHours(options.precloseFetchGapHours, 24);
  const marketStatusFilter = options.marketStatus ?? "all";
  const eligibleMarkets = await readEligibleMarkets(db, marketStatusFilter);
  const eligibleMarketMap = new Map(
    eligibleMarkets.map((market) => [market.marketId, market])
  );
  const latestCases = await readLatestOracleCases(
    db,
    eligibleMarkets.map((market) => market.marketId)
  );

  const alerts = [
    ...buildLifecyclePressureAlerts({
      eligibleMarkets,
      evaluatedAt,
      precloseFetchGapHours
    }),
    ...buildCaseAlerts({
      eligibleMarkets: eligibleMarketMap,
      latestCases,
      evaluatedAt,
      reviewStaleHours,
      recommendedStaleHours
    }),
    ...buildMissingResolutionCaseAlerts({
      eligibleMarkets,
      latestCases,
      evaluatedAt,
      closedResolutionGraceHours
    })
  ].sort((left, right) => {
    const severityWeight = {
      high: 0,
      medium: 1,
      low: 2
    } as const;

    return (
      severityWeight[left.severity] - severityWeight[right.severity] ||
      left.marketId.localeCompare(right.marketId) ||
      left.alertType.localeCompare(right.alertType)
    );
  });

  const result: OracleAlertsResult = {
    objectType: "oracle_alerts_result",
    generatedAt: evaluatedAt,
    marketStatusFilter,
    recentRuntimeSnapshots: [],
    heartbeatSummary: {
      eligibleMarketCount: eligibleMarkets.length,
      checkedMarketCount: eligibleMarkets.length,
      candidateEvidenceCount: latestCases.length,
      marketsWithCandidates: new Set(latestCases.map((item) => item.marketId)).size,
      sourceRunCount: 0,
      failedSourceRunCount: 0
    },
    alertCounts: countAlerts(alerts),
    alerts,
    recommendations: buildRecommendations(alerts)
  };

  if (options.persistSnapshot) {
    const runtimeSnapshotId = await persistOracleRuntimeSnapshot(db, {
      runtimeType: "alerts",
      marketStatusFilter,
      generatedAt: result.generatedAt,
      summarySnapshot: {
        totalAlerts: result.alertCounts.total,
        highAlerts: result.alertCounts.high,
        mediumAlerts: result.alertCounts.medium,
        lowAlerts: result.alertCounts.low,
        eligibleMarketCount: result.heartbeatSummary.eligibleMarketCount,
        checkedMarketCount: result.heartbeatSummary.checkedMarketCount
      },
      payloadSnapshot: result as unknown as Record<string, unknown>
    });
    const recentRuntimeSnapshots = await readRecentOracleRuntimeSnapshots(db);

    return {
      ...result,
      runtimeSnapshotId,
      recentRuntimeSnapshots
    };
  }

  return {
    ...result,
    recentRuntimeSnapshots: await readRecentOracleRuntimeSnapshots(db)
  };
}
