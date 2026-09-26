import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";

type Options = {
  market?: string;
  limit?: string;
  json?: boolean;
};

type LifecycleQueueRow = {
  id: string;
  title: string;
  status: string;
  close_at: Date | string;
  closed_at: Date | string | null;
  expected_resolution_at: string | null;
  resolved_at: Date | string | null;
  market_contract: { timeline?: { expectedResolutionAt?: string } } | null;
  active_case_count: number | string;
  recommended_case_count: number | string;
  review_needed_case_count: number | string;
  resolution_count: number | string;
};

export type LifecycleQueueDoctorItem = {
  marketId: string;
  title: string;
  status: string;
  closeAt: string;
  closedAt: string | null;
  expectedResolutionAt: string | null;
  activeCaseCount: number;
  recommendedCaseCount: number;
  reviewNeededCaseCount: number;
  resolutionCount: number;
  severity: "ok" | "watch" | "blocker";
  reason: string;
};

export type LifecycleQueueDoctorReport = {
  objectType: "lifecycle_queue_doctor";
  generatedAt: string;
  checkedCount: number;
  blockerCount: number;
  watchCount: number;
  items: LifecycleQueueDoctorItem[];
};

export const LIFECYCLE_QUEUE_DOCTOR_SQL = `
          select
            m.id,
            m.title,
            m.status,
            m.close_at,
            m.closed_at,
            nullif(m.market_contract #>> '{timeline,expectedResolutionAt}', '') as expected_resolution_at,
            m.resolved_at,
            m.market_contract,
            count(oc.id) filter (where oc.case_status in ('recommended', 'review_needed'))::int as active_case_count,
            count(oc.id) filter (where oc.case_status = 'recommended')::int as recommended_case_count,
            count(oc.id) filter (where oc.case_status = 'review_needed')::int as review_needed_case_count,
            count(mr.id)::int as resolution_count
          from markets m
          left join oracle_cases oc on oc.market_id = m.id
          left join market_resolutions mr on mr.market_id = m.id
          where ($1::text is null or m.id = $1)
            and m.status in ('open', 'closed', 'resolved')
          group by m.id
          order by m.close_at asc, m.id asc
          limit $2
        `;

function readLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "200", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--limit must be a positive integer.");
  }
  return parsed;
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : String(value);
}

function parseDueTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function runLifecycleQueueDoctor(
  db: Queryable,
  input: { marketId?: string; limit?: number } = {}
): Promise<LifecycleQueueDoctorReport> {
  const rows = (
      await db.query<LifecycleQueueRow>(
        LIFECYCLE_QUEUE_DOCTOR_SQL,
        [input.marketId?.trim() || null, input.limit ?? 200]
      )
    ).rows;

  const nowMs = Date.now();
  const items: LifecycleQueueDoctorItem[] = rows.map((row) => {
      const expectedFromContract = row.market_contract?.timeline?.expectedResolutionAt;
      const expectedResolutionAt = row.expected_resolution_at ?? expectedFromContract ?? null;
      const expectedResolutionMs = parseDueTime(expectedResolutionAt);
      const resolutionDue = expectedResolutionMs === null || expectedResolutionMs <= nowMs;
      const hasResolution = Number(row.resolution_count) > 0 || row.resolved_at !== null;
      let reason = "healthy_or_not_due";
      let severity: "ok" | "watch" | "blocker" = "ok";

      if (row.status === "closed" && !hasResolution && resolutionDue && Number(row.active_case_count) > 0) {
        reason = Number(row.recommended_case_count) > 0 ? "recommended_case_ready" : "review_needed_case_present";
        severity = "watch";
      } else if (row.status === "closed" && !hasResolution && resolutionDue && Number(row.active_case_count) === 0) {
        reason = "missing_resolution_case_now";
        severity = "blocker";
      } else if (row.status === "resolved" && !hasResolution) {
        reason = "resolved_without_resolution_row";
        severity = "blocker";
      }

      return {
        marketId: row.id,
        title: row.title,
        status: row.status,
        closeAt: asIso(row.close_at) ?? String(row.close_at),
        closedAt: asIso(row.closed_at),
        expectedResolutionAt,
        activeCaseCount: Number(row.active_case_count),
        recommendedCaseCount: Number(row.recommended_case_count),
        reviewNeededCaseCount: Number(row.review_needed_case_count),
        resolutionCount: Number(row.resolution_count),
        severity,
        reason
      };
    });

  return {
    objectType: "lifecycle_queue_doctor",
    generatedAt: new Date().toISOString(),
    checkedCount: items.length,
    blockerCount: items.filter((item) => item.severity === "blocker").length,
    watchCount: items.filter((item) => item.severity === "watch").length,
    items
  };
}

async function run(options: Options): Promise<void> {
  const pool = createDbPool(loadAppEnv().db);
  try {
    const receipt = await runLifecycleQueueDoctor(pool, {
      marketId: options.market,
      limit: readLimit(options.limit)
    });

    console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
    if (receipt.blockerCount > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const program = new Command("lifecycle-queue-doctor")
    .description("Read-only lifecycle queue doctor with reason codes for missing/recommended cases.")
    .option("--market <market-id>")
    .option("--limit <n>", "Maximum markets to inspect.", "200")
    .option("--json")
    .action(run);

  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
