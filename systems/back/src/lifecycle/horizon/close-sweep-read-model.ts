import type { Queryable } from "../../db/client/pool";
import type {
  HorizonLifecycleAlertItem,
  HorizonMarketLifecycle
} from "./contracts";
import { buildLifecycleConflictAlert } from "./close-sweep-alerts";
import { toHorizonLifecycleMarket, type HorizonMarketLifecycleRow } from "./market-lifecycle-row";

const MARKET_LIFECYCLE_COLUMNS = `
  id,
  status,
  open_at,
  close_at,
  close_on_event_completion,
  event_completion_close_requires_human_approval,
  closed_at,
  resolved_at
`;

export async function readMarketLifecycleById(
  db: Queryable,
  marketId: string
): Promise<HorizonMarketLifecycle | null> {
  const result = await db.query<HorizonMarketLifecycleRow>(
    `
      select
        ${MARKET_LIFECYCLE_COLUMNS}
      from markets
      where id = $1
      limit 1
    `,
    [marketId]
  );

  const row = result.rows[0];
  return row ? toHorizonLifecycleMarket(row) : null;
}

export async function readDueOpenMarkets(
  db: Queryable,
  evaluatedAt: string,
  limit: number,
  marketId?: string
): Promise<HorizonMarketLifecycle[]> {
  const values: unknown[] = [evaluatedAt];
  const marketFilter = marketId ? "and id = $2" : "";

  if (marketId) {
    values.push(marketId);
  }

  values.push(limit);

  const result = await db.query<HorizonMarketLifecycleRow>(
    `
      select
        ${MARKET_LIFECYCLE_COLUMNS}
      from markets
      where status = 'open'
        and close_at <= $1::timestamptz
        ${marketFilter}
      order by close_at asc, id asc
      limit $${values.length}
    `,
    values
  );

  return result.rows.map(toHorizonLifecycleMarket);
}

export async function readLifecycleConflicts(
  db: Queryable,
  evaluatedAt: string,
  marketId?: string
): Promise<HorizonLifecycleAlertItem[]> {
  const values: unknown[] = [evaluatedAt];
  const marketFilter = marketId ? "and id = $2" : "";

  if (marketId) {
    values.push(marketId);
  }

  const result = await db.query<HorizonMarketLifecycleRow>(
    `
      select
        ${MARKET_LIFECYCLE_COLUMNS}
      from markets
      where close_at <= $1::timestamptz
        ${marketFilter}
        and (
          status = 'draft'
          or (status = 'closed' and closed_at is null)
          or (status = 'resolved' and resolved_at is null)
        )
      order by close_at asc, id asc
    `,
    values
  );

  return result.rows.map((row) => buildLifecycleConflictAlert(row, evaluatedAt));
}
