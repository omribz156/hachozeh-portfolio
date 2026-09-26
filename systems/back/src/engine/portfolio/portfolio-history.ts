import type { Queryable } from "../../db/client/pool";
import {
  quantizeMoney,
  quantizePrice,
  quantizeShares
} from "../../shared/decimals";
import {
  resolveCanonicalMarketKeyById,
  resolveOutcomeKey
} from "../../shared/market-identity";
import {
  EFFECTIVE_PROCEEDS_SQL,
  EFFECTIVE_REALIZATION_TYPE_SQL,
  EFFECTIVE_REALIZED_PNL_SQL,
  INCIDENT_COMPENSATION_LATERAL_JOIN
} from "../../shared/incident-compensation";

type TradeHistoryRow = {
  trade_id: string;
  created_at: Date;
  side: "buy" | "sell";
  contract_side: "yes" | "no";
  requested_outcome_key: string;
  requested_outcome_label: string | null;
  cash_amount: string;
  share_amount: string;
  avg_price: string;
  price_before: string;
  price_after: string;
  market_id: string;
  market_title: string;
  market_status: string;
  persisted_status?: string | null;
  outcome_id: string;
  outcome_label: string;
  execution_legs:
    | Array<{
        outcome_id: string;
        outcome_label: string;
        share_amount: string;
      }>
    | null;
};

type RealizationHistoryRow = {
  realization_id: string;
  created_at: Date;
  type: "sell" | "resolution_win" | "resolution_loss";
  shares_closed: string;
  proceeds: string;
  removed_cost_basis: string;
  realized_pnl: string;
  trade_id: string | null;
  resolution_id: string | null;
  market_id: string;
  market_title: string;
  market_status: string;
  persisted_status?: string | null;
  outcome_id: string;
  outcome_label: string;
};

export type HistoryCountsRow = {
  trade_count: number;
  buy_trade_count: number;
  sell_trade_count: number;
  realization_count: number;
};

export type PortfolioHistoryItem =
  | {
      kind: "trade";
      id: string;
      happenedAt: string;
      marketKey: string;
      marketId: string;
      marketTitle: string;
      marketStatus: string;
      persistedMarketStatus: string;
      effectiveMarketStatus: string;
      outcomeKey: string;
      outcomeId: string;
      outcomeLabel: string;
      contractSide: "yes" | "no";
      requestedOutcomeKey: string;
      requestedOutcomeLabel: string;
      executionOutcomeKey: string | null;
      executionOutcomeId: string | null;
      executionOutcomeLabel: string | null;
      executionLegs: Array<{
        outcomeKey: string;
        outcomeId: string;
        outcomeLabel: string;
        shareAmount: string;
      }>;
      side: "buy" | "sell";
      cashAmount: string;
      shareAmount: string;
      averagePrice: string;
      priceBefore: string;
      priceAfter: string;
    }
  | {
      kind: "realization";
      id: string;
      happenedAt: string;
      marketKey: string;
      marketId: string;
      marketTitle: string;
      marketStatus: string;
      persistedMarketStatus: string;
      effectiveMarketStatus: string;
      outcomeKey: string;
      outcomeId: string;
      outcomeLabel: string;
      realizationType: "sell" | "resolution_win" | "resolution_loss";
      sharesClosed: string;
      proceeds: string;
      removedCostBasis: string;
      realizedPnl: string;
      tradeId: string | null;
      resolutionId: string | null;
    };

export async function readTradeHistoryRows(
  db: Queryable,
  actorId: string,
  limit: number
): Promise<TradeHistoryRow[]> {
  const result = await db.query<TradeHistoryRow>(
    `
      select
        t.id as trade_id,
        t.created_at,
        t.side,
        t.contract_side,
        t.requested_outcome_key,
        requested_o.label as requested_outcome_label,
        t.cash_amount::text as cash_amount,
        t.share_amount::text as share_amount,
        t.avg_price::text as avg_price,
        t.price_before::text as price_before,
        t.price_after::text as price_after,
        t.market_id,
        m.title as market_title,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        t.outcome_id,
        o.label as outcome_label,
        coalesce(exec_legs.execution_legs, '[]'::json) as execution_legs
      from trades t
      join markets m
        on m.id = t.market_id
      join market_outcomes o
        on o.market_id = t.market_id
       and o.id = t.outcome_id
      left join market_outcomes requested_o
        on requested_o.market_id = t.market_id
       and requested_o.id = t.requested_outcome_key
      left join lateral (
        select json_agg(
          json_build_object(
            'outcome_id', leg.outcome_id,
            'outcome_label', exec_o.label,
            'share_amount', leg.share_amount::text
          )
          order by leg.sort_order asc, leg.id asc
        ) as execution_legs
        from trade_execution_legs leg
        join market_outcomes exec_o
          on exec_o.market_id = t.market_id
         and exec_o.id = leg.outcome_id
        where leg.trade_id = t.id
      ) exec_legs
        on true
      where t.user_id = $1
      order by t.created_at desc, t.id desc
      limit $2
    `,
    [actorId, limit]
  );

  return result.rows;
}

