import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";

type Verdict = "pass" | "drift";

type ReconciliationOptions = {
  json: boolean;
  failOnDrift: boolean;
};

type DriftRow = {
  market_id: string;
  recorded_total_volume: string;
  computed_total_volume: string;
  delta: string;
};

type OrphanTradeRow = {
  market_id: string;
  computed_total_volume: string;
};

export type TotalVolumeReconciliationReport = {
  objectType: "total_volume_reconciliation";
  generatedAt: string;
  verdict: Verdict;
  marketsChecked: number;
  driftedMarkets: DriftRow[];
  tradesWithoutPricingState: OrphanTradeRow[];
};

function readFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function parseTotalVolumeReconciliationOptions(
  args = process.argv.slice(2)
): ReconciliationOptions {
  return {
    json: readFlag(args, "json"),
    failOnDrift: readFlag(args, "fail-on-drift")
  };
}

export async function runTotalVolumeReconciliation(
  db: Queryable
): Promise<TotalVolumeReconciliationReport> {
  const checkedResult = await db.query<{ markets_checked: string }>(
    "select count(*)::text as markets_checked from market_pricing_state"
  );

  // Tolerance is EXACT zero: the comparison happens in SQL as
  // numeric-vs-numeric (`is distinct from`), never through JS floats.
  // Trade volume semantics: sum(trades.cash_amount) — buys and sells both
  // positive, voided markets keep their trades. Must equal the column the
  // trade transaction maintains (pricing-state-writes.ts).
  const driftResult = await db.query<DriftRow>(
    `
      select
        ps.market_id,
        ps.total_volume::text as recorded_total_volume,
        computed.total_volume::text as computed_total_volume,
        (computed.total_volume - ps.total_volume)::text as delta
      from market_pricing_state ps
      cross join lateral (
        select coalesce(sum(t.cash_amount), 0)::numeric(20, 6) as total_volume
        from trades t
        where t.market_id = ps.market_id
      ) computed
      where ps.total_volume is distinct from computed.total_volume
      order by ps.market_id
    `
  );

  // Coverage from the other side: trades whose market has no pricing-state
  // row are invisible to the ps-driven diff above but still represent
  // recorded volume nothing accounts for.
  const orphanResult = await db.query<OrphanTradeRow>(
    `
      select
        t.market_id,
        coalesce(sum(t.cash_amount), 0)::numeric(20, 6)::text as computed_total_volume
      from trades t
      left join market_pricing_state ps
        on ps.market_id = t.market_id
      where ps.market_id is null
      group by t.market_id
      order by t.market_id
    `
  );

  const drifted = driftResult.rows;
  const orphans = orphanResult.rows;

  return {
    objectType: "total_volume_reconciliation",
    generatedAt: new Date().toISOString(),
    verdict: drifted.length === 0 && orphans.length === 0 ? "pass" : "drift",
    marketsChecked: Number(checkedResult.rows[0]?.markets_checked ?? "0"),
    driftedMarkets: drifted,
    tradesWithoutPricingState: orphans
  };
}

export function formatTotalVolumeReconciliation(
  report: TotalVolumeReconciliationReport
): string {
  const lines = [
    `total-volume-reconciliation: verdict=${report.verdict} markets_checked=${report.marketsChecked} drifted=${report.driftedMarkets.length} orphaned=${report.tradesWithoutPricingState.length}`
  ];

  for (const row of report.driftedMarkets) {
    lines.push(
      `total-volume-reconciliation: drift market=${row.market_id} recorded=${row.recorded_total_volume} computed=${row.computed_total_volume} delta=${row.delta}`
    );
  }

  for (const row of report.tradesWithoutPricingState) {
    lines.push(
      `total-volume-reconciliation: orphan-trades market=${row.market_id} computed=${row.computed_total_volume} (no market_pricing_state row)`
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseTotalVolumeReconciliationOptions();
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const report = await runTotalVolumeReconciliation(pool);
    const output = options.json
      ? JSON.stringify(report, null, 2)
      : formatTotalVolumeReconciliation(report);

    console.log(output);

    if (report.verdict === "drift" && options.failOnDrift) {
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
