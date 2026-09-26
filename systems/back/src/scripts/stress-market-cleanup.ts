import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import {
  closeMarket,
  type CloseMarketRequest
} from "../lifecycle/horizon/close-market-service";
import { HORIZON_SYSTEM_ACTOR } from "../lifecycle/horizon/close-sweep-service";

type StressMarketRow = {
  id: string;
  title: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  close_at: Date;
  closed_at: Date | null;
  created_at: Date;
};

type ParsedArgs = {
  execute: boolean;
  keepMarket: string;
  limit: number;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--execute") {
      flags.set("execute", "true");
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      flags.set(arg.slice(2), "true");
      continue;
    }

    flags.set(arg.slice(2), next);
    index += 1;
  }

  const limit = Number.parseInt(flags.get("limit") ?? "100", 10);

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("--limit must be an integer between 1 and 500.");
  }

  return {
    execute: flags.get("execute") === "true",
    keepMarket:
      flags.get("keep") ??
      process.env.STRESS_KEEP_MARKET ??
      "stress-contract-position-root-2",
    limit
  };
}

function printHelp(): void {
  console.log(`Usage:
  npm --prefix systems/back run stress:cleanup -- [--keep <market-id>] [--limit 100] [--execute]

Dry-run by default. With --execute, closes open stress markets except the keeper.
`);
}

async function readStressMarkets(pool: ReturnType<typeof createDbPool>, limit: number): Promise<StressMarketRow[]> {
  const result = await pool.query<StressMarketRow>(
    `
      select
        id,
        title,
        status,
        close_at,
        closed_at,
        created_at
      from markets
      where id like 'stress-%'
         or category_key = 'stress'
         or lower(title) like 'stress %'
      order by created_at desc
      limit $1
    `,
    [limit]
  );

  return result.rows;
}

async function forceCloseAtNow(pool: ReturnType<typeof createDbPool>, marketId: string, now: string): Promise<void> {
  await pool.query(
    `
      update markets
      set close_at = least(close_at, $2::timestamptz),
          updated_at = now()
      where id = $1
        and status = 'open'
    `,
    [marketId, now]
  );
}

function buildCloseRequest(marketId: string, now: string): CloseMarketRequest {
  return {
    triggerType: "scheduled_time",
    reason: "Stress-market cleanup command.",
    sourceUrl: null,
    note: "Cleanup closes temporary stress markets while preserving the configured keeper seam market.",
    oracleCaseId: null,
    triggeredByOracleId: null,
    approvedByHumanId: null,
    idempotencyKey: `stress-cleanup:${marketId}:${now}`,
    requestedAt: now
  };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv);
  const env = loadAppEnv();
  const pool = createDbPool(env.db);
  const now = new Date().toISOString();

  try {
    const markets = await readStressMarkets(pool, args.limit);
    const items = [];

    for (const market of markets) {
      if (market.id === args.keepMarket) {
        items.push({
          marketId: market.id,
          status: market.status,
          action: "kept"
        });
        continue;
      }

      if (market.status !== "open") {
        items.push({
          marketId: market.id,
          status: market.status,
          action: "skipped_not_open"
        });
        continue;
      }

      if (!args.execute) {
        items.push({
          marketId: market.id,
          status: market.status,
          action: "would_close"
        });
        continue;
      }

      await forceCloseAtNow(pool, market.id, now);
      const result = await closeMarket(
        pool,
        market.id,
        buildCloseRequest(market.id, now),
        HORIZON_SYSTEM_ACTOR
      );
      items.push({
        marketId: market.id,
        status: market.status,
        action: "closed",
        closedAt: result.closedAt,
        auditEventId: result.auditEventId
      });
    }

    console.log(JSON.stringify({
      objectType: "stress_market_cleanup_receipt",
      generatedAt: now,
      execute: args.execute,
      keepMarket: args.keepMarket,
      scannedCount: markets.length,
      closeCandidateCount: items.filter((item) => item.action === "would_close" || item.action === "closed").length,
      items
    }, null, 2));
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export {};
