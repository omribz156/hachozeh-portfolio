import type { Pool } from "pg";

import { resolveMarketId } from "./market-api/identity";

type MarketSaveRow = {
  market_id: string;
  title: string;
  saved: boolean;
  saved_at: Date | null;
};

export type MarketSaveResponse = {
  marketKey: string;
  marketId: string;
  title: string;
  saved: boolean;
  savedAt: string | null;
};

export class MarketSaveServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "MarketSaveServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function mapMarketSaveRow(row: MarketSaveRow, marketKey: string): MarketSaveResponse {
  return {
    marketKey,
    marketId: row.market_id,
    title: row.title,
    saved: row.saved,
    savedAt: row.saved_at?.toISOString() ?? null
  };
}

async function readMarketSaveRow(
  db: Pool,
  userId: string,
  marketKey: string
): Promise<MarketSaveRow> {
  const marketId = resolveMarketId(marketKey);
  const result = await db.query<MarketSaveRow>(
    `
      select
        m.id as market_id,
        m.title,
        (ums.user_id is not null) as saved,
        ums.created_at as saved_at
      from markets m
      left join user_market_saves ums
        on ums.market_id = m.id
       and ums.user_id = $2
      where m.id = $1
      limit 1
    `,
    [marketId, userId]
  );
  const row = result.rows[0];

  if (!row) {
    throw new MarketSaveServiceError(404, "market_not_found", "Market was not found.");
  }

  return row;
}

export async function readMarketSaveState(
  db: Pool,
  userId: string,
  marketKey: string
): Promise<MarketSaveResponse> {
  return mapMarketSaveRow(await readMarketSaveRow(db, userId, marketKey), marketKey);
}

export async function saveMarketForUser(
  db: Pool,
  userId: string,
  marketKey: string
): Promise<MarketSaveResponse> {
  const marketId = resolveMarketId(marketKey);
  const marketResult = await db.query<{ id: string }>(
    `select id from markets where id = $1 limit 1`,
    [marketId]
  );

  if (!marketResult.rows[0]) {
    throw new MarketSaveServiceError(404, "market_not_found", "Market was not found.");
  }

  await db.query(
    `
      insert into user_market_saves (user_id, market_id, created_at)
      values ($1, $2, now())
      on conflict (user_id, market_id) do nothing
    `,
    [userId, marketId]
  );

  return readMarketSaveState(db, userId, marketKey);
}

export async function unsaveMarketForUser(
  db: Pool,
  userId: string,
  marketKey: string
): Promise<MarketSaveResponse> {
  const marketId = resolveMarketId(marketKey);
  const marketResult = await db.query<{ id: string }>(
    `select id from markets where id = $1 limit 1`,
    [marketId]
  );

  if (!marketResult.rows[0]) {
    throw new MarketSaveServiceError(404, "market_not_found", "Market was not found.");
  }

  await db.query(
    `
      delete from user_market_saves
      where user_id = $1
        and market_id = $2
    `,
    [userId, marketId]
  );

  return readMarketSaveState(db, userId, marketKey);
}
