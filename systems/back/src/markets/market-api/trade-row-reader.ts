import type { Queryable } from "../../db/client/pool";
import { resolveOutcomeId } from "../../shared/market-identity";
import { resolveMarketId } from "./identity";
import {
  clampLimit,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_TRADE_LIMIT,
  MAX_HISTORY_LIMIT,
  MAX_TRADE_LIMIT,
  normalizeContractSide,
  normalizeSide
} from "./normalizers";
import type { MarketTradeRow } from "./types";

export type ReadTradeRowsOptions = {
  limit?: string | null;
  cursor?: string | null;
  side?: string | null;
  contractSide?: string | null;
  outcome?: string | null;
};

export async function readTradeRows(
  db: Queryable,
  marketKey: string,
  options?: ReadTradeRowsOptions
): Promise<MarketTradeRow[]> {
  const marketId = resolveMarketId(marketKey);
  const limit = clampLimit(options?.limit ?? null, DEFAULT_TRADE_LIMIT, MAX_TRADE_LIMIT);
  const cursor = options?.cursor?.trim() || null;
  const side = normalizeSide(options?.side ?? null);
  const contractSide = normalizeContractSide(options?.contractSide ?? null);
  const outcomeKey = options?.outcome?.trim() || null;
  const outcomeId = outcomeKey ? resolveOutcomeId(marketKey, outcomeKey) : null;
  const values: unknown[] = [marketId, limit, cursor];
  const filters: string[] = [
    "t.market_id = $1",
    "($3::text is null or t.id < $3)"
  ];

  if (side) {
    values.push(side);
    filters.push(`t.side = $${values.length}`);
  }

  if (contractSide) {
    values.push(contractSide);
    filters.push(`t.contract_side = $${values.length}`);
  }

  if (outcomeId) {
    values.push(outcomeId);
    filters.push(`t.outcome_id = $${values.length}`);
  }

  const result = await db.query<MarketTradeRow>(
    `
      with page as (
        select
          t.id as trade_id,
          t.user_id,
          u.handle as user_handle,
          u.display_name as user_display_name,
          u.avatar_url as user_avatar_url,
          t.created_at,
          t.side,
          t.contract_side,
          t.requested_outcome_key,
          t.cash_amount::text as cash_amount,
          t.share_amount::text as share_amount,
          t.avg_price::text as avg_price,
          t.price_before::text as price_before,
          t.price_after::text as price_after,
          o.id as outcome_id,
          o.label as outcome_label
        from trades t
        join market_outcomes o
          on o.market_id = t.market_id
         and o.id = t.outcome_id
        left join users u
          on u.id = t.user_id
         and u.status = 'active'
        where ${filters.join("\n          and ")}
        order by t.created_at desc, t.id desc
        limit $2
      )
      select
        page.trade_id,
        page.user_id,
        page.user_handle,
        page.user_display_name,
        page.user_avatar_url,
        page.created_at,
        page.side,
        page.contract_side,
        page.requested_outcome_key,
        page.cash_amount,
        page.share_amount,
        page.avg_price,
        page.price_before,
        page.price_after,
        page.outcome_id,
        page.outcome_label,
        coalesce(execution_legs.execution_legs, '[]'::json) as execution_legs
      from page
      left join lateral (
        select
          json_agg(
            json_build_object(
              'outcome_id', outcome_id,
              'share_amount', share_amount::text
            )
            order by sort_order
          ) as execution_legs
        from trade_execution_legs
        where trade_id = page.trade_id
      ) execution_legs
        on true
      order by page.created_at desc, page.trade_id desc
    `,
    values
  );

  return result.rows;
}

