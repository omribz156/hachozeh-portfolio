import { resolve as resolvePath } from "node:path";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { sweepPendingPortfolioClaims } from "../engine/portfolio/portfolio-claim-service";

export type PortfolioClaimSweepOptions = {
  olderThanDays: number;
  limit: number;
  actorId: string;
  json: boolean;
};

function readFlagValue(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = argv.indexOf(`--${name}`);
  const next = index >= 0 ? argv[index + 1] : null;
  return next && !next.startsWith("--") ? next : null;
}

function readPositiveIntegerArg(
  argv: string[],
  name: string,
  fallback: number
): number {
  const raw = readFlagValue(argv, name);

  if (raw === null) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return parsed;
}

export function parsePortfolioClaimSweepArgs(
  argv: string[]
): PortfolioClaimSweepOptions {
  return {
    olderThanDays: readPositiveIntegerArg(argv, "older-than-days", 30),
    limit: readPositiveIntegerArg(argv, "limit", 100),
    actorId: readFlagValue(argv, "actor-id")?.trim() || "portfolio_claim_sweep",
    json: argv.includes("--json")
  };
}

function formatPortfolioClaimSweepReport(
  result: Awaited<ReturnType<typeof sweepPendingPortfolioClaims>>
): string {
  return [
    "# Portfolio claim sweep",
    `- Swept claims: ${result.sweptCount}`,
    `- Swept amount: ${result.sweptAmount}`,
    `- Claim IDs: ${result.claimIds.length ? result.claimIds.join(", ") : "none"}`
  ].join("\n");
}

export async function runPortfolioClaimSweep(
  options: PortfolioClaimSweepOptions
): Promise<Awaited<ReturnType<typeof sweepPendingPortfolioClaims>>> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    return await sweepPendingPortfolioClaims(pool, {
      olderThanDays: options.olderThanDays,
      limit: options.limit,
      actorId: options.actorId
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const options = parsePortfolioClaimSweepArgs(process.argv.slice(2));
  const result = await runPortfolioClaimSweep(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatPortfolioClaimSweepReport(result));
}

if (process.argv[1] && resolvePath(process.argv[1]).endsWith("portfolio-claim-sweep.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
