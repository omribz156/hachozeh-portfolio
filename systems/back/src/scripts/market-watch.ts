import { Command } from "commander";

import { promoteMarketWatchSignalToOracleCase } from "../../../oracle/src/market-watch-case-bridge";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { createMarketWatchNotifierFromEnv } from "../market-watch/notifier";
import {
  scanDueMarketWatchPlans,
  upsertMarketWatchPlan,
  type MarketWatchCheckerKind
} from "../market-watch/service";

type ScanDueOptions = {
  limit?: string;
  now?: string;
  dryRun?: boolean;
  json?: boolean;
  jsonl?: boolean;
  notify?: string | boolean;
};

type PlanUpsertOptions = {
  id?: string;
  market?: string;
  event?: string;
  checkerKind?: string;
  sourceUrl?: string[];
  entity?: string[];
  keyword?: string[];
  runAt?: string[];
  intervalMinutes?: string;
  nextRunAt?: string;
  timezone?: string;
  proximityChars?: string;
  note?: string;
  disabled?: boolean;
  json?: boolean;
};

const CHECKER_KINDS = new Set<MarketWatchCheckerKind>(["show_official_keywords"]);

function readPositiveInteger(value: string | undefined, fallback: number, field: string): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return parsed;
}

function readOptionalPositiveNumber(value: string | undefined, field: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number.`);
  }
  return parsed;
}

function parseBooleanOption(value: string | boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("Boolean flag must be true or false.");
}

function normalizeRepeated(values: string[] | undefined, field: string): string[] {
  const normalized = (values ?? [])
    .flatMap((value) => value.split("\n"))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new Error(`${field} requires at least one value.`);
  }

  return [...new Set(normalized)];
}

function readTimestamp(value: string | undefined, field: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return date.toISOString();
}

function firstFutureRunAt(runAt: string[], now = Date.now()): string | null {
  return runAt
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()) && date.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null;
}

function printPayload(payload: unknown, options: { json?: boolean; jsonl?: boolean }): void {
  if (options.jsonl) {
    console.log(JSON.stringify(payload));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

async function runScanDue(options: ScanDueOptions): Promise<void> {
  const pool = createDbPool(loadAppEnv().db);
  const notify = parseBooleanOption(options.notify, true);

  try {
    const payload = await scanDueMarketWatchPlans(pool, {
      now: options.now ? readTimestamp(options.now, "--now") ?? undefined : undefined,
      limit: readPositiveInteger(options.limit, 25, "--limit"),
      notifier: notify ? createMarketWatchNotifierFromEnv() : null,
      casePromoter: (input) => promoteMarketWatchSignalToOracleCase(pool, input),
      dryRun: options.dryRun
    });
    printPayload(payload, options);

    if (payload.failedSendCount > 0) {
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

async function runPlanUpsert(options: PlanUpsertOptions): Promise<void> {
  const id = options.id?.trim();
  if (!id) {
    throw new Error("--id is required.");
  }

  const checkerKind = (options.checkerKind ?? "show_official_keywords") as MarketWatchCheckerKind;
  if (!CHECKER_KINDS.has(checkerKind)) {
    throw new Error(`Unsupported --checker-kind: ${checkerKind}`);
  }

  const marketId = options.market?.trim() || null;
  const eventId = options.event?.trim() || null;
  if (!marketId && !eventId) {
    throw new Error("--market or --event is required.");
  }
  if (marketId && eventId) {
    throw new Error("Use only one of --market or --event.");
  }

  const runAt = (options.runAt ?? []).map((value) => readTimestamp(value, "--run-at")).filter((value): value is string => Boolean(value));
  const intervalMinutes = readOptionalPositiveNumber(options.intervalMinutes, "--interval-minutes");
  const proximityChars = readOptionalPositiveNumber(options.proximityChars, "--proximity-chars");
  const runPolicy: Record<string, unknown> = {};

  if (runAt.length > 0) {
    runPolicy.runAt = runAt;
  }
  if (intervalMinutes !== undefined) {
    runPolicy.intervalMinutes = intervalMinutes;
  }
  if (proximityChars !== undefined) {
    runPolicy.proximityChars = proximityChars;
  }

  const nextRunAt = readTimestamp(options.nextRunAt, "--next-run-at") ?? firstFutureRunAt(runAt);
  if (!nextRunAt && intervalMinutes === undefined) {
    throw new Error("A watch plan needs --next-run-at, a future --run-at, or --interval-minutes.");
  }

  const pool = createDbPool(loadAppEnv().db);

  try {
    const plan = await upsertMarketWatchPlan(pool, {
      id,
      marketId,
      eventId,
      checkerKind,
      enabled: !options.disabled,
      timezone: options.timezone?.trim() || "Asia/Jerusalem",
      runPolicy,
      nextRunAt: nextRunAt ?? new Date(Date.now() + Math.round(intervalMinutes! * 60_000)).toISOString(),
      sourceUrls: normalizeRepeated(options.sourceUrl, "--source-url"),
      entities: normalizeRepeated(options.entity, "--entity"),
      keywords: normalizeRepeated(options.keyword, "--keyword"),
      note: options.note?.trim() || null
    });

    printPayload({ objectType: "market_watch_plan_upsert", plan }, options);
  } finally {
    await pool.end();
  }
}

const program = new Command("market-watch")
  .description("Opt-in market watch pings for manual/source-lag markets. Does not mutate markets.");

program
  .command("scan-due")
  .description("Scan due watch plans and ping operators for new signals.")
  .option("--limit <n>", "Maximum due plans to scan.", "25")
  .option("--now <timestamp>", "Override now for testing.")
  .option("--dry-run", "Run without writing signals or updating plan schedule.")
  .option("--notify <true|false>", "Send configured notifications.", "true")
  .option("--json")
  .option("--jsonl")
  .action(runScanDue);

program
  .command("plan-upsert")
  .description("Create or update one market watch plan.")
  .requiredOption("--id <id>")
  .option("--market <market-id>")
  .option("--event <event-id>")
  .option("--checker-kind <kind>", "Checker kind.", "show_official_keywords")
  .option("--source-url <url>", "Source URL to scan; repeatable.", (value, previous: string[] = []) => [...previous, value])
  .option("--entity <text>", "Entity/name to watch; repeatable.", (value, previous: string[] = []) => [...previous, value])
  .option("--keyword <text>", "Keyword to watch; repeatable.", (value, previous: string[] = []) => [...previous, value])
  .option("--run-at <timestamp>", "Scheduled run timestamp; repeatable.", (value, previous: string[] = []) => [...previous, value])
  .option("--interval-minutes <n>", "Reschedule by interval after each run.")
  .option("--next-run-at <timestamp>", "Explicit next run timestamp.")
  .option("--timezone <tz>", "Operator timezone.", "Asia/Jerusalem")
  .option("--proximity-chars <n>", "Max character distance between entity and keyword.", "700")
  .option("--note <text>")
  .option("--disabled")
  .option("--json")
  .action(runPlanUpsert);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