export async function readRealizationHistoryRows(
  db: Queryable,
  actorId: string,
  limit: number
): Promise<RealizationHistoryRow[]> {
  const result = await db.query<RealizationHistoryRow>(
    `
      select
        re.id as realization_id,
        re.created_at,
        ${EFFECTIVE_REALIZATION_TYPE_SQL} as type,
        re.shares_closed::text as shares_closed,
        ${EFFECTIVE_PROCEEDS_SQL}::text as proceeds,
        re.removed_cost_basis::text as removed_cost_basis,
        ${EFFECTIVE_REALIZED_PNL_SQL}::text as realized_pnl,
        re.trade_id,
        re.resolution_id,
        re.market_id,
        m.title as market_title,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        re.outcome_id,
        o.label as outcome_label
      from realization_events re
      join markets m
        on m.id = re.market_id
      join market_outcomes o
        on o.market_id = re.market_id
       and o.id = re.outcome_id
      left join market_resolutions mr
        on mr.id = re.resolution_id
      ${INCIDENT_COMPENSATION_LATERAL_JOIN}
      where re.user_id = $1
      order by re.created_at desc, re.id desc
      limit $2
    `,
    [actorId, limit]
  );

  return result.rows;
}

export async function readHistoryCounts(
  db: Queryable,
  actorId: string
): Promise<HistoryCountsRow> {
  const tradeCountsResult = await db.query<{
    trade_count: number;
    buy_trade_count: number;
    sell_trade_count: number;
  }>(
    `
      select
        count(*)::int as trade_count,
        count(*) filter (where side = 'buy')::int as buy_trade_count,
        count(*) filter (where side = 'sell')::int as sell_trade_count
      from trades
      where user_id = $1
    `,
    [actorId]
  );

  const realizationCountsResult = await db.query<{ realization_count: number }>(
    `
      select count(*)::int as realization_count
      from realization_events
      where user_id = $1
    `,
    [actorId]
  );

  return {
    trade_count: tradeCountsResult.rows[0]?.trade_count ?? 0,
    buy_trade_count: tradeCountsResult.rows[0]?.buy_trade_count ?? 0,
    sell_trade_count: tradeCountsResult.rows[0]?.sell_trade_count ?? 0,
    realization_count: realizationCountsResult.rows[0]?.realization_count ?? 0
  };
}

function mapTradeRow(row: TradeHistoryRow): PortfolioHistoryItem {
  const requestedOutcomeKey =
    row.requested_outcome_key ||
    resolveOutcomeKey(row.outcome_id) ||
    row.outcome_id;
  const requestedOutcomeLabel = row.requested_outcome_label || row.outcome_label;
  const executionLegs = Array.isArray(row.execution_legs)
    ? row.execution_legs.map((leg) => ({
        outcomeKey: resolveOutcomeKey(leg.outcome_id) ?? leg.outcome_id,
        outcomeId: leg.outcome_id,
        outcomeLabel: leg.outcome_label,
        shareAmount: quantizeShares(leg.share_amount)
      }))
    : [];
  const isBundleExecution = executionLegs.length > 1;

  return {
    kind: "trade",
    id: row.trade_id,
    happenedAt: row.created_at.toISOString(),
    marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
    marketId: row.market_id,
    marketTitle: row.market_title,
    marketStatus: row.market_status,
    persistedMarketStatus: row.persisted_status ?? row.market_status,
    effectiveMarketStatus: row.market_status,
    outcomeKey: requestedOutcomeKey,
    outcomeId: requestedOutcomeKey,
    outcomeLabel: requestedOutcomeLabel,
    contractSide: row.contract_side,
    requestedOutcomeKey,
    requestedOutcomeLabel,
    executionOutcomeKey: isBundleExecution
      ? null
      : resolveOutcomeKey(row.outcome_id) ?? row.outcome_id,
    executionOutcomeId: isBundleExecution ? null : row.outcome_id,
    executionOutcomeLabel: isBundleExecution ? null : row.outcome_label,
    executionLegs,
    side: row.side,
    cashAmount: quantizeMoney(row.cash_amount),
    shareAmount: quantizeShares(row.share_amount),
    averagePrice: quantizePrice(row.avg_price),
    priceBefore: quantizePrice(row.price_before),
    priceAfter: quantizePrice(row.price_after)
  };
}

