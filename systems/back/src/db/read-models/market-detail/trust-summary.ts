import type { MarketDetailPassiveRecord } from "../../../http/routes/market-detail-fixtures";
import { buildPublicMarketContract } from "../../../shared/market-truth";
import {
  publicizeResolutionSourceText,
  readPublicResolutionSourceUrl,
  stripResolutionSourceUrl
} from "../../../shared/public-source";
import { formatUpdatedLabel } from "./formatters";
import { resolvePassiveOutcomeKey } from "./identity";
import type { MarketDetailRow, OracleSourcePolicy } from "./types";

export function buildResolutionSummary(
  row: MarketDetailRow
): MarketDetailPassiveRecord["snapshot"]["resolution"] {
  if (row.market_status !== "resolved") {
    return undefined;
  }

  if (
    !row.winning_outcome_id ||
    !row.winning_outcome_label ||
    !row.resolution_source_url ||
    !row.resolution_note ||
    !row.resolution_resolved_at
  ) {
    return undefined;
  }

  const winningOutcomeKey = resolvePassiveOutcomeKey(row.winning_outcome_id);

  return {
    winningOutcomeKey,
    winningOutcomeLabel: row.winning_outcome_label,
    sourceUrl: row.resolution_source_url,
    explanation: row.resolution_note,
    resolvedAtLabel: formatUpdatedLabel(row.resolution_resolved_at)
  };
}

export function buildResultSummary(
  row: MarketDetailRow
): NonNullable<MarketDetailPassiveRecord["snapshot"]["result"]> {
  const isResolved = row.market_status === "resolved";
  const winningOutcomeKey = isResolved && row.winning_outcome_id
    ? resolvePassiveOutcomeKey(row.winning_outcome_id)
    : null;
  const resolvedAt = isResolved ? row.market_resolved_at ?? row.resolution_resolved_at : null;

  return {
    status: row.market_status,
    settlementStatus: isResolved ? row.settlement_status ?? null : null,
    resolvedAt: resolvedAt?.toISOString() ?? null,
    resolvedAtLabel: resolvedAt ? formatUpdatedLabel(resolvedAt) : null,
    winner:
      isResolved && row.winning_outcome_id && winningOutcomeKey && row.winning_outcome_label
        ? {
            outcomeId: row.winning_outcome_id,
            outcomeKey: winningOutcomeKey,
            label: row.winning_outcome_label
          }
        : null,
    source: {
      label:
        readContractResolutionSourceLabel(row.market_contract) ??
        (typeof row.resolution_source === "string" && row.resolution_source.trim().length > 0
          ? stripResolutionSourceUrl(row.resolution_source)
          : null),
      url:
        readPublicResolutionSourceUrl(row.resolution_source, row.resolution_source_url) ??
        readContractResolutionSourceUrl(row.market_contract),
      rules:
        typeof row.resolution_rules === "string" && row.resolution_rules.trim().length > 0
          ? publicizeResolutionSourceText(row.resolution_rules)
          : null,
      explanation:
        typeof row.resolution_note === "string" && row.resolution_note.trim().length > 0
          ? row.resolution_note.trim()
          : null
    }
  };
}

function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeOracleSourcePolicy(value: unknown): OracleSourcePolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const policy: OracleSourcePolicy = {
    preferredSourceIds: readStringArray(candidate.preferredSourceIds),
    fallbackSourceIds: readStringArray(candidate.fallbackSourceIds),
    contextSourceIds: readStringArray(candidate.contextSourceIds),
    closeConditionSourceIds: readStringArray(candidate.closeConditionSourceIds),
    resolutionSourceIds: readStringArray(candidate.resolutionSourceIds),
    notes: readStringArray(candidate.notes)
  };

  if (typeof candidate.requiresHumanReviewOnSourceConflict === "boolean") {
    policy.requiresHumanReviewOnSourceConflict =
      candidate.requiresHumanReviewOnSourceConflict;
  }

  if (typeof candidate.requiresHumanReviewOnWeakAuthority === "boolean") {
    policy.requiresHumanReviewOnWeakAuthority =
      candidate.requiresHumanReviewOnWeakAuthority;
  }

  if (
    (policy.preferredSourceIds?.length ?? 0) === 0 &&
    (policy.fallbackSourceIds?.length ?? 0) === 0 &&
    (policy.contextSourceIds?.length ?? 0) === 0 &&
    (policy.closeConditionSourceIds?.length ?? 0) === 0 &&
    (policy.resolutionSourceIds?.length ?? 0) === 0 &&
    (policy.notes?.length ?? 0) === 0 &&
    policy.requiresHumanReviewOnSourceConflict == null &&
    policy.requiresHumanReviewOnWeakAuthority == null
  ) {
    return null;
  }

  return policy;
}

