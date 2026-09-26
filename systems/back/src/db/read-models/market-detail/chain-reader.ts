import type { Pool } from "pg";

import type { MarketDetailChainItem } from "../../../http/routes/market-detail-fixtures";
import { formatCloseLabel } from "./formatters";
import type { MarketFamilyRow } from "./types";

function readLabelDate(row: MarketFamilyRow): Date {
  return row.label_at ?? row.close_at;
}

function isPastLifecycleStatus(status: string | null | undefined): boolean {
  return status === "closed" || status === "resolved" || status === "voided";
}

export function buildChainItems(
  rows: MarketFamilyRow[],
  currentMarketId?: string
): MarketDetailChainItem[] {
  return rows.map((row) => ({
    id: row.market_id,
    label: formatCloseLabel(readLabelDate(row)),
    href: row.event_slug
      ? `/event/${encodeURIComponent(row.event_slug)}`
      : `/markets/${encodeURIComponent(row.market_id)}`,
    temporalStatus:
      row.market_id === currentMarketId
        ? "current"
        : isPastLifecycleStatus(row.status)
          ? "past"
          : "future"
  }));
}

export async function readFamilyChain(
  pool: Pool,
  marketFamilyKey: string | null,
  currentMarketId?: string
): Promise<MarketDetailChainItem[]> {
  if (!marketFamilyKey) {
    return [];
  }

  const result = await pool.query<MarketFamilyRow>(
    `
      with current_market as (
        select
          market_contract->>'measurementKind' as current_measurement_kind,
          market_contract->>'resultShape' as current_result_shape,
          coalesce(
            (
              select array_agg(value order by value)
              from jsonb_array_elements_text(market_contract #> '{resolutionSource,sourceIds}') as source_id(value)
            ),
            array[]::text[]
          ) as current_source_ids
        from markets
        where id = $2
      ),
      ranked_family_markets as (
        select
          m.id as market_id,
          e.slug as event_slug,
          m.status,
          m.close_at,
          coalesce(
            (
              substring(
                coalesce(m.market_contract->>'ambiguityPolicy', '')
                from 'measurement-date-local=([0-9]{4}-[0-9]{2}-[0-9]{2})'
              )::date::timestamp at time zone 'Asia/Jerusalem'
            ),
            m.close_at
          ) as label_at,
          m.published_at,
          case
            when m.id ~ '-v[0-9]+$'
              then regexp_replace(m.id, '^.*-v([0-9]+)$', '\\1')::int
            else 1
          end as branch_version,
          row_number() over (
            partition by to_char(m.close_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD')
            order by
              case
                when m.id = $2 then 0
                else 1
              end asc,
              case m.status
                when 'open' then 0
                when 'closed' then 1
                else 2
              end asc,
              case
                when m.id ~ '-v[0-9]+$'
                  then regexp_replace(m.id, '^.*-v([0-9]+)$', '\\1')::int
                else 1
              end desc,
              m.published_at desc,
              m.id desc
          ) as branch_rank
        from markets m
        cross join current_market cm
        left join events e
          on e.id = m.event_id
        left join market_resolutions mr
          on mr.market_id = m.id
        where m.market_family_key = $1
          and m.published_at is not null
          and m.status in ('open', 'closed', 'resolved')
          and (
            cm.current_measurement_kind is null
            or cm.current_measurement_kind = ''
            or (
              m.market_contract->>'measurementKind' = cm.current_measurement_kind
              and m.market_contract->>'resultShape' = cm.current_result_shape
              and coalesce(
                (
                  select array_agg(value order by value)
                  from jsonb_array_elements_text(m.market_contract #> '{resolutionSource,sourceIds}') as source_id(value)
                ),
                array[]::text[]
              ) = cm.current_source_ids
            )
          )
          and (
            m.id = $2
            or (
              coalesce(mr.source_url, '') not like 'local://operator-clean-platform/%'
              and m.id !~* '(^|-)test(-|$)'
              and m.id !~* 'contract-test'
              and m.id !~* 'gauntlet'
            )
          )
      )
      select market_id, event_slug, status, close_at, label_at
      from ranked_family_markets
      where branch_rank = 1
      order by close_at asc, published_at asc, market_id asc
    `,
    [marketFamilyKey, currentMarketId ?? null]
  );

  if ((result.rowCount ?? 0) < 2) {
    return [];
  }

  return buildChainItems(result.rows, currentMarketId);
}

/**
 * All published instances of a recurring series, for the family-hub page
 * (`/series/{familyKey}`). Unlike `readFamilyChain`, this is NOT scoped to a
 * "current market" context: there is no measurement-kind/result-shape/source-id
 * comparison (a family is already a coherent series) and no `< 2 rows → []`
 * short-circuit (the hub route / registry owns eligibility). Keeps the same-day
 * `-v{N}` branch de-dup and the test/gauntlet exclusion. The open market (if any)
 * is marked `temporalStatus: 'current'`; closed/resolved are `past`; the rest `future`.
 */
export async function readMarketsByFamilyKey(
  pool: Pool,
  marketFamilyKey: string | null
): Promise<MarketDetailChainItem[]> {
  if (!marketFamilyKey) {
    return [];
  }

  const result = await pool.query<MarketFamilyRow>(
    `
      with ranked_family_markets as (
        select
          m.id as market_id,
          e.slug as event_slug,
          m.status,
          m.close_at,
          coalesce(
            (
              substring(
                coalesce(m.market_contract->>'ambiguityPolicy', '')
                from 'measurement-date-local=([0-9]{4}-[0-9]{2}-[0-9]{2})'
              )::date::timestamp at time zone 'Asia/Jerusalem'
            ),
            m.close_at
          ) as label_at,
          m.published_at,
          row_number() over (
            partition by to_char(m.close_at at time zone 'Asia/Jerusalem', 'YYYY-MM-DD')
            order by
              case m.status
                when 'open' then 0
                when 'closed' then 1
                else 2
              end asc,
              case
                when m.id ~ '-v[0-9]+$'
                  then regexp_replace(m.id, '^.*-v([0-9]+)$', '\\1')::int
                else 1
              end desc,
              m.published_at desc,
              m.id desc
          ) as branch_rank
        from markets m
        left join events e
          on e.id = m.event_id
        left join market_resolutions mr
          on mr.market_id = m.id
        where m.market_family_key = $1
          and m.published_at is not null
          and m.status in ('open', 'closed', 'resolved')
          and coalesce(mr.source_url, '') not like 'local://operator-clean-platform/%'
          and m.id !~* '(^|-)test(-|$)'
          and m.id !~* 'contract-test'
          and m.id !~* 'gauntlet'
      )
      select market_id, event_slug, status, close_at, label_at
      from ranked_family_markets
      where branch_rank = 1
      order by close_at asc, published_at asc, market_id asc
    `,
    [marketFamilyKey]
  );

  const rows = result.rows;
  const currentMarketId = rows.find((row) => row.status === "open")?.market_id;

  return buildChainItems(rows, currentMarketId);
}
