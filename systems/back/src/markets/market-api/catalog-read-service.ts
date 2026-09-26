import type { Queryable } from "../../db/client/pool";
import { resolveBackendCategoryKey, resolveFrontendCategoryKey } from "../../shared/market-category";
import {
  clampLimit,
  DEFAULT_MARKET_LIMIT,
  MAX_MARKET_LIMIT,
  normalizeCatalogSort,
  normalizeIsoDate,
  normalizeStatus
} from "./normalizers";
import {
  buildMarketSummary,
  groupRowsByMarket
} from "./presenters";
import type { MarketApiRow } from "./types";

const MAX_CATALOG_QUERY_LENGTH = 120;

function normalizeCatalogQuery(value: string | null | undefined): string | null {
  const query = value?.trim().slice(0, MAX_CATALOG_QUERY_LENGTH) ?? "";
  return query || null;
}

export async function readMarketCatalog(
  db: Queryable,
  options?: {
    status?: string | null;
    category?: string | null;
    limit?: string | null;
    cursor?: string | null;
    q?: string | null;
    closeAfter?: string | null;
    closeBefore?: string | null;
    sort?: string | null;
  }
) {
  const status = normalizeStatus(options?.status ?? null);
  const category = resolveBackendCategoryKey(options?.category ?? null);
  const frontendCategory = resolveFrontendCategoryKey(options?.category ?? null);
  const limit = clampLimit(options?.limit ?? null, DEFAULT_MARKET_LIMIT, MAX_MARKET_LIMIT);
  const cursor = options?.cursor?.trim() || null;
  const query = normalizeCatalogQuery(options?.q);
  const closeAfter = normalizeIsoDate(options?.closeAfter ?? null);
  const closeBefore = normalizeIsoDate(options?.closeBefore ?? null);
  const sort = normalizeCatalogSort(options?.sort ?? null);
  const values: unknown[] = [status, category, limit, cursor];
  const filters: string[] = [
    "m.published_at is not null",
    `(
      $1::text is null
      or (
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end
      ) = $1
    )`,
    "($2::text is null or m.category_key = $2)",
    "($4::text is null or m.id > $4)"
  ];

  if (query) {
    values.push(`%${query}%`);
    filters.push(`(m.title ilike $${values.length} or coalesce(m.description, '') ilike $${values.length})`);
  }

  if (closeAfter) {
    values.push(closeAfter);
    filters.push(`m.close_at >= $${values.length}::timestamptz`);
  }

  if (closeBefore) {
    values.push(closeBefore);
    filters.push(`m.close_at <= $${values.length}::timestamptz`);
  }

  const rankedOrderBy =
    sort === "id_asc"
      ? "m.id asc"
      : sort === "close_asc"
      ? "m.close_at asc, m.id asc"
      : sort === "volume_desc"
        ? "coalesce(ps.total_volume, 0) desc, coalesce(m.updated_at, m.created_at) desc, m.id asc"
        : "coalesce(m.updated_at, m.created_at) desc, m.id asc";
  const finalOrderBy =
    sort === "id_asc"
      ? "m.id asc, o.sort_order"
      : sort === "close_asc"
      ? "m.close_at asc, m.id asc, o.sort_order"
      : sort === "volume_desc"
        ? "coalesce(ps.total_volume, 0) desc, coalesce(ps.updated_at, m.updated_at, m.created_at) desc, m.id asc, o.sort_order"
        : "coalesce(ps.updated_at, m.updated_at, m.created_at) desc, m.id asc, o.sort_order";
  const result = await db.query<MarketApiRow>(
    `
      with ranked_markets as (
        select m.id
        from markets m
        left join market_pricing_state ps
          on ps.market_id = m.id
        where ${filters.join("\n          and ")}
        order by ${rankedOrderBy}
        limit $3
      )
      select
        m.id as market_id,
        m.event_id,
        e.slug as event_slug,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        m.title,
        m.description,
        m.category_key,
        m.open_at,
        m.close_at,
        m.published_at,
        m.settlement_status,
        m.resolved_at as market_resolved_at,
        m.resolution_source,
        m.resolution_rules,
        m.market_contract,
        wo.id as winning_outcome_id,
        wo.label as winning_outcome_label,
        mr.source_url as resolution_source_url,
        mr.notes as resolution_note,
        mr.resolved_at as resolution_resolved_at,
        coalesce(ps.updated_at, m.updated_at, m.created_at) as updated_at,
        coalesce(ps.version, 0)::text as market_state_version,
        count(o.id) over (partition by m.id)::int as outcome_count,
        coalesce(ps.total_volume, 0)::text as total_volume,
        o.id as outcome_id,
        o.label as outcome_label,
        o.short_label as outcome_short_label,
        o.sort_order,
        os.last_price::text as last_price
      from ranked_markets rm
      join markets m
        on m.id = rm.id
      join market_outcomes o
        on o.market_id = m.id
      join market_outcome_state os
        on os.market_id = m.id
       and os.outcome_id = o.id
      left join market_pricing_state ps
        on ps.market_id = m.id
      left join market_resolutions mr
        on mr.market_id = m.id
      left join events e
        on e.id = m.event_id
      left join market_outcomes wo
        on wo.market_id = m.id
       and wo.id = mr.winning_outcome_id
      order by ${finalOrderBy}
    `,
    values
  );
  const markets = groupRowsByMarket(result.rows)
    .map((rows) => buildMarketSummary(rows))
    .filter((market): market is NonNullable<typeof market> => Boolean(market));

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      status,
      category: frontendCategory,
      q: query,
      closeAfter,
      closeBefore,
      sort
    },
    markets,
    pagination: {
      limit,
      nextCursor: markets.length === limit ? markets.at(-1)?.marketId ?? null : null
    }
  };
}