function readContractResolutionSourceUrl(value: unknown): string | null {
  const contract = buildPublicMarketContract(value);

  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return null;
  }

  const source = (contract as Record<string, unknown>).resolutionSource;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const url = (source as Record<string, unknown>).url;

  return typeof url === "string" ? readPublicResolutionSourceUrl(null, url) : null;
}

function readContractResolutionSourceLabel(value: unknown): string | null {
  const contract = buildPublicMarketContract(value);

  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return null;
  }

  const source = (contract as Record<string, unknown>).resolutionSource;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const label = (source as Record<string, unknown>).label;

  return typeof label === "string" && label.trim().length > 0 ? label.trim() : null;
}

export function buildTrustSummary(
  row: MarketDetailRow
): MarketDetailPassiveRecord["snapshot"]["trust"] {
  const policy = normalizeOracleSourcePolicy(row.oracle_source_policy);
  const trustNotes = policy?.notes ?? [];
  const sourceRolePlan = {
    wake: [] as string[],
    ground: [] as string[],
    resolve: [] as string[],
    integrity: [] as string[]
  };
  const fetchNeeds: string[] = [];

  for (const note of trustNotes) {
    if (note.startsWith("wake-role=")) {
      sourceRolePlan.wake.push(publicizeResolutionSourceText(note.slice("wake-role=".length)) ?? note.slice("wake-role=".length));
      continue;
    }

    if (note.startsWith("ground-role=")) {
      sourceRolePlan.ground.push(publicizeResolutionSourceText(note.slice("ground-role=".length)) ?? note.slice("ground-role=".length));
      continue;
    }

    if (note.startsWith("resolve-role=")) {
      sourceRolePlan.resolve.push(publicizeResolutionSourceText(note.slice("resolve-role=".length)) ?? note.slice("resolve-role=".length));
      continue;
    }

    if (note.startsWith("integrity-role=")) {
      sourceRolePlan.integrity.push(publicizeResolutionSourceText(note.slice("integrity-role=".length)) ?? note.slice("integrity-role=".length));
      continue;
    }

    if (note.startsWith("fetch-needed=")) {
      fetchNeeds.push(note.slice("fetch-needed=".length));
    }
  }

  const hasTrust =
    (typeof row.resolution_source === "string" && row.resolution_source.trim().length > 0) ||
    (typeof row.resolution_rules === "string" && row.resolution_rules.trim().length > 0) ||
    policy != null;

  if (!hasTrust) {
    return undefined;
  }

  return {
    resolutionSource:
      readContractResolutionSourceLabel(row.market_contract) ??
      (typeof row.resolution_source === "string" && row.resolution_source.trim().length > 0
        ? stripResolutionSourceUrl(row.resolution_source)
        : null),
    sourceUrl:
      readPublicResolutionSourceUrl(row.resolution_source, row.resolution_source_url) ??
      readContractResolutionSourceUrl(row.market_contract),
    resolutionRules:
      typeof row.resolution_rules === "string" && row.resolution_rules.trim().length > 0
        ? publicizeResolutionSourceText(row.resolution_rules)
        : null,
    sourceRolePlan: {
      wake: [...new Set(sourceRolePlan.wake)],
      ground: [...new Set(sourceRolePlan.ground)],
      resolve: [...new Set(sourceRolePlan.resolve)],
      integrity: [...new Set(sourceRolePlan.integrity)]
    },
    fetchNeeds: [...new Set(fetchNeeds)],
    sourcePolicySummary: {
      preferredSourceCount: policy?.preferredSourceIds?.length ?? 0,
      contextSourceCount: policy?.contextSourceIds?.length ?? 0,
      closeConditionSourceCount: policy?.closeConditionSourceIds?.length ?? 0,
      resolutionSourceCount: policy?.resolutionSourceIds?.length ?? 0,
      fallbackSourceCount: policy?.fallbackSourceIds?.length ?? 0,
      requiresHumanReviewOnSourceConflict:
        policy?.requiresHumanReviewOnSourceConflict === true,
      requiresHumanReviewOnWeakAuthority:
        policy?.requiresHumanReviewOnWeakAuthority === true
    }
  };
}

export function buildMarketContract(
  row: MarketDetailRow
): MarketDetailPassiveRecord["snapshot"]["contract"] {
  return buildPublicMarketContract(row.market_contract) as
    | MarketDetailPassiveRecord["snapshot"]["contract"]
    | undefined;
}
