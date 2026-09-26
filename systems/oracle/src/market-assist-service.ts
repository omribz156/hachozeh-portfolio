import {
  type Queryable,
  resolveCanonicalMarketKeyById,
  resolveOutcomeKey
} from "../../back/src/platform-surface/oracle";
import { isOracleCaseType, type OracleCaseType, type OracleSourcePolicy } from "./contracts";
import { resolveMarketIdFromInput } from "./inspect-market-service";

type MarketRow = {
  id: string;
  title: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  resolution_source: string;
  oracle_source_policy: unknown;
};

type OutcomeRow = {
  id: string;
  label: string;
  short_label: string | null;
  is_winner: boolean | null;
};

export type OracleMarketAssist = {
  objectType: "oracle_market_assist";
  requestedMarket: string;
  marketId: string;
  canonicalMarketKey: string | null;
  marketTitle: string;
  marketStatus: "draft" | "open" | "closed" | "resolved" | "voided";
  caseType: OracleCaseType;
  requiresWinningOutcome: boolean;
  resolutionSource: string;
  outcomes: Array<{
    outcomeId: string;
    outcomeKey: string;
    label: string;
    shortLabel: string | null;
    isWinner: boolean | null;
  }>;
  sourcePolicySummary: {
    configuredSourceCount: number;
    contextSourceCount: number;
    closeConditionSourceCount: number;
    resolutionSourceCount: number;
    fallbackSourceCount: number;
    requiresHumanReviewOnSourceConflict: boolean | null;
    requiresHumanReviewOnWeakAuthority: boolean | null;
    notes: string[];
  };
};

export class OracleMarketAssistError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OracleMarketAssistError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeOracleSourcePolicy(value: unknown): OracleSourcePolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  function readStringArray(fieldName: keyof OracleSourcePolicy): string[] | undefined {
    const raw = candidate[fieldName];

    if (!Array.isArray(raw)) {
      return undefined;
    }

    const items = raw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    return items.length > 0 ? items : undefined;
  }

  const policy: OracleSourcePolicy = {
    preferredSourceIds: readStringArray("preferredSourceIds"),
    fallbackSourceIds: readStringArray("fallbackSourceIds"),
    contextSourceIds: readStringArray("contextSourceIds"),
    closeConditionSourceIds: readStringArray("closeConditionSourceIds"),
    resolutionSourceIds: readStringArray("resolutionSourceIds"),
    notes: readStringArray("notes")
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
    !policy.preferredSourceIds &&
    !policy.fallbackSourceIds &&
    !policy.contextSourceIds &&
    !policy.closeConditionSourceIds &&
    !policy.resolutionSourceIds &&
    !policy.notes &&
    policy.requiresHumanReviewOnSourceConflict == null &&
    policy.requiresHumanReviewOnWeakAuthority == null
  ) {
    return null;
  }

  return policy;
}

export async function readOracleMarketAssist(
  db: Queryable,
  marketInput: string,
  options?: {
    caseType?: OracleCaseType;
  }
): Promise<OracleMarketAssist> {
  const requestedMarket = marketInput.trim();

  if (!requestedMarket) {
    throw new OracleMarketAssistError(400, "invalid_request", "market is required.");
  }

  const marketId = resolveMarketIdFromInput(requestedMarket);
  const caseType = options?.caseType ?? "resolution_check";

  if (!isOracleCaseType(caseType)) {
    throw new OracleMarketAssistError(
      400,
      "invalid_request",
      "caseType must be one of: close_condition_check, resolution_check."
    );
  }

  const marketResult = await db.query<MarketRow>(
    `
      select
        id,
        title,
        status,
        resolution_source,
        oracle_source_policy
      from markets
      where id = $1
      limit 1
    `,
    [marketId]
  );
  const market = marketResult.rows[0];

  if (!market) {
    throw new OracleMarketAssistError(404, "market_not_found", `Market not found: ${marketId}`);
  }

  const outcomesResult = await db.query<OutcomeRow>(
    `
      select
        id,
        label,
        short_label,
        is_winner
      from market_outcomes
      where market_id = $1
      order by sort_order asc, id asc
    `,
    [market.id]
  );

  if (outcomesResult.rows.length === 0) {
    throw new OracleMarketAssistError(
      409,
      "market_missing_outcomes",
      `Market has no outcomes: ${market.id}`
    );
  }

  const sourcePolicy = normalizeOracleSourcePolicy(market.oracle_source_policy);
  const contextSourceIds = sourcePolicy?.contextSourceIds ?? [];
  const closeConditionSourceIds = sourcePolicy?.closeConditionSourceIds ?? sourcePolicy?.preferredSourceIds ?? [];
  const resolutionSourceIds = sourcePolicy?.resolutionSourceIds ?? sourcePolicy?.preferredSourceIds ?? [];
  const fallbackSourceIds = sourcePolicy?.fallbackSourceIds ?? [];

  return {
    objectType: "oracle_market_assist",
    requestedMarket,
    marketId: market.id,
    canonicalMarketKey: resolveCanonicalMarketKeyById(market.id),
    marketTitle: market.title,
    marketStatus: market.status,
    caseType,
    requiresWinningOutcome: caseType === "resolution_check",
    resolutionSource: market.resolution_source,
    outcomes: outcomesResult.rows.map((row) => ({
      outcomeId: row.id,
      outcomeKey: resolveOutcomeKey(row.id) ?? row.id,
      label: row.label,
      shortLabel: row.short_label,
      isWinner: row.is_winner
    })),
    sourcePolicySummary: {
      configuredSourceCount: new Set([
        ...contextSourceIds,
        ...closeConditionSourceIds,
        ...resolutionSourceIds,
        ...fallbackSourceIds
      ]).size,
      contextSourceCount: contextSourceIds.length,
      closeConditionSourceCount: closeConditionSourceIds.length,
      resolutionSourceCount: resolutionSourceIds.length,
      fallbackSourceCount: fallbackSourceIds.length,
      requiresHumanReviewOnSourceConflict:
        sourcePolicy?.requiresHumanReviewOnSourceConflict ?? null,
      requiresHumanReviewOnWeakAuthority:
        sourcePolicy?.requiresHumanReviewOnWeakAuthority ?? null,
      notes: sourcePolicy?.notes ?? []
    }
  };
}
