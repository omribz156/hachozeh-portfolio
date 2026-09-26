import { HISTORY_RANGE_MS } from "./normalizers";
import { readOutcomeKey } from "./identity";
import { readExecutionLegs } from "../../shared/execution-legs";
import type {
  MarketApiRow,
  MarketHistoryRange,
  MarketTradeRow
} from "./types";

function quantizeProbability(value: unknown, fallbackValue = 0): number {
  const parsed = Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Number(Math.min(Math.max(parsed, 0), 1).toFixed(8));
}

export type HistoryPoint = {
  at: string;
  t: number;
  label: string;
  kind?: "settlement";
  values: Record<string, number>;
};

function buildReplayValues(
  outcomeKeys: string[],
  qShares: number[],
  liquidityB: string
): Record<string, number> {
  const b = Number.parseFloat(liquidityB);
  const safeB = Number.isFinite(b) && b > 0 ? b : 100;
  const maxQ = Math.max(...qShares);
  const weights = qShares.map((qShare) => Math.exp((qShare - maxQ) / safeB));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const prices = weights.map((weight) => weight / weightSum);

  return Object.fromEntries(
    outcomeKeys.map((outcomeKey, index) => [
      outcomeKey,
      quantizeProbability(prices[index], 0)
    ])
  );
}

function reverseTradeFromReplayState(
  qShares: number[],
  outcomeIndexById: Map<string, number>,
  tradeRow: MarketTradeRow
): void {
  const legs = readExecutionLegs(tradeRow.execution_legs);
  const effectiveLegs = legs.length
    ? legs
    : [
        {
          outcome_id: tradeRow.outcome_id,
          share_amount: tradeRow.share_amount
        }
      ];
  const forwardMultiplier = tradeRow.side === "sell" ? -1 : 1;
  const reverseMultiplier = -forwardMultiplier;

  for (const leg of effectiveLegs) {
    const outcomeIndex = outcomeIndexById.get(leg.outcome_id);

    if (outcomeIndex === undefined) {
      continue;
    }

    const delta = Number.parseFloat(leg.share_amount) * reverseMultiplier;
    const nextValue = qShares[outcomeIndex] + (Number.isFinite(delta) ? delta : 0);

    qShares[outcomeIndex] = nextValue < 0 ? 0 : nextValue;
  }
}

export function buildHistoryPoints(
  rows: MarketApiRow[],
  tradeRows: MarketTradeRow[],
  options?: {
    asOf?: string;
    truncated?: boolean;
  }
): HistoryPoint[] {
  const [firstRow] = rows;

  if (!firstRow) {
    return [];
  }

  const sortedRows = [...rows].sort((left, right) => left.sort_order - right.sort_order);
  const outcomeKeys = sortedRows.map((row) => readOutcomeKey(row.outcome_id));
  const outcomeIndexById = new Map(
    sortedRows.map((row, index) => [row.outcome_id, index] as const)
  );
  const liquidityB = firstRow.liquidity_b || "100.00000000";
  const qShares = sortedRows.map((row) => {
    const parsed = Number.parseFloat(row.q_shares ?? "0");

    return Number.isFinite(parsed) ? parsed : 0;
  });
  const currentValues = buildReplayValues(outcomeKeys, qShares, liquidityB);
  const asOf = options?.asOf ?? firstRow.updated_at.toISOString();
  const asOfMs = Date.parse(asOf);
  const currentAt = Number.isFinite(asOfMs) ? new Date(asOfMs) : firstRow.updated_at;
  const points = [
    {
      at: currentAt.toISOString(),
      t: Math.floor(currentAt.getTime() / 1000),
      label: "current",
      values: currentValues
    }
  ];
  const sortedTradeRows = [...tradeRows].sort((left, right) => {
    const timeDelta = right.created_at.getTime() - left.created_at.getTime();

    return timeDelta || right.trade_id.localeCompare(left.trade_id);
  });

  for (const tradeRow of sortedTradeRows) {
    points.push({
      at: tradeRow.created_at.toISOString(),
      t: Math.floor(tradeRow.created_at.getTime() / 1000),
      label: "trade",
      values: buildReplayValues(outcomeKeys, qShares, liquidityB)
    });
    reverseTradeFromReplayState(qShares, outcomeIndexById, tradeRow);
  }

  const anchorTradeAt = sortedTradeRows.at(-1)?.created_at;
  const anchorAt =
    options?.truncated && anchorTradeAt && anchorTradeAt.getTime() > firstRow.open_at.getTime()
      ? anchorTradeAt
      : firstRow.open_at;

  points.push({
    at: anchorAt.toISOString(),
    t: Math.floor(anchorAt.getTime() / 1000),
    label: options?.truncated ? "history_start" : "open",
    values: buildReplayValues(outcomeKeys, qShares, liquidityB)
  });

  return points.sort((left, right) => {
    const timeDelta = Date.parse(left.at) - Date.parse(right.at);

    return timeDelta || left.label.localeCompare(right.label);
  });
}

