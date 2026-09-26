import type { Pool } from "pg";

import type { Queryable } from "../../back/src/platform-surface/oracle";
import type { SourceRegistryEntry } from "../../seer/src/contracts";
import { listSeerSources } from "../../seer/src/source-registry";
import type {
  OracleEvidenceSource,
  OracleInspectionResult,
  OracleSourcePolicy
} from "./contracts";
import { inspectOracleMarket } from "./inspect-market-service";
import { normalizeOracleSourcePolicy } from "./source-policy-annotations";
import { normalizeMarketContract, type OracleMarketContractV1 } from "./source-adapter-contracts";

type MarketRow = {
  id: string;
  title: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  oracle_source_policy: unknown;
  market_contract: unknown;
};

type EvidenceRow = {
  evidence_packet_id: string;
  winning_outcome_id: string | null;
  winning_outcome_label: string | null;
  sources_snapshot: unknown;
  captured_at: Date;
};

type CredibleSourceRecord = OracleEvidenceSource & {
  evidencePacketId: string;
  winningOutcomeId: string;
  winningOutcomeLabel: string;
  independentGroupId: string;
};

export type CredibleReportingEvaluationAction =
  | "created_case"
  | "would_create_case"
  | "created_conflict_review"
  | "would_create_conflict_review"
  | "created_insufficient_evidence_review"
  | "would_create_insufficient_evidence_review"
  | "skipped_not_credible_reporting"
  | "skipped_no_evidence";

export type CredibleReportingEvaluationResult = {
  objectType: "credible_reporting_evaluation_result";
  marketId: string;
  marketTitle: string | null;
  action: CredibleReportingEvaluationAction;
  minimumIndependentSources: number;
  approvedSourceIds: string[];
  consideredSourceCount: number;
  independentSourceCount: number;
  winningOutcomeId: string | null;
  winningOutcomeLabel: string | null;
  oracleCaseId?: string;
  evidencePacketId?: string;
  reason: string;
  inspection?: OracleInspectionResult;
};

export type EvaluateCredibleReportingOptions = {
  marketId: string;
  dryRun?: boolean;
  now?: Date;
  sourceRegistry?: SourceRegistryEntry[];
};

function readJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readContractCrediblePolicy(contract: OracleMarketContractV1 | null): {
  minimumIndependentSources?: number;
  approvedSourceIds?: string[];
  conflictPolicy?: string;
  correctionWindow?: string;
  allowSingleSourceEvidence?: boolean;
} {
  const raw =
    contract?.credibleReporting &&
    typeof contract.credibleReporting === "object" &&
    !Array.isArray(contract.credibleReporting)
      ? contract.credibleReporting
      : null;

  return {
    minimumIndependentSources: readNumber(raw?.minimumIndependentSources) ?? undefined,
    approvedSourceIds: Array.isArray(raw?.approvedSourceIds)
      ? raw.approvedSourceIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined,
    conflictPolicy: readString(raw?.conflictPolicy) ?? undefined,
    correctionWindow: readString(raw?.correctionWindow) ?? undefined,
    allowSingleSourceEvidence: raw?.allowSingleSourceEvidence === true
  };
}

