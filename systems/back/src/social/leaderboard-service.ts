import type { Queryable } from "../db/client/pool";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import {
  EFFECTIVE_REALIZED_PNL_SQL,
  INCIDENT_COMPENSATION_LATERAL_JOIN
} from "../shared/incident-compensation";
import { resolvePublicDisplayName } from "../shared/public-user-identity";

type LeaderboardRow = {
  user_id: string;
  handle: string;
  display_name: string | null;
  realized_pnl: string;
  open_mark_pnl: string;
  realized_market_count: number;
  resolved_count: number;
  active_market_count: number;
  market_count: number;
};

type WeeklyLeaderboardEntry = {
  rank: number;
  displayName: string;
  profileHref: string;
  weeklyPnl: string;
  resolvedCount: number;
  activeMarketCount: number;
};

export type WeeklyLeaderboardResponse = {
  asOf: string;
  windowDays: number;
  minimumMarkets: number;
  entries: WeeklyLeaderboardEntry[];
};

export async function readWeeklyLeaderboard(
  db: Queryable,
  options: {
    limit?: number;
    windowDays?: number;
    minimumMarkets?: number;
  } = {}
): Promise<WeeklyLeaderboardResponse> {
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100);
  const windowDays = Math.min(Math.max(Math.floor(options.windowDays ?? 7), 1), 30);
  const minimumMarkets = Math.min(Math.max(Math.floor(options.minimumMarkets ?? 3), 1), 100);
  const result = await db.query<LeaderboardRow>(
    `
      with recent_realized as (
        select
          re.user_id,
          sum(${EFFECTIVE_REALIZED_PNL_SQL})::text as realized_pnl,
          count(distinct re.market_id)::int as realized_market_count,
          count(distinct re.market_id) filter (
            where re.type in ('resolution_win', 'resolution_loss')
          )::int as resolved_count
        from realization_events re
        join users u
          on u.id = re.user_id
         and u.status = 'active'
         and u.privacy_erased_at is null
        left join market_resolutions mr
          on mr.id = re.resolution_id
        ${INCIDENT_COMPENSATION_LATERAL_JOIN}
        where re.created_at >= now() - ($1::text || ' days')::interval
          and re.type in ('resolution_win', 'resolution_loss', 'sell')
        group by re.user_id
      ),
      open_marks as (
        select
          cp.user_id,
          sum(
            (
              cp.shares *
              case
                when cp.contract_side = 'no' then (1 - os.last_price)
                else os.last_price
              end
            ) - cp.cost_basis
          )::text as open_mark_pnl,
          count(distinct cp.market_id)::int as active_market_count
        from contract_positions cp
        join users u
          on u.id = cp.user_id
         and u.status = 'active'
         and u.privacy_erased_at is null
        join markets m
          on m.id = cp.market_id
         and m.status = 'open'
        join market_outcome_state os
          on os.market_id = cp.market_id
         and os.outcome_id = cp.requested_outcome_id
        where cp.shares > 0
          and cp.settled_at is null
        group by cp.user_id
      ),
      combined as (
        select
          coalesce(r.user_id, o.user_id) as user_id,
          coalesce(r.realized_pnl, '0') as realized_pnl,
          coalesce(o.open_mark_pnl, '0') as open_mark_pnl,
          coalesce(r.realized_market_count, 0)::int as realized_market_count,
          coalesce(r.resolved_count, 0)::int as resolved_count,
          coalesce(o.active_market_count, 0)::int as active_market_count,
          (coalesce(r.realized_market_count, 0) + coalesce(o.active_market_count, 0))::int as market_count
        from recent_realized r
        full outer join open_marks o
          on o.user_id = r.user_id
      )
      select
        combined.user_id,
        u.handle,
        u.display_name,
        realized_pnl,
        open_mark_pnl,
        realized_market_count,
        resolved_count,
        active_market_count,
        market_count
      from combined
      join users u
        on u.id = combined.user_id
       and u.status = 'active'
       and u.privacy_erased_at is null
      where market_count >= $2
        and (realized_pnl::numeric + open_mark_pnl::numeric) > 0
      order by (realized_pnl::numeric + open_mark_pnl::numeric) desc, combined.user_id asc
      limit $3
    `,
    [windowDays, minimumMarkets, limit]
  );

  return {
    asOf: new Date().toISOString(),
    windowDays,
    minimumMarkets,
    entries: result.rows.map((row, index) => ({
      rank: index + 1,
      displayName: resolvePublicDisplayName(row.user_id, row.display_name, row.handle),
      profileHref: `/@${encodeURIComponent(row.handle.replace(/^@/, ""))}`,
      weeklyPnl: quantizeMoney(toDecimal(row.realized_pnl).plus(row.open_mark_pnl)),
      resolvedCount: row.resolved_count,
      activeMarketCount: row.active_market_count
    }))
  };
}