export function resolveHistoryAsOf(rows: MarketApiRow[], endTs?: number | null): string {
  const [firstRow] = rows;

  if (!firstRow) {
    return new Date().toISOString();
  }

  if (endTs) {
    return new Date(endTs * 1000).toISOString();
  }

  if (firstRow.market_status === "open") {
    const now = new Date();

    if (now.getTime() > firstRow.updated_at.getTime()) {
      return now.toISOString();
    }
  }

  return firstRow.updated_at.toISOString();
}

export function scopeHistoryPointsToRange(
  points: HistoryPoint[],
  range: MarketHistoryRange,
  asOf: string,
  bounds?: {
    startTs?: number | null;
    endTs?: number | null;
  }
) {
  if (points.length === 0) {
    return points;
  }

  const asOfMs = Date.parse(asOf);

  if (!Number.isFinite(asOfMs)) {
    return points;
  }

  const startMs =
    bounds?.startTs !== null && bounds?.startTs !== undefined
      ? bounds.startTs * 1000
      : range === "all"
        ? null
        : asOfMs - HISTORY_RANGE_MS[range];
  const endMs =
    bounds?.endTs !== null && bounds?.endTs !== undefined
      ? bounds.endTs * 1000
      : null;

  if (startMs === null && endMs === null) {
    return points;
  }

  const scopedPoints = points.filter((point) => {
    const pointMs = Date.parse(point.at);

    return (
      Number.isFinite(pointMs) &&
      (startMs === null || pointMs >= startMs) &&
      (endMs === null || pointMs <= endMs)
    );
  });

  if (startMs === null) {
    return scopedPoints;
  }

  const priorPoint = [...points].reverse().find((point) => Date.parse(point.at) < startMs);

  if (!priorPoint) {
    return scopedPoints;
  }

  const rangeStartPoint = {
    at: new Date(startMs).toISOString(),
    t: Math.floor(startMs / 1000),
    label: "range_start",
    values: { ...priorPoint.values }
  };

  if (scopedPoints[0]?.t === rangeStartPoint.t) {
    return scopedPoints;
  }

  return [rangeStartPoint, ...scopedPoints];
}

export function buildHistorySeriesByOutcome(
  rows: MarketApiRow[],
  points: HistoryPoint[]
) {
  return [...rows]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((row) => {
      const outcomeKey = readOutcomeKey(row.outcome_id);

      return {
        outcomeKey,
        outcomeId: row.outcome_id,
        label: row.outcome_label,
        shortLabel: row.outcome_short_label ?? row.outcome_label,
        sortOrder: row.sort_order,
        points: points.map((point) => ({
          at: point.at,
          t: point.t,
          ...(point.kind ? { kind: point.kind } : {}),
          value: point.values[outcomeKey] ?? null
        }))
      };
    });
}

export function appendSettlementHistoryPoint(
  rows: MarketApiRow[],
  points: HistoryPoint[]
) {
  const [firstRow] = rows;
  const resolvedAt = firstRow?.market_resolved_at ?? firstRow?.resolution_resolved_at ?? null;
  const winningOutcomeId = firstRow?.winning_outcome_id ?? null;

  if (
    !firstRow ||
    firstRow.market_status !== "resolved" ||
    !resolvedAt ||
    !winningOutcomeId ||
    points.length === 0
  ) {
    return points;
  }

  const resolvedMs = resolvedAt.getTime();
  const resolvedTs = Math.floor(resolvedMs / 1000);
  const settlementValues = Object.fromEntries(
    [...rows]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((row) => [readOutcomeKey(row.outcome_id), row.outcome_id === winningOutcomeId ? 1 : 0])
  );

  return [
    ...points.filter((point) => Date.parse(point.at) <= resolvedMs && point.kind !== "settlement"),
    {
      at: resolvedAt.toISOString(),
      t: resolvedTs,
      label: "settlement",
      kind: "settlement" as const,
      values: settlementValues
    }
  ].sort((left, right) => {
    const timeDelta = Date.parse(left.at) - Date.parse(right.at);

    return timeDelta || left.label.localeCompare(right.label);
  });
}

export function buildHistoryMovementByOutcome(
  rows: MarketApiRow[],
  points: HistoryPoint[]
) {
  const firstPoint = points[0];
  const lastPoint = points.at(-1);

  return Object.fromEntries(
    [...rows]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((row) => {
        const outcomeKey = readOutcomeKey(row.outcome_id);
        const firstPrice = Number(firstPoint?.values[outcomeKey] ?? row.last_price);
        const lastPrice = Number(lastPoint?.values[outcomeKey] ?? row.last_price);
        const delta = lastPrice - firstPrice;

        return [
          outcomeKey,
          {
            outcomeKey,
            outcomeId: row.outcome_id,
            firstPrice: firstPrice.toFixed(8),
            lastPrice: lastPrice.toFixed(8),
            delta: delta.toFixed(8),
            displayDelta: `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%`
          }
        ];
      })
  );
}