function isCredibleReportingMarket(
  contract: OracleMarketContractV1 | null,
  policy: OracleSourcePolicy | null
): boolean {
  return (
    contract?.oracleCapability === "credible_reporting" ||
    contract?.resolutionAuthorityType === "credible-reporting" ||
    policy?.notes?.some((note) => note === "resolution-authority=credible-reporting") === true
  );
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function approvedSourceIdsFor(
  contract: OracleMarketContractV1 | null,
  policy: OracleSourcePolicy | null
): string[] {
  const contractPolicy = readContractCrediblePolicy(contract);
  const approved =
    policy?.credibleReporting?.approvedSourceIds ??
    contractPolicy.approvedSourceIds ??
    [
      ...(policy?.resolutionSourceIds ?? []),
      ...(policy?.preferredSourceIds ?? []),
      ...(policy?.fallbackSourceIds ?? [])
    ];

  return dedupe(approved.filter((sourceId) => sourceId !== "src_credible_reporting_bundle"));
}

function minimumIndependentSourcesFor(
  contract: OracleMarketContractV1 | null,
  policy: OracleSourcePolicy | null
): number {
  const contractPolicy = readContractCrediblePolicy(contract);
  const requested = Math.floor(
    policy?.credibleReporting?.minimumIndependentSources ??
      contractPolicy.minimumIndependentSources ??
      2
  );
  const floor = contractPolicy.allowSingleSourceEvidence === true ? 1 : 2;

  return Math.max(floor, requested);
}

function independentGroupFor(
  source: OracleEvidenceSource,
  registryById: Map<string, SourceRegistryEntry>
): string {
  const registryEntry = source.sourceId ? registryById.get(source.sourceId) : undefined;

  if (source.independentGroupId?.trim()) {
    return source.independentGroupId.trim();
  }

  if (registryEntry?.independentGroupId?.trim()) {
    return registryEntry.independentGroupId.trim();
  }

  if (registryEntry?.ownerLabel?.trim()) {
    return registryEntry.ownerLabel.trim().toLowerCase();
  }

  try {
    return new URL(source.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return source.sourceId ?? source.sourceUrl;
  }
}

function sourceIsAllowed(
  source: OracleEvidenceSource,
  approvedSourceIds: string[],
  registryById: Map<string, SourceRegistryEntry>
): boolean {
  if (!source.sourceId || !approvedSourceIds.includes(source.sourceId)) {
    return false;
  }

  const registryEntry = registryById.get(source.sourceId);
  return (
    registryEntry?.credibleReporting?.allowed === true &&
    registryEntry.credibleReporting.tier !== "context-only"
  );
}

function readHttpsEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function toEvidenceSources(rows: EvidenceRow[], registry: SourceRegistryEntry[]): CredibleSourceRecord[] {
  const registryById = new Map(registry.map((source) => [source.sourceId, source]));
  const records: CredibleSourceRecord[] = [];

  for (const row of rows) {
    if (!row.winning_outcome_id || !row.winning_outcome_label) {
      continue;
    }

    for (const item of readJsonArray(row.sources_snapshot)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const raw = item as Record<string, unknown>;
      const sourceUrl = readString(raw.sourceUrl);
      const sourceLabel = readString(raw.sourceLabel);
      const sourceType = readString(raw.sourceType);
      const claimSummary = readString(raw.claimSummary);

      if (!sourceUrl || !sourceLabel || !sourceType || !claimSummary) {
        continue;
      }

      const safeSourceUrl = readHttpsEvidenceUrl(sourceUrl);
      if (!safeSourceUrl) {
        continue;
      }

      if (sourceType === "credible_reporting_bundle") {
        continue;
      }

      const source: OracleEvidenceSource = {
        sourceId: readString(raw.sourceId) ?? undefined,
        sourceUrl: safeSourceUrl,
        sourceLabel,
        sourceType,
        independentGroupId: readString(raw.independentGroupId) ?? undefined,
        claimSummary,
        capturedAt: readString(raw.capturedAt) ?? row.captured_at.toISOString()
      };

      records.push({
        ...source,
        evidencePacketId: row.evidence_packet_id,
        winningOutcomeId: row.winning_outcome_id,
        winningOutcomeLabel: row.winning_outcome_label,
        independentGroupId: independentGroupFor(source, registryById)
      });
    }
  }

  return records;
}

function uniqueByIndependentGroup(records: CredibleSourceRecord[]): CredibleSourceRecord[] {
  const seen = new Map<string, CredibleSourceRecord>();

  for (const record of records) {
    const existing = seen.get(record.independentGroupId);

    if (!existing || Date.parse(record.capturedAt) > Date.parse(existing.capturedAt)) {
      seen.set(record.independentGroupId, record);
    }
  }

  return [...seen.values()];
}

async function readMarket(db: Queryable, marketId: string): Promise<MarketRow | null> {
  const result = await db.query<MarketRow>(
    `
      select id, title, status, oracle_source_policy, market_contract
      from markets
      where id = $1
      limit 1
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

async function readEvidenceRows(db: Queryable, marketId: string): Promise<EvidenceRow[]> {
  const result = await db.query<EvidenceRow>(
    `
      select
        ep.id as evidence_packet_id,
        ep.winning_outcome_id,
        mo.label as winning_outcome_label,
        ep.sources_snapshot,
        ep.captured_at
      from oracle_evidence_packets ep
      left join market_outcomes mo
        on mo.id = ep.winning_outcome_id
      where ep.market_id = $1
      order by ep.captured_at desc
      limit 50
    `,
    [marketId]
  );

  return result.rows;
}

export async function evaluateCredibleReportingEvidence(
  dbPool: Pool,
  options: EvaluateCredibleReportingOptions
): Promise<CredibleReportingEvaluationResult> {
  const market = await readMarket(dbPool, options.marketId);
  const policy = normalizeOracleSourcePolicy(market?.oracle_source_policy);
  const contract = normalizeMarketContract(market?.market_contract);
  const registry = options.sourceRegistry ?? (await listSeerSources());
  const registryById = new Map(registry.map((source) => [source.sourceId, source]));
  const approvedSourceIds = approvedSourceIdsFor(contract, policy);
  const minimumIndependentSources = minimumIndependentSourcesFor(contract, policy);

  if (!market || !isCredibleReportingMarket(contract, policy)) {
    return {
      objectType: "credible_reporting_evaluation_result",
      marketId: options.marketId,
      marketTitle: market?.title ?? null,
      action: "skipped_not_credible_reporting",
      minimumIndependentSources,
      approvedSourceIds,
      consideredSourceCount: 0,
      independentSourceCount: 0,
      winningOutcomeId: null,
      winningOutcomeLabel: null,
      reason: "Market contract is not marked for credible-reporting resolution."
    };
  }

  const allEvidence = toEvidenceSources(await readEvidenceRows(dbPool, market.id), registry)
    .filter((source) => sourceIsAllowed(source, approvedSourceIds, registryById));

  if (approvedSourceIds.length === 0 || allEvidence.length === 0) {
    return {
      objectType: "credible_reporting_evaluation_result",
      marketId: market.id,
      marketTitle: market.title,
      action: "skipped_no_evidence",
      minimumIndependentSources,
      approvedSourceIds,
      consideredSourceCount: allEvidence.length,
      independentSourceCount: 0,
      winningOutcomeId: null,
      winningOutcomeLabel: null,
      reason:
        approvedSourceIds.length === 0
          ? "Credible-reporting contract has no approved external source ids."
          : "No approved credible-reporting evidence packets are available yet."
    };
  }

  const grouped = new Map<string, CredibleSourceRecord[]>();

  for (const record of allEvidence) {
    grouped.set(record.winningOutcomeId, [
      ...(grouped.get(record.winningOutcomeId) ?? []),
      record
    ]);
  }

  const independentGroups = [...grouped.entries()].map(([winningOutcomeId, records]) => ({
    winningOutcomeId,
    winningOutcomeLabel: records[0]?.winningOutcomeLabel ?? winningOutcomeId,
    records: uniqueByIndependentGroup(records)
  }));
  const qualifyingGroups = independentGroups.filter(
    (group) => group.records.length >= minimumIndependentSources
  );
  const allIndependentSources = uniqueByIndependentGroup(allEvidence);
  const capturedAt = (options.now ?? new Date()).toISOString();

  if (qualifyingGroups.length === 1 && independentGroups.length === 1) {
    const [group] = qualifyingGroups;

    if (options.dryRun) {
      return {
        objectType: "credible_reporting_evaluation_result",
        marketId: market.id,
        marketTitle: market.title,
        action: "would_create_case",
        minimumIndependentSources,
        approvedSourceIds,
        consideredSourceCount: allEvidence.length,
        independentSourceCount: group.records.length,
        winningOutcomeId: group.winningOutcomeId,
        winningOutcomeLabel: group.winningOutcomeLabel,
        reason: `At least ${minimumIndependentSources} independent credible sources agree on ${group.winningOutcomeLabel}.`
      };
    }

    const inspection = await inspectOracleMarket(
      dbPool,
      {
        marketId: market.id,
        caseType: "resolution_check",
        winningOutcomeId: group.winningOutcomeId,
        sources: group.records.map((source) => ({
          sourceId: source.sourceId,
          sourceUrl: source.sourceUrl,
          sourceLabel: source.sourceLabel,
          sourceType: "credible_reporting",
          independentGroupId: source.independentGroupId,
          claimSummary: source.claimSummary,
          capturedAt: source.capturedAt
        })),
        evidenceSummary: `Credible-reporting bundle: ${group.records.length} independent approved sources agree on "${group.winningOutcomeLabel}".`,
        reasonSummary: `At least ${minimumIndependentSources} independent credible sources agree on "${group.winningOutcomeLabel}".`,
        summary: `Oracle credible-reporting evaluator recommends "${group.winningOutcomeLabel}" for "${market.title}".`,
        requiresHumanReview: true,
        capturedAt
      },
      {
        persistResult: true
      }
    );

    return {
      objectType: "credible_reporting_evaluation_result",
      marketId: market.id,
      marketTitle: market.title,
      action: "created_case",
      minimumIndependentSources,
      approvedSourceIds,
      consideredSourceCount: allEvidence.length,
      independentSourceCount: group.records.length,
      winningOutcomeId: group.winningOutcomeId,
      winningOutcomeLabel: group.winningOutcomeLabel,
      oracleCaseId: inspection.oracleCase.oracleCaseId,
      evidencePacketId: inspection.evidencePacket.evidencePacketId,
      reason: `Created human-gated credible-reporting resolution case for "${group.winningOutcomeLabel}".`,
      inspection
    };
  }

  const conflict = independentGroups.length > 1;
  const action = conflict
    ? options.dryRun
      ? "would_create_conflict_review"
      : "created_conflict_review"
    : options.dryRun
      ? "would_create_insufficient_evidence_review"
      : "created_insufficient_evidence_review";
  const reason = conflict
    ? "Approved credible sources point to more than one outcome; operator review is required."
    : `Only ${allIndependentSources.length} independent approved sources are available; need ${minimumIndependentSources}.`;

  if (options.dryRun) {
    return {
      objectType: "credible_reporting_evaluation_result",
      marketId: market.id,
      marketTitle: market.title,
      action,
      minimumIndependentSources,
      approvedSourceIds,
      consideredSourceCount: allEvidence.length,
      independentSourceCount: allIndependentSources.length,
      winningOutcomeId: null,
      winningOutcomeLabel: null,
      reason
    };
  }

  const inspection = await inspectOracleMarket(
    dbPool,
    {
      marketId: market.id,
      caseType: "resolution_check",
      sources: allIndependentSources.map((source) => ({
        sourceId: source.sourceId,
        sourceUrl: source.sourceUrl,
        sourceLabel: source.sourceLabel,
        sourceType: "credible_reporting",
        independentGroupId: source.independentGroupId,
        claimSummary: `${source.claimSummary} Outcome claimed: ${source.winningOutcomeLabel}.`,
        capturedAt: source.capturedAt
      })),
      evidenceSummary: "Credible-reporting evidence is not sufficient for a trusted resolution recommendation.",
      reasonSummary: reason,
      summary: `Oracle credible-reporting evaluator needs review for "${market.title}".`,
      requiresHumanReview: true,
      reviewType: conflict ? "conflicting_sources" : "insufficient_evidence",
      reviewSummary: reason,
      recommendedNextAction: conflict ? "inspect" : "wait",
      capturedAt
    },
    {
      persistResult: true
    }
  );

  return {
    objectType: "credible_reporting_evaluation_result",
    marketId: market.id,
    marketTitle: market.title,
    action,
    minimumIndependentSources,
    approvedSourceIds,
    consideredSourceCount: allEvidence.length,
    independentSourceCount: allIndependentSources.length,
    winningOutcomeId: null,
    winningOutcomeLabel: null,
    oracleCaseId: inspection.oracleCase.oracleCaseId,
    evidencePacketId: inspection.evidencePacket.evidencePacketId,
    reason,
    inspection
  };
}
