import type { Pool } from "pg";

import { createExpiringCache } from "../../shared/expiring-cache";
import {
  MARKET_DETAIL_RECORDS,
  type MarketDetailPassiveRecord
} from "../../http/routes/market-detail-fixtures";
import { readMarketCategoryMeta } from "../../shared/market-category";
import {
  MARKET_KEY_TO_FIXTURE_KEY,
  MARKET_KEY_TO_MARKET_ID
} from "./market-detail/identity";
import {
  buildGenericPassiveRecord,
  mergeFixturePassiveRecord
} from "./market-detail/passive-record-presenter";
import { readFamilyChain } from "./market-detail/chain-reader";
import {
  readMarketDetailEventChildren,
  readMarketDetailEventChildrenCacheFingerprint
} from "./market-detail/event-children-reader";
import { readMarketEventUpdates } from "./market-detail/event-updates-reader";
import { readMarketPriceTrades } from "./market-detail/trade-reader";
import type { MarketDetailRow } from "./market-detail/types";
import { buildVolumeSummary } from "./market-detail/volume-summary";

const MARKET_DETAIL_CACHE_TTL_MS = 2_000;
const MARKET_DETAIL_CACHE_MAX_ENTRIES = 500;
const MARKET_DETAIL_RECORD_CACHE = createExpiringCache<MarketDetailPassiveRecord>({
  ttlMs: MARKET_DETAIL_CACHE_TTL_MS,
  maxEntries: MARKET_DETAIL_CACHE_MAX_ENTRIES
});
const MARKET_DETAIL_IN_FLIGHT = new Map<string, Promise<MarketDetailPassiveRecord>>();

export type MarketDetailEventTarget = {
  eventId: string;
  eventSlug: string;
  marketKey: string;
  publicPath: string;
};

export function clearMarketDetailPassiveRecordCacheForTest(): void {
  MARKET_DETAIL_RECORD_CACHE.clear();
  MARKET_DETAIL_IN_FLIGHT.clear();
}

export function readMarketDetailPassiveRecordCacheStats() {
  return {
    ...MARKET_DETAIL_RECORD_CACHE.stats(),
    inFlight: MARKET_DETAIL_IN_FLIGHT.size
  };
}

function readCategoryMeta(categoryKey: string | null) {
  if (!categoryKey) {
    return null;
  }

  return readMarketCategoryMeta(categoryKey);
}

async function readMarketDetailTargetMarketId(pool: Pool, marketKey: string): Promise<string> {
  const staticMarketId = MARKET_KEY_TO_MARKET_ID[marketKey];

  if (staticMarketId) {
    return staticMarketId;
  }

  const result = await pool.query<{ market_id: string }>(
    `
      select market_id
      from (
        select m.id as market_id, 0 as rank, m.close_at, m.published_at
        from markets m
        where m.id = $1
        union all
        select m.id as market_id, 1 as rank, m.close_at, m.published_at
        from markets m
        where m.event_id = $1
          and m.published_at is not null
      ) candidates
      order by rank asc, close_at asc, published_at asc nulls last, market_id asc
      limit 1
    `,
    [marketKey]
  );

  return result.rows[0]?.market_id ?? marketKey;
}

export async function readMarketDetailEventTarget(
  pool: Pool,
  eventSlug: string
): Promise<MarketDetailEventTarget | null> {
  const normalizedSlug = eventSlug.trim().toLowerCase();

  if (!normalizedSlug) {
    return null;
  }

  const result = await pool.query<{
    event_id: string;
    event_slug: string;
    market_id: string;
  }>(
    `
      select
        e.id as event_id,
        e.slug as event_slug,
        m.id as market_id
      from events e
      join markets m
        on m.event_id = e.id
      where lower(e.slug) = $1
        and m.published_at is not null
      order by
        case
          when m.status = 'open' and m.close_at > now() then 0
          when m.status = 'closed' or (m.status = 'open' and m.close_at <= now()) then 1
          when m.status = 'resolved' then 2
          else 3
        end asc,
        m.close_at asc,
        m.published_at asc nulls last,
        m.id asc
      limit 1
    `,
    [normalizedSlug]
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    eventId: row.event_id,
    eventSlug: row.event_slug,
    marketKey: row.market_id,
    publicPath: `/event/${encodeURIComponent(row.event_slug)}`
  };
}

