import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";

type Options = {
  market?: string[];
  event?: string[];
  staleMs?: string;
  signalWindowHours?: string;
  json?: boolean;
};

type Row = {
  market_id: string;
  event_id: string | null;
  title: string;
  status: string;
  marker_present: boolean;
  enabled_watch_plan_count: number;
  stale_due_watch_plan_count: number;
  next_run_at: Date | string | null;
  last_checked_at: Date | string | null;
  failed_delivery_signal_count: number;
  promotion_error_signal_count: number;
};

type Issue = {
  marketId: string | null;
  eventId: string | null;
  severity: "watch" | "blocker";
  code: "missing_enabled_watch_plan" | "stale_due_watch_plan" | "failed_signal_delivery" | "promotion_error_signal";
  count?: number;
  affectedMarketCount?: number;
};

export type MarketWatchCoverageDoctorReport = {
  objectType: "market_watch_coverage_doctor";
  generatedAt: string;
  status: "clean" | "findings";
  scannedCount: number;
  issueCount: number;
  blockerCount: number;
  warningCount: number;
  issues: Issue[];
  rows: Array<{
    marketId: string;
    eventId: string | null;
    title: string;
    status: string;
    markerPresent: boolean;
    enabledWatchPlanCount: number;
    staleDueWatchPlanCount: number;
    nextRunAt: string | null;
    lastCheckedAt: string | null;
    failedDeliverySignalCount: number;
    promotionErrorSignalCount: number;
  }>;
};

const DEFAULT_STALE_MS = 30 * 60_000;
const DEFAULT_SIGNAL_WINDOW_HOURS = 72;

function repeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function readNonNegativeNumber(value: string | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return parsed;
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function issueScope(issue: Issue): string {
  return issue.eventId ? `event:${issue.eventId}` : `market:${issue.marketId}`;
}

function pushIssue(issues: Issue[], issue: Issue): void {
  const existing = issues.find((candidate) =>
    candidate.code === issue.code && issueScope(candidate) === issueScope(issue)
  );

  if (!existing) {
    issues.push({
      ...issue,
      affectedMarketCount: issue.affectedMarketCount ?? 1
    });
    return;
  }

  existing.affectedMarketCount = (existing.affectedMarketCount ?? 1) + (issue.affectedMarketCount ?? 1);
  if (issue.count !== undefined) {
    existing.count = Math.max(existing.count ?? 0, issue.count);
  }
  if (issue.severity === "blocker") {
    existing.severity = "blocker";
  }
}

export async function runMarketWatchCoverageDoctor(
  db: Queryable,
  input: {
    marketIds?: string[];
    eventIds?: string[];
    now?: string;
    staleMs?: number;
    signalWindowHours?: number;
  } = {}
): Promise<MarketWatchCoverageDoctorReport> {
  const marketIds = [...new Set((input.marketIds ?? []).map((value) => value.trim()).filter(Boolean))];
  const eventIds = [...new Set((input.eventIds ?? []).map((value) => value.trim()).filter(Boolean))];
  const now = input.now ?? new Date().toISOString();
  const staleMs = input.staleMs ?? DEFAULT_STALE_MS;
  const signalWindowHours = input.signalWindowHours ?? DEFAULT_SIGNAL_WINDOW_HOURS;

  const rows = (
    await db.query<Row>(
      `
          with watch_signal_rollup as (
            select
              watch_plan_id,
              count(*) filter (
                where delivery_status = 'failed'
                  and created_at >= coalesce($3::timestamptz, now()) - ($5::text || ' hours')::interval
              )::int as failed_delivery_signal_count,
              count(*) filter (
                where promotion_error is not null
                  and status = 'new'
                  and created_at >= coalesce($3::timestamptz, now()) - ($5::text || ' hours')::interval
              )::int as promotion_error_signal_count
            from market_watch_signals
            group by watch_plan_id
          )
          select
            m.id as market_id,
            m.event_id,
            m.title,
            m.status,
            (
              m.market_contract::text like '%market-watch-pings-only-no-mutation%'
              or m.oracle_source_policy::text like '%market-watch-pings-only-no-mutation%'
            ) as marker_present,
            count(mwp.id) filter (where mwp.enabled = true)::int as enabled_watch_plan_count,
            count(mwp.id) filter (
              where mwp.enabled = true
                and mwp.next_run_at is not null
                and mwp.next_run_at <= coalesce($3::timestamptz, now()) - ($4::text || ' milliseconds')::interval
            )::int as stale_due_watch_plan_count,
            min(mwp.next_run_at) filter (where mwp.enabled = true) as next_run_at,
            max(mwp.last_checked_at) filter (where mwp.enabled = true) as last_checked_at,
            coalesce(sum(wsr.failed_delivery_signal_count), 0)::int as failed_delivery_signal_count,
            coalesce(sum(wsr.promotion_error_signal_count), 0)::int as promotion_error_signal_count
          from markets m
          left join market_watch_plans mwp
            on mwp.market_id = m.id
            or (m.event_id is not null and mwp.event_id = m.event_id)
          left join watch_signal_rollup wsr
            on wsr.watch_plan_id = mwp.id
          where ($1::text[] is null or m.id = any($1::text[]))
            and ($2::text[] is null or m.event_id = any($2::text[]))
          group by m.id
          having (
            m.market_contract::text like '%market-watch-pings-only-no-mutation%'
            or m.oracle_source_policy::text like '%market-watch-pings-only-no-mutation%'
            or count(mwp.id) filter (where mwp.enabled = true) > 0
          )
          order by m.close_at asc, m.id asc
        `,
      [
        marketIds.length ? marketIds : null,
        eventIds.length ? eventIds : null,
        now,
        String(staleMs),
        String(signalWindowHours)
      ]
    )
  ).rows;

  const issues: Issue[] = [];
  for (const row of rows) {
    if (row.marker_present && row.status === "open" && row.enabled_watch_plan_count === 0) {
      pushIssue(issues, {
        marketId: row.event_id ? null : row.market_id,
        eventId: row.event_id,
        severity: "blocker",
        code: "missing_enabled_watch_plan"
      });
    }
    if (row.stale_due_watch_plan_count > 0) {
      pushIssue(issues, {
        marketId: row.event_id ? null : row.market_id,
        eventId: row.event_id,
        severity: "watch",
        code: "stale_due_watch_plan",
        count: row.stale_due_watch_plan_count
      });
    }
    if (row.failed_delivery_signal_count > 0) {
      pushIssue(issues, {
        marketId: row.event_id ? null : row.market_id,
        eventId: row.event_id,
        severity: "watch",
        code: "failed_signal_delivery",
        count: row.failed_delivery_signal_count
      });
    }
    if (row.promotion_error_signal_count > 0) {
      pushIssue(issues, {
        marketId: row.event_id ? null : row.market_id,
        eventId: row.event_id,
        severity: "blocker",
        code: "promotion_error_signal",
        count: row.promotion_error_signal_count
      });
    }
  }

  return {
    objectType: "market_watch_coverage_doctor",
    generatedAt: now,
    status: issues.length > 0 ? "findings" : "clean",
    scannedCount: rows.length,
    issueCount: issues.length,
    blockerCount: issues.filter((issue) => issue.severity === "blocker").length,
    warningCount: issues.filter((issue) => issue.severity === "watch").length,
    issues,
    rows: rows.map((row) => ({
      marketId: row.market_id,
      eventId: row.event_id,
      title: row.title,
      status: row.status,
      markerPresent: row.marker_present,
      enabledWatchPlanCount: row.enabled_watch_plan_count,
      staleDueWatchPlanCount: row.stale_due_watch_plan_count,
      nextRunAt: asIso(row.next_run_at),
      lastCheckedAt: asIso(row.last_checked_at),
      failedDeliverySignalCount: row.failed_delivery_signal_count,
      promotionErrorSignalCount: row.promotion_error_signal_count
    }))
  };
}

async function run(options: Options): Promise<void> {
  const pool = createDbPool(loadAppEnv().db);

  try {
    const receipt = await runMarketWatchCoverageDoctor(pool, {
      marketIds: options.market,
      eventIds: options.event,
      staleMs: readNonNegativeNumber(options.staleMs, DEFAULT_STALE_MS, "--stale-ms"),
      signalWindowHours: readNonNegativeNumber(
        options.signalWindowHours,
        DEFAULT_SIGNAL_WINDOW_HOURS,
        "--signal-window-hours"
      )
    });

    console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
    if (receipt.issueCount > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

const program = new Command("market-watch-coverage-doctor")
  .description("Read-only coverage report for market-watch opt-in contracts.")
  .option("--market <market-id>", "Exact market id; repeatable.", repeated)
  .option("--event <event-id>", "Exact event id; repeatable.", repeated)
  .option("--stale-ms <n>", "How late a due enabled watch plan may be before warning.", String(DEFAULT_STALE_MS))
  .option("--signal-window-hours <n>", "Recent signal error window.", String(DEFAULT_SIGNAL_WINDOW_HOURS))
  .option("--json")
  .action(run);

if (require.main === module) {
  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
