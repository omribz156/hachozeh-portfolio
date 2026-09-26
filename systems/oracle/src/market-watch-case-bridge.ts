import type { Pool } from "pg";

import type { MarketWatchPlan, MarketWatchSignal } from "../../back/src/market-watch/service";
import { inspectOracleMarket } from "./inspect-market-service";

type MarketWatchTargetRow = {
  id: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  title: string;
  resolution_source: string;
  market_contract: unknown;
};

type MarketWatchTarget = {
  marketId: string;
  title: string;
  sourceId?: string;
  sourceLabel: string;
};

export type MarketWatchCasePromotionResult =
  | {
      status: "promoted";
      marketId: string;
      oracleCaseId: string;
    }
  | {
      status: "not_actionable";
      code: "keyword_not_close_condition" | "market_not_open";
    }
  | {
      status: "blocked";
      code: "no_open_child_match" | "ambiguous_open_child_match";
      detail: string;
    };

type InspectOracleMarket = typeof inspectOracleMarket;

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readString).filter((item): item is string => Boolean(item))
    : [];
}

function normalizeComparable(value: string): string {
  return value.toLocaleLowerCase("he-IL").replace(/[^\p{L}\p{N}]+/gu, "");
}

function contractAliases(contractValue: unknown): string[] {
  const contract = readRecord(contractValue);
  const timeline = readRecord(contract.timeline);
  const displayHints = readRecord(contract.displayHints);
  const taxonomy = readRecord(contract.taxonomy);

  return [
    readString(timeline.targetEntity),
    readString(displayHints.targetEntity),
    ...readStringArray(taxonomy.aliases)
  ].filter((item): item is string => Boolean(item));
}

function contractSource(contractValue: unknown, fallbackLabel: string): {
  sourceId?: string;
  sourceLabel: string;
} {
  const contract = readRecord(contractValue);
  const resolutionSource = readRecord(contract.resolutionSource);
  const sourceId = readStringArray(resolutionSource.sourceIds)[0];

  return {
    sourceId,
    sourceLabel: readString(resolutionSource.label) ?? fallbackLabel
  };
}

export function isMarketWatchCloseConditionKeyword(keyword: string): boolean {
  const normalized = normalizeComparable(keyword);
  return normalized.startsWith("הודח") || normalized.startsWith("פרש");
}

async function readMatchingOpenTarget(
  pool: Pool,
  input: {
    plan: Pick<MarketWatchPlan, "marketId" | "eventId">;
    matchedEntity: string;
  }
): Promise<MarketWatchTarget | MarketWatchCasePromotionResult> {
  const result = await pool.query<MarketWatchTargetRow>(
    `
      select
        m.id,
        m.status,
        m.title,
        m.resolution_source,
        m.market_contract
      from markets m
      where (
          ($1::text is not null and m.id = $1)
          or ($1::text is null and $2::text is not null and m.event_id = $2)
        )
      order by m.id asc
    `,
    [input.plan.marketId, input.plan.eventId]
  );
  const normalizedEntity = normalizeComparable(input.matchedEntity);
  const matches = result.rows.filter((row) =>
    contractAliases(row.market_contract)
      .map(normalizeComparable)
      .includes(normalizedEntity)
  );
  const openMatches = matches.filter((row) => row.status === "open");

  if (openMatches.length === 0 && matches.length === 0) {
    return {
      status: "blocked",
      code: "no_open_child_match",
      detail: `No open market matched watch entity: ${input.matchedEntity}`
    };
  }

  if (openMatches.length === 0) {
    return {
      status: "not_actionable",
      code: "market_not_open"
    };
  }

  if (openMatches.length > 1) {
    return {
      status: "blocked",
      code: "ambiguous_open_child_match",
      detail: `Watch entity matched multiple open markets: ${openMatches.map((row) => row.id).join(", ")}`
    };
  }

  const row = openMatches[0]!;
  const source = contractSource(row.market_contract, row.resolution_source);
  return {
    marketId: row.id,
    title: row.title,
    ...source
  };
}

export async function promoteMarketWatchSignalToOracleCase(
  pool: Pool,
  input: {
    signalId: string;
    plan: Pick<MarketWatchPlan, "marketId" | "eventId">;
    signal: Pick<
      MarketWatchSignal,
      | "matchedEntity"
      | "matchedKeyword"
      | "sourceUrl"
      | "sourceTitle"
      | "summary"
      | "observedAt"
      | "payload"
    >;
  },
  dependencies: {
    inspectOracleMarket: InspectOracleMarket;
  } = {
    inspectOracleMarket
  }
): Promise<MarketWatchCasePromotionResult> {
  if (!isMarketWatchCloseConditionKeyword(input.signal.matchedKeyword)) {
    return {
      status: "not_actionable",
      code: "keyword_not_close_condition"
    };
  }

  const target = await readMatchingOpenTarget(pool, {
    plan: input.plan,
    matchedEntity: input.signal.matchedEntity
  });

  if ("status" in target) {
    return target;
  }

  const snippet = readString(input.signal.payload.snippet) ?? input.signal.summary;
  const result = await dependencies.inspectOracleMarket(
    pool,
    {
      marketId: target.marketId,
      caseType: "close_condition_check",
      closeConditionSatisfied: true,
      requiresHumanReview: true,
      ambiguityLevel: "low",
      sources: [
        {
          sourceId: target.sourceId,
          sourceUrl: input.signal.sourceUrl,
          sourceLabel: target.sourceLabel,
          sourceType: "official_show_watch",
          claimSummary: snippet,
          capturedAt: input.signal.observedAt
        }
      ],
      evidenceSummary: `Official show source reports that ${input.signal.matchedEntity} ${input.signal.matchedKeyword}.`,
      reasonSummary: `The watched entity appears with an elimination or withdrawal signal on the official show source.`,
      summary: `Market Watch found an early close condition for "${target.title}".`,
      reviewNotes: [
        `market_watch_signal_id=${input.signalId}`,
        `matched_entity=${input.signal.matchedEntity}`,
        `matched_keyword=${input.signal.matchedKeyword}`,
        `source_snippet=${snippet}`
      ].join("\n")
    },
    { persistResult: true }
  );

  return {
    status: "promoted",
    marketId: target.marketId,
    oracleCaseId: result.oracleCase.oracleCaseId
  };
}