async function buildDbBackedMarketDetailPassiveRecord(
  pool: Pool,
  marketId: string,
  fixtureRecord: MarketDetailPassiveRecord | undefined,
  rows: MarketDetailRow[]
): Promise<MarketDetailPassiveRecord> {
  const [firstRow] = rows;
  const categoryMeta = readCategoryMeta(firstRow.category_key);
  const [chain, tradeRows, eventChildren, eventUpdates] = await Promise.all([
    readFamilyChain(pool, firstRow.market_family_key, marketId),
    readMarketPriceTrades(pool, marketId),
    readMarketDetailEventChildren(pool, marketId),
    readMarketEventUpdates(pool, marketId)
  ]);
  const volumeSummary = buildVolumeSummary(rows, tradeRows);

  const record = fixtureRecord
    ? mergeFixturePassiveRecord(
        fixtureRecord,
        rows,
        categoryMeta,
        chain,
        volumeSummary,
        eventUpdates,
        eventChildren
      )
    : buildGenericPassiveRecord(
        rows,
        categoryMeta,
        chain,
        volumeSummary,
        eventUpdates,
        eventChildren
      );

  return { ...record, marketFamilyKey: firstRow.market_family_key ?? null };
}

export async function readDbBackedMarketDetailPassiveRecord(
  pool: Pool,
  marketKey: string
): Promise<MarketDetailPassiveRecord | null> {
  const marketId = await readMarketDetailTargetMarketId(pool, marketKey);
  const fixtureRecord = MARKET_DETAIL_RECORDS[MARKET_KEY_TO_FIXTURE_KEY[marketKey]];

  const result = await pool.query<MarketDetailRow>(
    `
      select
        m.id as market_id,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        m.title,
        m.description,
        m.category_key,
        m.market_family_key,
        m.event_id,
        e.slug as event_slug,
        m.open_at,
        m.close_at,
        m.published_at,
        m.liquidity_b,
        m.settlement_status,
        m.resolved_at as market_resolved_at,
        ps.version as market_state_version,
        greatest(
          coalesce(ps.updated_at, m.updated_at, m.created_at),
          coalesce(
            (
              select max(le.created_at)
              from lifecycle_events le
              where le.market_id = m.id
            ),
            coalesce(ps.updated_at, m.updated_at, m.created_at)
          )
        ) as updated_at,
        o.id as outcome_id,
        o.short_label,
        o.label,
        o.sort_order,
        os.last_price,
        m.resolution_source,
        m.resolution_rules,
        m.oracle_source_policy,
        m.market_contract,
        wo.id as winning_outcome_id,
        wo.label as winning_outcome_label,
        mr.source_url as resolution_source_url,
        mr.notes as resolution_note,
        mr.resolved_at as resolution_resolved_at
      from markets m
      join market_pricing_state ps
        on ps.market_id = m.id
      join market_outcomes o
        on o.market_id = m.id
      join market_outcome_state os
        on os.market_id = m.id
       and os.outcome_id = o.id
      left join market_resolutions mr
        on mr.market_id = m.id
      left join events e
        on e.id = m.event_id
      left join market_outcomes wo
        on wo.market_id = m.id
       and wo.id = mr.winning_outcome_id
      where m.id = $1
      order by o.sort_order
    `,
    [marketId]
  );

  if (!result.rowCount || !result.rows[0]) {
    return null;
  }

  const [firstRow] = result.rows;
  const eventChildrenFingerprint = await readMarketDetailEventChildrenCacheFingerprint(
    pool,
    firstRow.event_id
  );
  const cacheKey = `${marketId}:${firstRow.market_state_version}:${firstRow.updated_at.toISOString()}:${eventChildrenFingerprint ?? "single-event"}`;
  const now = Date.now();
  const cachedRecord = MARKET_DETAIL_RECORD_CACHE.get(cacheKey, now);

  if (cachedRecord) {
    return cachedRecord;
  }

  const inFlight = MARKET_DETAIL_IN_FLIGHT.get(cacheKey);

  if (inFlight) {
    return inFlight;
  }

  const recordPromise = buildDbBackedMarketDetailPassiveRecord(
    pool,
    marketId,
    fixtureRecord,
    result.rows
  );

  MARKET_DETAIL_IN_FLIGHT.set(cacheKey, recordPromise);

  try {
    const record = await recordPromise;

    MARKET_DETAIL_RECORD_CACHE.set(cacheKey, record);

    return record;
  } finally {
    MARKET_DETAIL_IN_FLIGHT.delete(cacheKey);
  }
}
