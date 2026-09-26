import type { Pool } from "pg";

import { readMarketDetailEventChildren } from "../../db/read-models/market-detail/event-children-reader";
import { resolveMarketId } from "../market-api/identity";
import {
  readMarketHistory,
  type MarketHistoryReadOptions
} from "./market-history-service";

// Event-level history: one probability series per child market (each child's
// "Yes" outcome over time), assembled into the SAME `seriesByOutcome` payload
// shape the single-market /history endpoint returns — so the existing chart
// renderer + line-picker consume it unchanged. Each child is read through the
// existing per-market read pipeline (window+downsample+carry-forward, settlement
// shim), so every child shares the requested range. Children that opened later
// simply start their line at their own open — the chart plots each line on the
// shared continuous time axis (no shared bucket grid required).

type EventHistorySeries = {
  outcomeId: string;
  outcomeKey: string;
  label: string;
  shortLabel: string;
  sortOrder: number;
  points: Array<{ at: string; t: number; kind?: "settlement"; value: number | null }>;
};

export async function readEventHistory(
  pool: Pool,
  marketKey: string,
  options?: MarketHistoryReadOptions
): Promise<{
  eventId: string;
  range: string | null;
  asOf: string;
  seriesByOutcome: EventHistorySeries[];
} | null> {
  const marketId = resolveMarketId(marketKey);
  const childrenPayload = await readMarketDetailEventChildren(pool, marketId);

  if (!childrenPayload) {
    return null;
  }

  const { event, children } = childrenPayload;

  // Read every child's history in parallel. Each call caches independently by
  // (marketId, version, options), so this is safe to fan out.
  const histories = await Promise.all(
    children.map((child) => readMarketHistory(pool, child.marketId, options))
  );

  const seriesByOutcome = children
    .map((child, index): EventHistorySeries | null => {
      const history = histories[index];

      if (!history) {
        return null;
      }

      // The child's canonical "Yes" outcome; fall back to its first outcome /
      // first series for non-standard shapes.
      const yesOutcome =
        child.outcomes.find((outcome) => outcome.side === "yes") ?? child.outcomes[0];
      const series =
        history.seriesByOutcome.find(
          (entry) => entry.outcomeId === yesOutcome?.outcomeId
        ) ?? history.seriesByOutcome[0];

      if (!series) {
        return null;
      }

      return {
        // Key each line on the child marketId — the stable identity the chart's
        // color-slot + line-picker machinery keys on (one line per child).
        outcomeId: child.marketId,
        outcomeKey: child.marketId,
        label: child.label,
        shortLabel: child.label,
        sortOrder: index,
        // Keep the child's settlement snap as-is (kind:"settlement", value 1/0 —
        // winner→100, loser→0). The persist pass below then carries that 0/100
        // flat to the event's right edge so an eliminated child sits flat along
        // the bottom (winner along the top) instead of stubbing out at its
        // resolution.
        points: series.points.map((point) => ({
          at: point.at,
          t: point.t,
          ...(point.kind ? { kind: point.kind } : {}),
          value: point.value
        }))
      };
    })
    .filter((entry): entry is EventHistorySeries => entry !== null);

  // Persist each resolved child's line flat OUT to the event's right edge (the
  // latest timestamp across all children — live children run to "now"). A child
  // resolved early snaps to 0/100 at its resolution and then holds that flat to
  // the edge, instead of stubbing out where live children still run ("stuck").
  // We carry the terminal value forward (0 for eliminated → flat along the
  // bottom, 1 for the winner → flat along the top) and propagate the settlement
  // kind so the winner's 100% stays y-clamped on-canvas.
  const globalMaxT = seriesByOutcome.reduce((max, entry) => {
    const last = entry.points[entry.points.length - 1];
    return last && last.t > max ? last.t : max;
  }, 0);
  for (const entry of seriesByOutcome) {
    const last = entry.points[entry.points.length - 1];
    if (last && last.t < globalMaxT) {
      entry.points.push({
        at: new Date(globalMaxT * 1000).toISOString(),
        t: globalMaxT,
        value: last.value,
        ...(last.kind ? { kind: last.kind } : {})
      });
    }
  }

  return {
    eventId: event.id,
    range: options?.range ?? options?.interval ?? null,
    asOf: histories.find((history) => history?.asOf)?.asOf ?? new Date().toISOString(),
    seriesByOutcome
  };
}