export async function readHistoryTradeRows(
  db: Queryable,
  marketKey: string,
  options?: {
    limit?: string | null;
  }
): Promise<MarketTradeRow[]> {
  const marketId = resolveMarketId(marketKey);
  const limit = clampLimit(options?.limit ?? null, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
  const result = await db.query<MarketTradeRow>(
    `
      select
        page.trade_id,
        page.user_id,
        page.user_handle,
        page.user_display_name,
        page.user_avatar_url,
        page.created_at,
        page.side,
        page.contract_side,
        page.requested_outcome_key,
        page.cash_amount,
        page.share_amount,
        page.avg_price,
        page.price_before,
        page.price_after,
        page.outcome_id,
        page.outcome_label,
        coalesce(execution_legs.execution_legs, '[]'::json) as execution_legs
      from (
        select
          t.id as trade_id,
          t.user_id,
          u.handle as user_handle,
          u.display_name as user_display_name,
          u.avatar_url as user_avatar_url,
          t.created_at,
          t.side,
          t.contract_side,
          t.requested_outcome_key,
          t.cash_amount::text as cash_amount,
          t.share_amount::text as share_amount,
          t.avg_price::text as avg_price,
          t.price_before::text as price_before,
          t.price_after::text as price_after,
          o.id as outcome_id,
          o.label as outcome_label
        from trades t
        join market_outcomes o
          on o.market_id = t.market_id
         and o.id = t.outcome_id
        left join users u
          on u.id = t.user_id
         and u.status = 'active'
        where t.market_id = $1
        order by t.created_at desc, t.id desc
        limit $2
      ) page
      left join lateral (
        select
          json_agg(
            json_build_object(
              'outcome_id', outcome_id,
              'share_amount', share_amount::text
            )
            order by sort_order
          ) as execution_legs
        from trade_execution_legs
        where trade_id = page.trade_id
      ) execution_legs
        on true
      order by page.created_at desc, page.trade_id desc
    `,
    [marketId, limit]
  );

  return result.rows;
}

export async function readAllHistoryTradeRows(
  db: Queryable,
  marketKey: string,
  options?: {
    // Unbounded by default (backfill-base-candles.ts needs the whole
    // history to seed market_base_candles once). Callers on the read path
    // (market-history-service.ts) pass a cap, since this query has no
    // `order by ... limit` pushdown otherwise and would replay an
    // arbitrarily large trade history in JS on every request for any
    // not-yet-backfilled market.
    limit?: number | null;
  }
): Promise<MarketTradeRow[]> {
  const marketId = resolveMarketId(marketKey);
  const limit = options?.limit ?? null;
  const result = await db.query<MarketTradeRow>(
    `
      select
        page.trade_id,
        page.user_id,
        null::text as identifier_display,
        page.user_handle,
        page.user_display_name,
        page.user_avatar_url,
        page.created_at,
        page.side,
        page.contract_side,
        page.requested_outcome_key,
        page.cash_amount,
        page.share_amount,
        page.avg_price,
        page.price_before,
        page.price_after,
        page.outcome_id,
        page.outcome_label,
        coalesce(execution_legs.execution_legs, '[]'::json) as execution_legs
      from (
        select
          t.id as trade_id,
          t.user_id,
          u.handle as user_handle,
          u.display_name as user_display_name,
          u.avatar_url as user_avatar_url,
          t.created_at,
          t.side,
          t.contract_side,
          t.requested_outcome_key,
          t.cash_amount::text as cash_amount,
          t.share_amount::text as share_amount,
          t.avg_price::text as avg_price,
          t.price_before::text as price_before,
          t.price_after::text as price_after,
          o.id as outcome_id,
          o.label as outcome_label
        from trades t
        join market_outcomes o
          on o.market_id = t.market_id
         and o.id = t.outcome_id
        left join users u
          on u.id = t.user_id
         and u.status = 'active'
        where t.market_id = $1
        order by t.created_at desc, t.id desc
        ${limit ? "limit $2" : ""}
      ) page
      left join lateral (
        select
          json_agg(
            json_build_object(
              'outcome_id', outcome_id,
              'share_amount', share_amount::text
            )
            order by sort_order
          ) as execution_legs
        from trade_execution_legs
        where trade_id = page.trade_id
      ) execution_legs
        on true
      order by page.created_at desc, page.trade_id desc
    `,
    limit ? [marketId, limit] : [marketId]
  );

  return result.rows;
}
