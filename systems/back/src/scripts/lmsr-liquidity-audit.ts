import { resolve as resolvePath } from "node:path";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import {
  classifyLiquidityAuditRow,
  type LiquidityAuditInput,
  type LiquidityAuditResult
} from "../engine/pricing";
import {
  buildLiquidityAuditJsonPayload,
  hasLiquidityAuditBlockingFindings,
  renderLiquidityAuditMarkdown
} from "./lmsr-liquidity-audit-renderer";

type Format = "markdown" | "json";

type ParsedArgs = {
  format: Format;
  limit: number;
  marketId: string | null;
  onlyFlagged: boolean;
  requireClean: boolean;
  status: string | null;
  withRebasePlan: boolean;
};

type LiquidityAuditRow = {
  market_id: string;
  title: string;
  status: string;
  category_key: string | null;
  market_family_key: string | null;
  outcome_count: number | string;
  liquidity_b: string;
  trade_count: number | string;
  trade_volume: string;
};

function readArg(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));

  return match ? match.slice(prefix.length) : null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function readFormat(argv: string[]): Format {
  const raw = readArg(argv, "format") ?? "markdown";

  if (raw === "markdown" || raw === "json") {
    return raw;
  }

  throw new Error("--format must be markdown or json");
}

function readLimit(argv: string[]): number {
  const raw = readArg(argv, "limit") ?? "40";
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("--limit must be an integer between 1 and 500");
  }

  return parsed;
}

export function parseLiquidityAuditArgs(argv: string[]): ParsedArgs {
  return {
    format: readFormat(argv),
    limit: readLimit(argv),
    marketId: readArg(argv, "market"),
    onlyFlagged: hasFlag(argv, "only-flagged"),
    requireClean: hasFlag(argv, "require-clean"),
    status: readArg(argv, "status"),
    withRebasePlan: hasFlag(argv, "with-rebase-plan")
  };
}

function mapRow(row: LiquidityAuditRow): LiquidityAuditInput {
  return {
    marketId: row.market_id,
    title: row.title,
    status: row.status,
    categoryKey: row.category_key,
    familyKey: row.market_family_key,
    outcomeCount: Number(row.outcome_count),
    liquidityB: row.liquidity_b,
    tradeCount: Number(row.trade_count),
    tradeVolume: row.trade_volume
  };
}

async function readMarkets(args: ParsedArgs): Promise<LiquidityAuditInput[]> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);
  const values: Array<string | number> = [];
  const clauses: string[] = [];

  if (args.marketId) {
    values.push(args.marketId);
    clauses.push(`m.id = $${values.length}`);
  }

  if (args.status) {
    values.push(args.status);
    clauses.push(`m.status = $${values.length}`);
  }

  values.push(args.limit);

  try {
    const result = await pool.query<LiquidityAuditRow>(
      `
        with outcome_counts as (
          select
            market_id,
            count(*)::int as outcome_count
          from market_outcomes
          group by market_id
        ),
        trade_rollup as (
          select
            market_id,
            count(*)::int as trade_count,
            coalesce(sum(cash_amount), 0)::text as trade_volume
          from trades
          group by market_id
        )
        select
          m.id as market_id,
          m.title,
          m.status,
          m.category_key,
          m.market_family_key,
          coalesce(oc.outcome_count, 0) as outcome_count,
          coalesce(ps.liquidity_b, m.liquidity_b)::text as liquidity_b,
          coalesce(tr.trade_count, 0) as trade_count,
          coalesce(tr.trade_volume, '0') as trade_volume
        from markets m
        left join market_pricing_state ps
          on ps.market_id = m.id
        left join outcome_counts oc
          on oc.market_id = m.id
        left join trade_rollup tr
          on tr.market_id = m.id
        ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
        order by m.updated_at desc, m.created_at desc
        limit $${values.length}
      `,
      values
    );

    return result.rows.map(mapRow);
  } finally {
    await pool.end();
  }
}

function severityRank(result: LiquidityAuditResult): number {
  switch (result.severity) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "watch":
      return 2;
    case "ok":
      return 3;
  }
}

async function main(): Promise<void> {
  const args = parseLiquidityAuditArgs(process.argv.slice(2));
  const inputs = await readMarkets(args);
  const results = inputs
    .map(classifyLiquidityAuditRow)
    .filter((result) => !args.onlyFlagged || result.flags.length > 0)
    .sort((left, right) => severityRank(left) - severityRank(right));

  if (args.format === "json") {
    console.log(JSON.stringify(buildLiquidityAuditJsonPayload(results, {
      withRebasePlan: args.withRebasePlan
    }), null, 2));
    if (args.requireClean && hasLiquidityAuditBlockingFindings(results)) {
      process.exitCode = 2;
    }
    return;
  }

  console.log(renderLiquidityAuditMarkdown(results, { withRebasePlan: args.withRebasePlan }));
  if (args.requireClean && hasLiquidityAuditBlockingFindings(results)) {
    process.exitCode = 2;
  }
}

const currentScriptPath = process.argv[1] ? resolvePath(process.argv[1]) : "";

if (
  currentScriptPath.endsWith("lmsr-liquidity-audit.ts") ||
  currentScriptPath.endsWith("lmsr-liquidity-audit.js")
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