function mapRealizationRow(row: RealizationHistoryRow): PortfolioHistoryItem {
  return {
    kind: "realization",
    id: row.realization_id,
    happenedAt: row.created_at.toISOString(),
    marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
    marketId: row.market_id,
    marketTitle: row.market_title,
    marketStatus: row.market_status,
    persistedMarketStatus: row.persisted_status ?? row.market_status,
    effectiveMarketStatus: row.market_status,
    outcomeKey: resolveOutcomeKey(row.outcome_id) ?? row.outcome_id,
    outcomeId: row.outcome_id,
    outcomeLabel: row.outcome_label,
    realizationType: row.type,
    sharesClosed: quantizeShares(row.shares_closed),
    proceeds: quantizeMoney(row.proceeds),
    removedCostBasis: quantizeMoney(row.removed_cost_basis),
    realizedPnl: quantizeMoney(row.realized_pnl),
    tradeId: row.trade_id,
    resolutionId: row.resolution_id
  };
}

export function mergeAndLimitHistoryItems(
  trades: TradeHistoryRow[],
  realizations: RealizationHistoryRow[],
  limit: number
): PortfolioHistoryItem[] {
  const items = [...trades.map(mapTradeRow), ...realizations.map(mapRealizationRow)];

  return items
    .sort((left, right) => {
      const leftTime = Date.parse(left.happenedAt);
      const rightTime = Date.parse(right.happenedAt);

      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      return right.id.localeCompare(left.id);
    })
    .slice(0, limit);
}

export function filterHistoryItemsForTimeframe(
  items: PortfolioHistoryItem[],
  asOf: string,
  lookbackHours: number | null,
  windowStartMs?: number | null
): PortfolioHistoryItem[] {
  if (lookbackHours == null && windowStartMs == null) {
    return items;
  }

  const asOfMs = Date.parse(asOf);

  if (!Number.isFinite(asOfMs)) {
    return items;
  }

  const thresholdMs =
    windowStartMs ??
    (lookbackHours == null ? null : asOfMs - lookbackHours * 60 * 60 * 1000);

  if (thresholdMs == null) {
    return items;
  }

  return items.filter((item) => Date.parse(item.happenedAt) >= thresholdMs);
}

export function sumRealizedPnl(items: PortfolioHistoryItem[]): string {
  let total = 0;

  for (const item of items) {
    if (item.kind !== "realization") {
      continue;
    }

    total += Number(item.realizedPnl);
  }

  return quantizeMoney(String(total));
}

export function countItemsByKind(
  items: PortfolioHistoryItem[]
): { tradeCount: number; realizationCount: number } {
  return items.reduce(
    (counts, item) => {
      if (item.kind === "trade") {
        counts.tradeCount += 1;
      } else if (item.kind === "realization") {
        counts.realizationCount += 1;
      }

      return counts;
    },
    {
      tradeCount: 0,
      realizationCount: 0
    }
  );
}

export function buildRealizedPnlSeries(
  snapshot: { asOf: string },
  filteredItems: PortfolioHistoryItem[]
): Array<{ at: string; value: string }> {
  const realizationItems = filteredItems
    .filter((item): item is Extract<PortfolioHistoryItem, { kind: "realization" }> => item.kind === "realization")
    .sort((left, right) => Date.parse(left.happenedAt) - Date.parse(right.happenedAt));
  let runningValue = 0;
  const points: Array<{ at: string; value: string }> = [
    {
      at: realizationItems[0]?.happenedAt ?? snapshot.asOf,
      value: quantizeMoney("0")
    }
  ];

  for (const item of realizationItems) {
    runningValue += Number.isFinite(Number(item.realizedPnl)) ? Number(item.realizedPnl) : 0;
    points.push({
      at: item.happenedAt,
      value: quantizeMoney(String(runningValue))
    });
  }

  if (points[points.length - 1]?.at !== snapshot.asOf) {
    points.push({
      at: snapshot.asOf,
      value: points[points.length - 1]?.value ?? quantizeMoney("0")
    });
  }

  return points;
}
