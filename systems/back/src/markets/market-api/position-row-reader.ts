import type { Queryable } from "../../db/client/pool";
import {
  isMaterialShareAmount,
  MATERIAL_SHARES_THRESHOLD
} from "../../shared/decimals";
import { resolveMarketId } from "./identity";
import {
  clampLimit,
  DEFAULT_POSITION_LIMIT,
  MAX_POSITION_LIMIT
} from "./normalizers";
import type { MarketPositionRow } from "./types";

export async function readPositionRows(
  db: Queryable,
  marketKey: string,
  options?: {
    limit?: string | null;
    // Include positions that were stamped settled_at by resolution. Settlement
    // preserves `shares`, so these rows ARE the final-holdings snapshot — what
    // resolved markets show (the boards would otherwise be empty post-resolution,
    // since every position is settled). Live markets pass this false so the board
    // reflects only current active holdings.
    includeSettled?: boolean;
  }
): Promise<MarketPositionRow[]> {
  const marketId = resolveMarketId(marketKey);
  const limit = clampLimit(options?.limit ?? null, DEFAULT_POSITION_LIMIT, MAX_POSITION_LIMIT);
  // Internal literal (not user input) — safe to interpolate.
  const settledFilter = options?.includeSettled ? "" : "and cp.settled_at is null";
  const result = await db.query<MarketPositionRow>(
    `
      with ranked_positions as (
        select
          cp.user_id,
          u.handle as user_handle,
          u.display_name as user_display_name,
          u.avatar_url as user_avatar_url,
          o.id as outcome_id,
          o.label as outcome_label,
          o.short_label as outcome_short_label,
          complement.outcome_id as complement_outcome_id,
          complement.outcome_label as complement_outcome_label,
          complement.outcome_short_label as complement_outcome_short_label,
          counts.outcome_count,
          cp.contract_side,
          o.sort_order,
          cp.shares::text as shares,
          cp.cost_basis::text as cost_basis,
          cp.realized_pnl::text as realized_pnl,
          case
            when cp.contract_side = 'no' then (1 - os.last_price)::text
            else os.last_price::text
          end as current_price,
          cp.updated_at,
          row_number() over (
            partition by cp.requested_outcome_id, cp.contract_side
            order by cp.shares desc, cp.updated_at desc, cp.user_id asc
          ) as bucket_rank
        from contract_positions cp
        join market_outcomes o
          on o.market_id = cp.market_id
         and o.id = cp.requested_outcome_id
        join market_outcome_state os
          on os.market_id = cp.market_id
         and os.outcome_id = cp.requested_outcome_id
        left join users u
          on u.id = cp.user_id
         and u.status = 'active'
        join lateral (
          select count(*)::int as outcome_count
          from market_outcomes mo
          where mo.market_id = cp.market_id
        ) counts on true
        left join lateral (
          select
            mo.id as outcome_id,
            mo.label as outcome_label,
            mo.short_label as outcome_short_label
          from market_outcomes mo
          where mo.market_id = cp.market_id
            and mo.id <> cp.requested_outcome_id
          order by mo.sort_order
          limit 1
        ) complement on counts.outcome_count = 2
        where cp.market_id = $1
          and cp.shares >= $2
          ${settledFilter}
      )
      select
        user_id,
        user_handle,
        user_display_name,
        user_avatar_url,
        outcome_id,
        outcome_label,
        outcome_short_label,
        complement_outcome_id,
        complement_outcome_label,
        complement_outcome_short_label,
        outcome_count,
        contract_side,
        sort_order,
        shares,
        cost_basis,
        realized_pnl,
        current_price,
        updated_at
      from ranked_positions
      where bucket_rank <= $3
      order by sort_order asc, contract_side asc, bucket_rank asc
    `,
    [marketId, MATERIAL_SHARES_THRESHOLD, limit]
  );

  return result.rows.filter((row) => isMaterialShareAmount(row.shares));
}
