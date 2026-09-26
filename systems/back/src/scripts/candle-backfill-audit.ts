/**
 * candle-backfill-audit — confirms every traded market has at least one row
 * in market_base_candles (migration 048). Markets with trades but zero base
 * candle rows fall back to readAllHistoryTradeRows on every /history read
 * with no persisted-candle shortcut — cheap on a small market, a full-history
 * JS replay on a large one. This is the runnable receipt: run once after
 * deploy (or any time base-candle coverage is in question) as a one-off job
 * to confirm the backfill (backfill-base-candles.ts) is complete.
 *
 * Exits nonzero by default when any traded market has zero base-candle
 * rows — this script's whole job is to be a CI/Render-job gate, so failing
 * loud is the default (unlike audit:resolution-money / audit:total-volume,
 * which are ad-hoc/investigative and opt into failure via --fail-on-*).
 *
 *   npm run audit:candle-backfill
 *   npm run audit:candle-backfill -- --json
 *   npm run audit:candle-backfill -- --no-fail   (report only, always exit 0)
 */
import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";

type Verdict = "pass" | "gap";

type AuditOptions = {
  json: boolean;
  failOnGap: boolean;
};

type UnbackfilledMarketRow = {
  market_id: string;
  title: string;
  trade_count: string;
  first_trade_at: Date | string;
  last_trade_at: Date | string;
};

export type CandleBackfillAuditReport = {
  objectType: "candle_backfill_audit";
  generatedAt: string;
  verdict: Verdict;
  tradedMarkets: number;
  marketsWithBaseCandles: number;
  unbackfilledMarkets: UnbackfilledMarketRow[];
};

function readFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function parseCandleBackfillAuditOptions(
  args = process.argv.slice(2)
): AuditOptions {
  return {
    json: readFlag(args, "json"),
    failOnGap: !readFlag(args, "no-fail")
  };
}

export async function runCandleBackfillAudit(db: Queryable): Promise<CandleBackfillAuditReport> {
  const [countsResult, unbackfilledResult] = await Promise.all([
    db.query<{ traded_markets: string; markets_with_base_candles: string }>(`
      select
        (select count(distinct market_id) from trades) as traded_markets,
        (select count(distinct market_id) from market_base_candles) as markets_with_base_candles
    `),
    db.query<UnbackfilledMarketRow>(`
      select
        t.market_id,
        m.title,
        count(t.id)::text as trade_count,
        min(t.created_at) as first_trade_at,
        max(t.created_at) as last_trade_at
      from trades t
      join markets m
        on m.id = t.market_id
      left join market_base_candles mbc
        on mbc.market_id = t.market_id
      where mbc.market_id is null
      group by t.market_id, m.title
      order by count(t.id) desc
    `)
  ]);

  const counts = countsResult.rows[0];
  const unbackfilledMarkets = unbackfilledResult.rows;

  return {
    objectType: "candle_backfill_audit",
    generatedAt: new Date().toISOString(),
    verdict: unbackfilledMarkets.length === 0 ? "pass" : "gap",
    tradedMarkets: Number(counts?.traded_markets ?? "0"),
    marketsWithBaseCandles: Number(counts?.markets_with_base_candles ?? "0"),
    unbackfilledMarkets
  };
}

export function formatCandleBackfillAudit(report: CandleBackfillAuditReport): string {
  const lines = [
    `candle-backfill-audit: verdict=${report.verdict} traded_markets=${report.tradedMarkets} with_base_candles=${report.marketsWithBaseCandles} unbackfilled=${report.unbackfilledMarkets.length}`
  ];

  for (const row of report.unbackfilledMarkets) {
    lines.push(
      `candle-backfill-audit: gap market=${row.market_id} title="${row.title}" trades=${row.trade_count} first=${row.first_trade_at} last=${row.last_trade_at}`
    );
  }

  if (report.unbackfilledMarkets.length > 0) {
    lines.push(
      "candle-backfill-audit: run `node --import tsx src/scripts/backfill-base-candles.ts` to close the gap"
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseCandleBackfillAuditOptions();
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const report = await runCandleBackfillAudit(pool);
    const output = options.json
      ? JSON.stringify(report, null, 2)
      : formatCandleBackfillAudit(report);

    console.log(output);

    if (report.verdict === "gap" && options.failOnGap) {
      process.exitCode = 1;
    }
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