/**
 * Hydrate public market summaries for an explicit set of ids (order not guaranteed;
 * callers re-order). Same select + presenter as readMarketCatalog, so consumers
 * (e.g. the related-markets read model) get card-identical summaries. Only published
 * markets are returned; unknown/unpublished ids are silently dropped.
 */
export async function readMarketSummariesByIds(
  db: Queryable,
  ids: string[]
): Promise<Map<string, NonNullable<ReturnType<typeof buildMarketSummary>>>> {
  const out = new Map<string, NonNullable<ReturnType<typeof buildMarketSummary>>>();
  if (!ids.length) {
    return out;
  }
  const result = await db.query<MarketApiRow>(
    `
      with ranked_markets as (
        select id from markets where id = any($1::text[]) and published_at is not null
      )
      select
        m.id as market_id,
        m.event_id,
        e.slug as event_slug,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        m.title,
        m.description,
        m.category_key,
        m.open_at,
        m.close_at,
        m.published_at,
        m.settlement_status,
        m.resolved_at as market_resolved_at,
        m.resolution_source,
        m.resolution_rules,
        m.market_contract,
        wo.id as winning_outcome_id,
        wo.label as winning_outcome_label,
        mr.source_url as resolution_source_url,
        mr.notes as resolution_note,
        mr.resolved_at as resolution_resolved_at,
        coalesce(ps.updated_at, m.updated_at, m.created_at) as updated_at,
        coalesce(ps.version, 0)::text as market_state_version,
        count(o.id) over (partition by m.id)::int as outcome_count,
        coalesce(ps.total_volume, 0)::text as total_volume,
        o.id as outcome_id,
        o.label as outcome_label,
        o.short_label as outcome_short_label,
        o.sort_order,
        os.last_price::text as last_price
      from ranked_markets rm
      join markets m on m.id = rm.id
      join market_outcomes o on o.market_id = m.id
      join market_outcome_state os on os.market_id = m.id and os.outcome_id = o.id
      left join market_pricing_state ps on ps.market_id = m.id
      left join market_resolutions mr on mr.market_id = m.id
      left join events e on e.id = m.event_id
      left join market_outcomes wo on wo.market_id = m.id and wo.id = mr.winning_outcome_id
      order by m.id asc, o.sort_order
    `,
    [ids]
  );
  for (const rows of groupRowsByMarket(result.rows)) {
    const summary = buildMarketSummary(rows);
    if (summary) {
      out.set(summary.marketId, summary);
    }
  }
  return out;
}
