import type { Queryable } from "../../db/client/pool";
import {
  isMaterialShareAmount,
  MATERIAL_SHARES_THRESHOLD
} from "../../shared/decimals";
import type {
  DiscoveryFeedRow,
  DiscoveryMovementRow,
  DiscoveryViewerPositionRow
} from "./types";

const DISCOVERY_FEED_ROW_LIMIT = 800;

export async function readDiscoveryFeedRows(
  db: Queryable,
  categoryKeys: string[] | null
): Promise<DiscoveryFeedRow[]> {
  const result = await db.query<DiscoveryFeedRow>(
    `
      with recent_activity as (
        select
          market_id,
          count(*)::int as recent_trade_count,
          coalesce(sum(cash_amount), 0)::numeric(20, 6) as recent_trade_volume
        from trades
        where created_at >= now() - interval '6 hours'
        group by market_id
      )
      select
        m.id as market_id,
        m.event_id,
        e.slug as event_slug,
        e.icon as event_icon,
        e.display_flags as event_display_flags,
        m.event_child_label,
        e.title as event_title,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.status as persisted_status,
        m.title,
        m.description,
        m.category_key,
        m.published_at,
        m.open_at,
        m.close_at,
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
        coalesce(ra.recent_trade_count, 0)::int as recent_trade_count,
        coalesce(ra.recent_trade_volume, 0)::text as recent_trade_volume,
        count(o.id) over (partition by m.id)::int as outcome_count,
        coalesce(ps.total_volume, 0)::text as total_volume,
        o.id as outcome_id,
        o.label as outcome_label,
        o.short_label as outcome_short_label,
        o.image_url as outcome_image_url,
        o.sort_order,
        os.last_price
      from markets m
      join market_outcomes o
        on o.market_id = m.id
      join market_outcome_state os
        on os.market_id = m.id
       and os.outcome_id = o.id
      left join market_pricing_state ps
        on ps.market_id = m.id
      left join recent_activity ra
        on ra.market_id = m.id
      left join events e
        on e.id = m.event_id
      left join market_resolutions mr
        on mr.market_id = m.id
      left join market_outcomes wo
        on wo.market_id = m.id
       and wo.id = mr.winning_outcome_id
      where m.published_at is not null
        and m.status = 'open'
        and m.close_at > now()
        and m.id not like 'market_seed_%'
        and ($1::text[] is null or m.category_key = any($1::text[]))
      order by m.id, o.sort_order
      limit $2
    `,
    [categoryKeys, DISCOVERY_FEED_ROW_LIMIT]
  );

  return result.rows;
}

export async function readDiscoveryMovementRows(
  db: Queryable,
  marketIds: string[]
): Promise<DiscoveryMovementRow[]> {
  if (marketIds.length === 0) {
    return [];
  }

  const result = await db.query<DiscoveryMovementRow>(
    `
      with target_outcomes as (
        select
          o.market_id,
          o.id as outcome_id,
          os.last_price
        from market_outcomes o
        join market_outcome_state os
          on os.market_id = o.market_id
         and os.outcome_id = o.id
        where o.market_id = any($1::text[])
      ),
      activity as (
        select
          market_id,
          outcome_id,
          count(*)::int as trade_count,
          coalesce(sum(cash_amount), 0)::numeric(20, 6) as trade_volume
        from trades
        where market_id = any($1::text[])
          and created_at >= now() - interval '24 hours'
        group by market_id, outcome_id
      )
      select
        target_outcomes.market_id,
        target_outcomes.outcome_id,
        '24h'::text as window_key,
        coalesce(prior.price_after, first_window.price_before, target_outcomes.last_price)::text as from_price,
        target_outcomes.last_price::text as to_price,
        (target_outcomes.last_price - coalesce(prior.price_after, first_window.price_before, target_outcomes.last_price))::text as delta,
        abs(target_outcomes.last_price - coalesce(prior.price_after, first_window.price_before, target_outcomes.last_price))::text as abs_delta,
        coalesce(activity.trade_count, 0)::int as trade_count,
        coalesce(activity.trade_volume, 0)::text as trade_volume
      from target_outcomes
      left join lateral (
        select
          t.price_after,
          t.created_at
        from trades t
        where t.market_id = target_outcomes.market_id
          and t.outcome_id = target_outcomes.outcome_id
          and t.created_at < now() - interval '24 hours'
        order by t.created_at desc, t.id desc
        limit 1
      ) prior on true
      left join lateral (
        select
          t.price_before,
          t.created_at
        from trades t
        where t.market_id = target_outcomes.market_id
          and t.outcome_id = target_outcomes.outcome_id
          and t.created_at >= now() - interval '24 hours'
        order by t.created_at asc, t.id asc
        limit 1
      ) first_window on true
      left join activity
        on activity.market_id = target_outcomes.market_id
       and activity.outcome_id = target_outcomes.outcome_id
      where coalesce(activity.trade_count, 0) > 0
      order by target_outcomes.market_id, abs_delta desc, activity.trade_volume desc
    `,
    [marketIds]
  );

  return result.rows;
}

export async function readDiscoveryViewerPositionRows(
  db: Queryable,
  actorId: string,
  marketIds: string[]
): Promise<DiscoveryViewerPositionRow[]> {
  if (marketIds.length === 0) {
    return [];
  }

  const result = await db.query<DiscoveryViewerPositionRow>(
    `
      select
        market_id,
        outcome_id,
        contract_side,
        shares,
        cost_basis,
        current_price
      from (
        select
          cp.market_id,
          cp.requested_outcome_id as outcome_id,
          cp.contract_side,
          cp.shares::text as shares,
          cp.cost_basis::text as cost_basis,
          case
            when cp.contract_side = 'no' then (1 - os.last_price)::text
            else os.last_price::text
          end as current_price,
          row_number() over (
            partition by cp.market_id
            order by cp.shares desc, cp.updated_at desc, cp.requested_outcome_id asc, cp.contract_side asc
          ) as row_number
        from contract_positions cp
        join market_outcome_state os
          on os.market_id = cp.market_id
         and os.outcome_id = cp.requested_outcome_id
        where cp.user_id = $1
          and cp.market_id = any($2::text[])
          and cp.shares >= $3
          and cp.settled_at is null
      ) ranked_positions
      where row_number = 1
      order by market_id
    `,
    [actorId, marketIds, MATERIAL_SHARES_THRESHOLD]
  );

  return result.rows.filter((row) => isMaterialShareAmount(row.shares));
}
