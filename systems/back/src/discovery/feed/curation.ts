import type { QueryResult } from "pg";

import type { Queryable } from "../../db/client/pool";
import type { DiscoveryFeedItem } from "./types";

export type DiscoveryCurationSurface = "hero" | "trending";
export type DiscoveryCurationTargetType = "market" | "event";

export type DiscoveryCurationSlot = {
  surface: DiscoveryCurationSurface;
  position: number;
  targetType: DiscoveryCurationTargetType;
  targetKey: string;
  note: string | null;
};

export type DiscoveryCurationSettings = {
  surface: DiscoveryCurationSurface;
  maxItems: number | null;
  fill: boolean | null;
  note: string | null;
};

type DiscoveryCurationSlotRow = {
  surface: DiscoveryCurationSurface;
  position: number;
  target_type: DiscoveryCurationTargetType;
  target_key: string;
  note: string | null;
};

type DiscoveryCurationSettingsRow = {
  surface: DiscoveryCurationSurface;
  max_items: number | string | null;
  fill: boolean | null;
  note: string | null;
};

export async function readActiveDiscoveryCurationSlots(
  db: Queryable
): Promise<DiscoveryCurationSlot[]> {
  let result: QueryResult<DiscoveryCurationSlotRow>;

  try {
    result = await db.query<DiscoveryCurationSlotRow>(
      `
        select surface, position, target_type, target_key, note
        from discovery_curation_slots
        where enabled = true
          and (starts_at is null or starts_at <= now())
          and (ends_at is null or ends_at > now())
        order by surface asc, position asc
      `
    );
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      return [];
    }

    throw error;
  }

  return result.rows.map((row) => ({
    surface: row.surface,
    position: Number(row.position),
    targetType: row.target_type,
    targetKey: row.target_key,
    note: row.note
  }));
}

export async function readDiscoveryCurationSettings(
  db: Queryable
): Promise<Map<DiscoveryCurationSurface, DiscoveryCurationSettings>> {
  let result: QueryResult<DiscoveryCurationSettingsRow>;

  try {
    result = await db.query<DiscoveryCurationSettingsRow>(
      `
        select surface, max_items, fill, note
        from discovery_curation_settings
        order by surface asc
      `
    );
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      return new Map();
    }

    throw error;
  }

  return new Map(
    result.rows.map((row) => [
      row.surface,
      {
        surface: row.surface,
        maxItems: row.max_items === null ? null : Number(row.max_items),
        fill: row.fill,
        note: row.note
      }
    ])
  );
}

function matchesSlot(item: DiscoveryFeedItem, slot: DiscoveryCurationSlot): boolean {
  if (slot.targetType === "market") {
    return item.marketKey === slot.targetKey;
  }

  return (
    item.event?.eventKey === slot.targetKey ||
    item.event?.eventSlug === slot.targetKey ||
    item.event?.parentKey === slot.targetKey
  );
}

function readItemKey(item: DiscoveryFeedItem): string {
  return item.event?.parentKey ?? item.marketKey;
}

export function applyDiscoveryCuration(
  items: DiscoveryFeedItem[],
  slots: DiscoveryCurationSlot[],
  surface: DiscoveryCurationSurface,
  options: {
    limit?: number;
    fill?: boolean;
  } = {}
): DiscoveryFeedItem[] {
  const surfaceSlots = slots
    .filter((slot) => slot.surface === surface)
    .sort((left, right) => left.position - right.position);
  const selected: DiscoveryFeedItem[] = [];
  const selectedKeys = new Set<string>();

  for (const slot of surfaceSlots) {
    const item = items.find((candidate) => matchesSlot(candidate, slot));
    if (!item) continue;

    const itemKey = readItemKey(item);
    if (selectedKeys.has(itemKey)) continue;

    selected.push(item);
    selectedKeys.add(itemKey);

    if (options.limit && selected.length >= options.limit) {
      return selected.slice(0, options.limit);
    }
  }

  if (options.fill === false) {
    return options.limit ? selected.slice(0, options.limit) : selected;
  }

  for (const item of items) {
    const itemKey = readItemKey(item);
    if (selectedKeys.has(itemKey)) continue;
    selected.push(item);
    selectedKeys.add(itemKey);

    if (options.limit && selected.length >= options.limit) {
      break;
    }
  }

  return options.limit ? selected.slice(0, options.limit) : selected;
}
