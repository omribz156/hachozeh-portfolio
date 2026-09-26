import type { Pool } from "pg";

import { resolveOutcomeKey } from "../../back/src/platform-surface/oracle";
import { outcomeMatchesNbaWinner } from "./adapters/nba-source-adapter";
import type {
  OracleLifecycleSourceContext,
  OracleSourceInspection
} from "./source-adapter-contracts";
import { normalizeMarketContract } from "./source-adapter-contracts";

export type ClosedNoCaseMarketRow = {
  market_id: string;
  market_title: string;
  close_at: Date | null;
  closed_at: Date | null;
  resolution_source: string | null;
  resolution_rules: string | null;
  oracle_source_policy: unknown;
  market_contract: unknown;
};

export type OutcomeRow = {
  id: string;
  label: string;
};

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export async function readClosedNoCaseMarkets(
  db: Pool,
  options: {
    marketId?: string;
    limit: number;
  }
): Promise<ClosedNoCaseMarketRow[]> {
  const values: unknown[] = [];
  const where = [
    "m.status = 'closed'",
    "m.resolved_at is null",
    `not exists (
      select 1
      from oracle_cases oc
      where oc.market_id = m.id
        and oc.case_type = 'resolution_check'
        and not exists (
          select 1
          from oracle_case_reviews ocr
          where ocr.oracle_case_id = oc.id
            and ocr.result_status = 'completed'
            and ocr.review_action in ('reject_case', 'request_more_evidence')
        )
    )`
  ];

  if (options.marketId) {
    values.push(options.marketId);
    where.push(`m.id = $${values.length}`);
  }

  values.push(options.limit);

  const result = await db.query<ClosedNoCaseMarketRow>(
    `
      select
        m.id as market_id,
        m.title as market_title,
        m.close_at,
        m.closed_at,
        m.resolution_source,
        m.resolution_rules,
        m.oracle_source_policy,
        m.market_contract
      from (
        select
          m.*
        from markets m
      ) m
      where ${where.join(" and ")}
      order by m.closed_at nulls last, m.close_at nulls last
      limit $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function readMarketOutcomes(
  db: Pool,
  marketId: string
): Promise<OutcomeRow[]> {
  const result = await db.query<OutcomeRow>(
    `
      select
        id,
        label
      from market_outcomes
      where market_id = $1
      order by sort_order asc, id asc
    `,
    [marketId]
  );

  return result.rows;
}

function readOutcomeTail(marketId: string, outcomeId: string): string {
  const prefix = `${marketId}-`;

  if (outcomeId.startsWith(prefix)) {
    return outcomeId.slice(prefix.length);
  }

  return resolveOutcomeKey(outcomeId) ?? outcomeId;
}

export function buildSourceContext(
  market: ClosedNoCaseMarketRow,
  outcomes: OutcomeRow[]
): OracleLifecycleSourceContext {
  const marketContract = normalizeMarketContract(market.market_contract);
  const contractResolutionSource = marketContract?.resolutionSource?.url?.trim() || null;

  return {
    marketId: market.market_id,
    marketTitle: market.market_title,
    marketStatus: "closed",
    closeAt: market.close_at?.toISOString() ?? "",
    closeOnEventCompletion: true,
    eventCompletionCloseRequiresHumanApproval: true,
    resolutionSource: market.resolution_source ?? contractResolutionSource ?? "",
    resolutionRules: market.resolution_rules ?? marketContract?.resolutionRule ?? "",
    oracleSourcePolicy:
      market.oracle_source_policy &&
      typeof market.oracle_source_policy === "object" &&
      !Array.isArray(market.oracle_source_policy)
        ? (market.oracle_source_policy as OracleLifecycleSourceContext["oracleSourcePolicy"])
        : null,
    marketContract,
    outcomes: outcomes.map((outcome) => ({
      outcomeId: outcome.id,
      outcomeKey: resolveOutcomeKey(outcome.id) ?? outcome.id,
      label: outcome.label
    }))
  };
}

function findOutcomeByAliases(
  marketId: string,
  outcomes: OutcomeRow[],
  aliases: string[]
): OutcomeRow | null {
  const candidates = aliases.map(normalizeComparable).filter(Boolean);

  return (
    outcomes.find((outcome) => {
      const label = normalizeComparable(outcome.label);
      const key = normalizeComparable(readOutcomeTail(marketId, outcome.id));

      return candidates.some(
        (candidate) =>
          label === candidate ||
          key === candidate ||
          label.includes(candidate) ||
          candidate.includes(label)
      );
    }) ?? null
  );
}

function findOutcomeByExactAliases(
  marketId: string,
  outcomes: OutcomeRow[],
  aliases: string[]
): OutcomeRow | null {
  const candidates = new Set(aliases.map(normalizeComparable).filter(Boolean));

  return (
    outcomes.find((outcome) =>
      candidates.has(normalizeComparable(outcome.label)) ||
      candidates.has(normalizeComparable(readOutcomeTail(marketId, outcome.id)))
    ) ?? null
  );
}

function findWinningOutcomeByContractEvidenceKey(
  context: OracleLifecycleSourceContext,
  outcomes: OutcomeRow[],
  inspection: OracleSourceInspection
): OutcomeRow | null {
  if (!inspection.evidenceKey || !context.marketContract?.outcomeMap?.length) {
    return null;
  }

  const mappedOutcome = context.marketContract.outcomeMap.find(
    (outcome) => outcome.evidenceKey === inspection.evidenceKey
  );

  if (!mappedOutcome) {
    return null;
  }

  const aliases = [mappedOutcome.outcomeLabel, mappedOutcome.evidenceKey].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  return findOutcomeByExactAliases(context.marketId, outcomes, aliases);
}

function findWinningOutcomeBySourceFallback(
  context: OracleLifecycleSourceContext,
  outcomes: OutcomeRow[],
  inspection: OracleSourceInspection
): OutcomeRow | null {
  const marketId = context.marketId;

  if (inspection.sourceFamily === "nba_official_game") {
    return (
      outcomes.find((outcome) =>
        outcomeMatchesNbaWinner(
          outcome.label,
          readOutcomeTail(marketId, outcome.id),
          inspection
        )
      ) ?? null
    );
  }

  if (inspection.winnerKind === "draw") {
    return findOutcomeByAliases(marketId, outcomes, ["תיקו", "draw", "tie"]);
  }

  if (
    (inspection.sourceFamily === "nike_liga_match_page" ||
      inspection.winnerKind === "home" ||
      inspection.winnerKind === "away") &&
    outcomes.length === 3
  ) {
    if (inspection.winnerKind === "home") {
      return outcomes[0] ?? null;
    }

    if (inspection.winnerKind === "away") {
      return outcomes[2] ?? null;
    }
  }

  return findOutcomeByAliases(marketId, outcomes, [
    inspection.winnerLabel ?? "",
    String(inspection.normalizedSnapshot.winnerLabel ?? "")
  ]);
}

export function findWinningOutcomeForInspection(
  context: OracleLifecycleSourceContext,
  outcomes: OutcomeRow[],
  inspection: OracleSourceInspection
): OutcomeRow | null {
  return (
    findWinningOutcomeByContractEvidenceKey(context, outcomes, inspection) ??
    // Compatibility path for older contracts/adapters that do not expose evidenceKey -> outcomeMap.
    findWinningOutcomeBySourceFallback(context, outcomes, inspection)
  );
}

export function resolveContractOutcomeKey(
  context: OracleLifecycleSourceContext,
  winningOutcome: OutcomeRow
): string {
  const mappedOutcome = context.marketContract?.outcomeMap?.find(
    (outcome) =>
      outcome.outcomeLabel &&
      normalizeComparable(outcome.outcomeLabel) === normalizeComparable(winningOutcome.label)
  );

  return mappedOutcome?.evidenceKey ?? resolveOutcomeKey(winningOutcome.id) ?? winningOutcome.id;
}

export function readOfficialStatus(inspection: OracleSourceInspection): string {
  const officialStatus = inspection.normalizedSnapshot.officialStatus;
  return typeof officialStatus === "string" && officialStatus.trim().length > 0
    ? officialStatus.trim()
    : inspection.status;
}
