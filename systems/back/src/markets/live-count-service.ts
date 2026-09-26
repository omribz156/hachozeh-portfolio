import type { Queryable } from "../db/client/pool";

export type LiveMarketCountResponse = {
  count: number;
  generatedAt: string;
};

function readCount(value: unknown): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export async function readLiveMarketCount(
  db: Queryable
): Promise<LiveMarketCountResponse> {
  const result = await db.query<{ count: string | number }>(
    `
      with live_windows as (
        select
          m.id,
          nullif(m.market_contract #>> '{timeline,liveStartAt}', '') as live_start_at,
          nullif(m.market_contract #>> '{timeline,liveEndAt}', '') as live_end_at,
          nullif(m.market_contract #>> '{timeline,expectedResolutionAt}', '') as expected_resolution_at,
          lower(coalesce(
            nullif(m.market_contract #>> '{live,status}', ''),
            nullif(m.market_contract->>'liveStatus', '')
          )) as live_status
        from markets m
        where m.published_at is not null
          and m.status in ('open', 'closed')
      ),
      parsed_windows as (
        select
          id,
          live_status,
          case
            when live_start_at ~ '^\\d{4}-\\d{2}-\\d{2}T' then live_start_at::timestamptz
            else null
          end as live_start_at,
          case
            when live_end_at ~ '^\\d{4}-\\d{2}-\\d{2}T' then live_end_at::timestamptz
            when expected_resolution_at ~ '^\\d{4}-\\d{2}-\\d{2}T' then expected_resolution_at::timestamptz
            else null
          end as live_end_at
        from live_windows
      )
      select count(*)::int as count
      from parsed_windows
      where live_status = 'live'
         or (
           live_start_at is not null
           and live_start_at <= now()
           and coalesce(live_end_at, live_start_at + interval '4 hours') > now()
         )
    `
  );

  return {
    count: readCount(result.rows[0]?.count),
    generatedAt: new Date().toISOString()
  };
}
