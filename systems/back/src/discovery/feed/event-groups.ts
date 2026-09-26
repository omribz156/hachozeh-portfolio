import { toDecimal } from "../../shared/decimals";
import type { DiscoveryFeedRow } from "./types";

export type DiscoveryMarketRows = DiscoveryFeedRow[];

export type DiscoveryGroup = {
  groupKey: string;
  representativeMarketId: string;
  marketIds: string[];
  rows: DiscoveryMarketRows;
};

type EventDiscoveryFlags = {
  showParentInDiscovery: boolean;
  showChildrenInDiscovery: boolean;
};

export function readFirstDiscoveryRow(rows: DiscoveryFeedRow[]): DiscoveryFeedRow | null {
  return rows[0] ?? null;
}

export function groupRowsByMarket(rows: DiscoveryFeedRow[]): Map<string, DiscoveryMarketRows> {
  const groupedRows = new Map<string, DiscoveryMarketRows>();

  for (const row of rows) {
    const existingRows = groupedRows.get(row.market_id);

    if (existingRows) {
      existingRows.push(row);
      continue;
    }

    groupedRows.set(row.market_id, [row]);
  }

  return groupedRows;
}

function compareRepresentativeMarketRows(
  leftRows: DiscoveryMarketRows,
  rightRows: DiscoveryMarketRows
): number {
  const left = readFirstDiscoveryRow(leftRows);
  const right = readFirstDiscoveryRow(rightRows);

  if (!left || !right) {
    return left ? -1 : right ? 1 : 0;
  }

  return (
    left.close_at.getTime() - right.close_at.getTime() ||
    (left.published_at?.getTime() ?? 0) - (right.published_at?.getTime() ?? 0) ||
    left.market_id.localeCompare(right.market_id)
  );
}

function normalizeOutcomeLabel(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isCanonicalYesRow(row: DiscoveryFeedRow): boolean {
  const label = normalizeOutcomeLabel(row.outcome_short_label ?? row.outcome_label);

  return label === "yes" || label === "כן" || row.sort_order === 0;
}

function readEventChildDisplayLabel(rows: DiscoveryMarketRows): string {
  const firstRow = readFirstDiscoveryRow(rows);

  return (
    firstRow?.event_child_label?.trim() ||
    firstRow?.title?.trim() ||
    firstRow?.market_id ||
    "שוק"
  );
}

function readEventDiscoveryFlags(rows: DiscoveryMarketRows[]): EventDiscoveryFlags {
  const firstRow = rows.map(readFirstDiscoveryRow).find(Boolean);
  const flags = firstRow?.event_display_flags;

  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    return {
      showParentInDiscovery: true,
      showChildrenInDiscovery: false
    };
  }

  return {
    showParentInDiscovery: flags.showParentInDiscovery !== false,
    showChildrenInDiscovery: flags.showChildrenInDiscovery === true
  };
}

function sumDecimal(values: Array<string | null | undefined>): string {
  return values
    .reduce((sum, value) => {
      try {
        return sum.plus(toDecimal(String(value ?? "0")));
      } catch {
        return sum;
      }
    }, toDecimal(0))
    .toFixed(6);
}

function sumNumber(values: Array<number | string | null | undefined>): number {
  return values.reduce<number>((sum, value) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? sum + numeric : sum;
  }, 0);
}

function maxDate(values: Date[]): Date {
  return values.reduce((max, value) => (value > max ? value : max), values[0] ?? new Date(0));
}

function buildEventChildOptionRows(
  eventTitle: string | null,
  representativeRows: DiscoveryMarketRows,
  sortedMarketGroups: DiscoveryMarketRows[],
  aggregateVolume: string,
  aggregateRecentVolume: string,
  aggregateRecentCount: number,
  aggregateUpdatedAt: Date
): DiscoveryMarketRows {
  const representative = readFirstDiscoveryRow(representativeRows);

  if (!eventTitle || !representative) {
    return representativeRows.map((row) => ({
      ...row,
      total_volume: aggregateVolume,
      recent_trade_volume: aggregateRecentVolume,
      recent_trade_count: aggregateRecentCount,
      updated_at: aggregateUpdatedAt
    }));
  }

  return sortedMarketGroups.map((marketRows, index) => {
    const firstChildRow = readFirstDiscoveryRow(marketRows) ?? representative;
    const canonicalRow =
      marketRows.find(isCanonicalYesRow) ??
      firstChildRow;
    const childLabel = readEventChildDisplayLabel(marketRows);

    return {
      ...representative,
      title: eventTitle,
      discovery_shape: "multi",
      description: representative.description,
      close_at: representative.close_at,
      market_id: representative.market_id,
      outcome_count: sortedMarketGroups.length,
      total_volume: aggregateVolume,
      recent_trade_volume: aggregateRecentVolume,
      recent_trade_count: aggregateRecentCount,
      updated_at: aggregateUpdatedAt,
      outcome_id: firstChildRow.market_id,
      outcome_label: childLabel,
      outcome_short_label: childLabel,
      outcome_image_url: firstChildRow.outcome_image_url,
      sort_order: index,
      last_price: canonicalRow.last_price
    };
  });
}

