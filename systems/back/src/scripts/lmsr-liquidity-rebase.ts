import { resolve as resolvePath } from "node:path";
import type { PoolClient } from "pg";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import {
  assertExecutableLiquidityRebasePlan,
  buildPricePreservingLiquidityRebasePlan,
  recommendLiquidityDepth,
  type LiquidityRebasePlan
} from "../engine/pricing";
import { insertAuditEvent } from "../shared/audit-events";
import { toDecimal } from "../shared/decimals";

type Format = "markdown" | "json";

type ParsedArgs = {
  allowShrink: boolean;
  execute: boolean;
  format: Format;
  marketId: string;
  reason: string | null;
  targetLiquidityB: string | null;
};

type MarketLiquidityRow = {
  market_id: string;
  title: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  category_key: string | null;
  market_family_key: string | null;
  current_version: string;
  current_liquidity_b: string;
  outcome_id: string;
  q_shares: string;
  sort_order: number;
};

type LiquidityRebaseReceipt = {
  marketId: string;
  title: string;
  status: string;
  execute: boolean;
  reason: string | null;
  auditEventId: string | null;
  marketStateVersionBefore: number;
  marketStateVersionAfter: number;
  plan: LiquidityRebasePlan;
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

export function parseLiquidityRebaseArgs(argv: string[]): ParsedArgs {
  const marketId = readArg(argv, "market");
  const execute = hasFlag(argv, "execute");
  const reason = readArg(argv, "reason");

  if (!marketId) {
    throw new Error("--market=<market-id> is required");
  }

  if (execute && !reason) {
    throw new Error("--execute requires --reason=<operator reason>");
  }

  return {
    allowShrink: hasFlag(argv, "allow-shrink"),
    execute,
    format: readFormat(argv),
    marketId,
    reason,
    targetLiquidityB: readArg(argv, "target-b")
  };
}

async function readLockedMarketRows(
  client: PoolClient,
  marketId: string
): Promise<MarketLiquidityRow[]> {
  const result = await client.query<MarketLiquidityRow>(
    `
      select
        m.id as market_id,
        m.title,
        m.status,
        m.category_key,
        m.market_family_key,
        ps.version::text as current_version,
        ps.liquidity_b::text as current_liquidity_b,
        o.id as outcome_id,
        os.q_shares::text as q_shares,
        o.sort_order
      from markets m
      join market_pricing_state ps
        on ps.market_id = m.id
      join market_outcomes o
        on o.market_id = m.id
      join market_outcome_state os
        on os.market_id = m.id
       and os.outcome_id = o.id
      where m.id = $1
      order by o.sort_order
      for update of m, ps, os
    `,
    [marketId]
  );

  return result.rows;
}

function assertMarketCanRebase(row: MarketLiquidityRow): void {
  if (row.status !== "draft" && row.status !== "open") {
    throw new Error(`market must be draft/open to rebase, got ${row.status}`);
  }
}

function resolveTargetLiquidityB(rows: readonly MarketLiquidityRow[], override: string | null): string {
  if (override) {
    return override;
  }

  const first = rows[0]!;
  return recommendLiquidityDepth({
    categoryKey: first.category_key,
    familyKey: first.market_family_key,
    outcomeCount: rows.length
  }).liquidityB;
}

function assertTargetDoesNotShrink(
  currentLiquidityB: string,
  targetLiquidityB: string,
  allowShrink: boolean
): void {
  if (!allowShrink && toDecimal(targetLiquidityB).lessThan(toDecimal(currentLiquidityB))) {
    throw new Error(
      `target liquidity_b must not be lower than current liquidity_b (${currentLiquidityB}) unless --allow-shrink is set`
    );
  }
}

function readMarketStateVersion(row: MarketLiquidityRow): number {
  const parsed = Number(row.current_version);

  return Number.isFinite(parsed) ? parsed : 0;
}

function assertUpdatedRows(label: string, actual: number | null | undefined, expected = 1): void {
  if (actual !== expected) {
    throw new Error(`${label} update touched ${actual ?? 0} rows, expected ${expected}`);
  }
}

async function applyRebase(
  client: PoolClient,
  rows: readonly MarketLiquidityRow[],
  plan: LiquidityRebasePlan,
  reason: string
): Promise<string> {
  const marketId = rows[0]!.market_id;
  const marketStateVersionBefore = readMarketStateVersion(rows[0]!);
  const marketStateVersionAfter = marketStateVersionBefore + 1;

  const marketUpdate = await client.query(
    `
      update markets
      set liquidity_b = $2,
          updated_at = now()
      where id = $1
    `,
    [marketId, plan.targetLiquidityB]
  );
  assertUpdatedRows("markets", marketUpdate.rowCount);

  const pricingUpdate = await client.query(
    `
      update market_pricing_state
      set liquidity_b = $2,
          version = version + 1,
          updated_at = now()
      where market_id = $1
    `,
    [marketId, plan.targetLiquidityB]
  );
  assertUpdatedRows("market_pricing_state", pricingUpdate.rowCount);

  for (let index = 0; index < rows.length; index += 1) {
    const outcomeUpdate = await client.query(
      `
        update market_outcome_state
        set q_shares = $3,
            last_price = $4,
            updated_at = now()
        where market_id = $1
          and outcome_id = $2
      `,
      [
        marketId,
        rows[index]!.outcome_id,
        plan.targetQShares[index],
        plan.targetPrices[index]
      ]
    );
    assertUpdatedRows(`market_outcome_state.${rows[index]!.outcome_id}`, outcomeUpdate.rowCount);
  }

  return insertAuditEvent(client, {
    actorId: "system_back_engine",
    action: "market_liquidity_rebased",
    entityType: "market",
    entityId: marketId,
    payload: {
      reason,
      marketStateVersionBefore,
      marketStateVersionAfter,
      plan
    }
  });
}

function renderMarkdown(receipt: LiquidityRebaseReceipt): string {
  const { plan } = receipt;

  return [
    "lmsr-liquidity-rebase",
    `market: ${receipt.marketId}`,
    `title: ${receipt.title}`,
    `status: ${receipt.status}`,
    `mode: ${receipt.execute ? "execute" : "dry-run"}`,
    `audit: ${receipt.auditEventId ?? "-"}`,
    `marketStateVersion: ${receipt.marketStateVersionBefore} -> ${receipt.marketStateVersionAfter}`,
    `b: ${plan.currentLiquidityB} -> ${plan.targetLiquidityB}`,
    `maxPriceDrift: ${plan.maxPriceDrift}`,
    `lmsrCostDelta: ${plan.lmsrCostDelta}`,
    "",
    "| outcome | q before | q after | price before | price after |",
    "| ---: | ---: | ---: | ---: | ---: |",
    ...plan.currentQShares.map((qShare, index) =>
      `| ${index} | ${qShare} | ${plan.targetQShares[index]} | ${plan.currentPrices[index]} | ${plan.targetPrices[index]} |`
    )
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseLiquidityRebaseArgs(process.argv.slice(2));
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const receipt = await withTransaction(pool, async (client) => {
      const rows = await readLockedMarketRows(client, args.marketId);

      if (!rows.length) {
        throw new Error(`market not found: ${args.marketId}`);
      }

      assertMarketCanRebase(rows[0]!);

      const targetLiquidityB = resolveTargetLiquidityB(rows, args.targetLiquidityB);
      assertTargetDoesNotShrink(
        rows[0]!.current_liquidity_b,
        targetLiquidityB,
        args.allowShrink
      );
      const marketStateVersionBefore = readMarketStateVersion(rows[0]!);
      const plan = buildPricePreservingLiquidityRebasePlan({
        currentLiquidityB: rows[0]!.current_liquidity_b,
        targetLiquidityB,
        currentQShares: rows.map((row) => row.q_shares)
      });
      if (args.execute) {
        assertExecutableLiquidityRebasePlan(plan);
      }
      const auditEventId = args.execute
        ? await applyRebase(client, rows, plan, args.reason!)
        : null;

      return {
        marketId: rows[0]!.market_id,
        title: rows[0]!.title,
        status: rows[0]!.status,
        execute: args.execute,
        reason: args.reason,
        auditEventId,
        marketStateVersionBefore,
        marketStateVersionAfter: args.execute
          ? marketStateVersionBefore + 1
          : marketStateVersionBefore,
        plan
      };
    });

    if (args.format === "json") {
      console.log(JSON.stringify(receipt, null, 2));
      return;
    }

    console.log(renderMarkdown(receipt));
  } finally {
    await pool.end();
  }
}

const currentScriptPath = process.argv[1] ? resolvePath(process.argv[1]) : "";

if (
  currentScriptPath.endsWith("lmsr-liquidity-rebase.ts") ||
  currentScriptPath.endsWith("lmsr-liquidity-rebase.js")
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
