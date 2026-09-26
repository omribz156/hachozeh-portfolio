import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";
import { readOutcomeKey } from "../markets/market-api/identity";
import { upsertBaseCandle } from "../markets/market-history/base-candle-store";

type SeedResult = {
  marketId: string;
  bucketAt: string;
  outcomeCount: number;
  values: Record<string, number>;
  dryRun: boolean;
};

type MarketRow = {
  id: string;
  open_at: Date | string | null;
};

type OutcomeRow = {
  id: string;
};

function parseArgs(args = process.argv.slice(2)): { marketIds: string[]; dryRun: boolean } {
  const dryRun = args.includes("--dry-run");
  const marketIds = args
    .filter((arg) => arg !== "--dry-run")
    .map((arg) => arg.trim())
    .filter(Boolean);

  if (marketIds.length === 0) {
    throw new Error("Usage: seed-opening-base-candle <market-id> [market-id...] [--dry-run]");
  }

  return { marketIds, dryRun };
}

function readOpenAtMs(market: MarketRow): number {
  if (!market.open_at) {
    throw new Error(`Market ${market.id} is missing open_at`);
  }

  const openAtMs = market.open_at instanceof Date
    ? market.open_at.getTime()
    : Date.parse(market.open_at);

  if (!Number.isFinite(openAtMs)) {
    throw new Error(`Market ${market.id} has invalid open_at`);
  }

  return openAtMs;
}

export async function seedOpeningBaseCandle(
  db: Queryable,
  marketId: string,
  options: { dryRun?: boolean } = {}
): Promise<SeedResult> {
  const marketResult = await db.query<MarketRow>(
    `select id, open_at from markets where id = $1`,
    [marketId]
  );
  const market = marketResult.rows[0];
  if (!market) {
    throw new Error(`Market not found: ${marketId}`);
  }

  const outcomeResult = await db.query<OutcomeRow>(
    `select id from market_outcomes where market_id = $1 order by sort_order asc, id asc`,
    [marketId]
  );
  if (outcomeResult.rows.length === 0) {
    throw new Error(`Market has no outcomes: ${marketId}`);
  }

  const price = Number((1 / outcomeResult.rows.length).toFixed(8));
  const values: Record<string, number> = {};
  for (const outcome of outcomeResult.rows) {
    values[readOutcomeKey(outcome.id)] = price;
  }

  const openAtMs = readOpenAtMs(market);
  if (!options.dryRun) {
    await upsertBaseCandle(db, marketId, openAtMs, values);
  }

  return {
    marketId,
    bucketAt: new Date(Math.floor(openAtMs / 60_000) * 60_000).toISOString(),
    outcomeCount: outcomeResult.rows.length,
    values,
    dryRun: options.dryRun === true
  };
}

async function main(): Promise<void> {
  const { marketIds, dryRun } = parseArgs();
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const results: SeedResult[] = [];
    for (const marketId of marketIds) {
      results.push(await seedOpeningBaseCandle(pool, marketId, { dryRun }));
    }
    console.log(JSON.stringify({ event: "seed_opening_base_candle", results }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