export function buildDiscoveryGroups(
  groupedRowsByMarket: Map<string, DiscoveryMarketRows>,
  options?: {
    preferSingleChildEventCards?: boolean;
  }
): DiscoveryGroup[] {
  const eventMarketGroups = new Map<string, DiscoveryMarketRows[]>();

  for (const marketRows of groupedRowsByMarket.values()) {
    const firstRow = readFirstDiscoveryRow(marketRows);
    const eventId = firstRow?.event_id?.trim();

    if (!eventId) {
      continue;
    }

    const existingGroups = eventMarketGroups.get(eventId) ?? [];
    existingGroups.push(marketRows);
    eventMarketGroups.set(eventId, existingGroups);
  }

  const discoveryMarketGroups = new Map<string, DiscoveryMarketRows[]>();

  for (const marketRows of groupedRowsByMarket.values()) {
    const firstRow = readFirstDiscoveryRow(marketRows);
    const eventId = firstRow?.event_id?.trim() || null;
    const eventGroups = eventId ? eventMarketGroups.get(eventId) ?? [] : [];

    if (!eventId || eventGroups.length <= 1) {
      const groupKey = `market:${firstRow?.market_id ?? ""}`;
      const existingGroups = discoveryMarketGroups.get(groupKey) ?? [];
      const rows = options?.preferSingleChildEventCards && eventGroups.length === 1
        ? marketRows.map((row) => ({
            ...row,
            discovery_event_child_card: true
          }))
        : marketRows;
      existingGroups.push(rows);
      discoveryMarketGroups.set(groupKey, existingGroups);
      continue;
    }

    const flags = readEventDiscoveryFlags(eventGroups);

    if (flags.showParentInDiscovery) {
      const groupKey = `event:${eventId}`;
      const existingGroups = discoveryMarketGroups.get(groupKey) ?? [];
      existingGroups.push(marketRows);
      discoveryMarketGroups.set(groupKey, existingGroups);
    }

    if (flags.showChildrenInDiscovery) {
      const groupKey = `market:${firstRow?.market_id ?? ""}`;
      const existingGroups = discoveryMarketGroups.get(groupKey) ?? [];
      existingGroups.push(marketRows.map((row) => ({
        ...row,
        discovery_event_child_card: true
      })));
      discoveryMarketGroups.set(groupKey, existingGroups);
    }
  }

  return [...discoveryMarketGroups.entries()].map(([groupKey, marketGroups]) => {
    const sortedMarketGroups = [...marketGroups].sort(compareRepresentativeMarketRows);
    const representativeRows = sortedMarketGroups[0] ?? [];
    const firstRows = sortedMarketGroups
      .map(readFirstDiscoveryRow)
      .filter((row): row is DiscoveryFeedRow => Boolean(row));
    const aggregateVolume = sumDecimal(firstRows.map((row) => row.total_volume));
    const aggregateRecentVolume = sumDecimal(firstRows.map((row) => row.recent_trade_volume));
    const aggregateRecentCount = sumNumber(firstRows.map((row) => row.recent_trade_count));
    const aggregateUpdatedAt = maxDate(firstRows.map((row) => row.updated_at));
    const eventTitle = groupKey.startsWith("event:")
      ? firstRows.find((row) => row.event_title?.trim())?.event_title?.trim() ?? null
      : null;
    const rows = eventTitle
      ? buildEventChildOptionRows(
          eventTitle,
          representativeRows,
          sortedMarketGroups,
          aggregateVolume,
          aggregateRecentVolume,
          aggregateRecentCount,
          aggregateUpdatedAt
        )
      : representativeRows.map((row) => ({
          ...row,
          total_volume: aggregateVolume,
          recent_trade_volume: aggregateRecentVolume,
          recent_trade_count: aggregateRecentCount,
          updated_at: aggregateUpdatedAt
        }));

    return {
      groupKey,
      representativeMarketId: readFirstDiscoveryRow(representativeRows)?.market_id ?? groupKey,
      marketIds: firstRows.map((row) => row.market_id),
      rows
    };
  });
}
