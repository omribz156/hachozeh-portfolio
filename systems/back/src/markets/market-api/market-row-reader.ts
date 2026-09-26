import type { Queryable } from "../../db/client/pool";
import { resolveMarketId } from "./identity";
import type { MarketApiRow } from "./types";

export async function readMarketRows(
  db: Queryable,
  marketKey: string
): Promise<MarketApiRow[]> {
  const marketId = resolveMarketId(marketKey);
  const result = await db.query<MarketApiRow>(
    `
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
        m.liquidity_b::text as liquidity_b,
        count(o.id) over (partition by m.id)::int as outcome_count,
        coalesce(ps.total_volume, 0)::text as total_volume,
        o.id as outcome_id,
        o.label as outcome_label,
        o.short_label as outcome_short_label,
        os.q_shares::text as q_shares,
        o.sort_order,
        os.last_price::text as last_price
      from markets m
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
      where m.id = $1
      order by o.sort_order
    `,
    [marketId]
  );

  return result.rows;
}
