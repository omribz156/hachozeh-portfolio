import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool, type Queryable } from "../db/client/pool";

type Options = {
  market?: string[];
  status?: string;
  limit?: string;
  json?: boolean;
};

type Row = {
  id: string;
  title: string;
  status: string;
  event_id: string | null;
  close_at: Date;
  market_contract: unknown;
  oracle_source_policy: unknown;
  market_contract_text: string;
  oracle_source_policy_text: string;
  enabled_watch_plan_count: number;
  active_oracle_case_count: number;
  resolution_count: number;
  unresolved_cascade_failure_count: number;
};

export type MarketIntegrityIssue = {
  marketId: string;
  severity: "watch" | "blocker";
  code: string;
  detail: string;
};

export type MarketIntegrityScanReport = {
  objectType: "market_integrity_scan";
  generatedAt: string;
  scannedCount: number;
  issueCount: number;
  blockerCount: number;
  watchCount: number;
  issues: MarketIntegrityIssue[];
};

function repeated(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function readLimit(value: string | undefined): number {
  if (!value) return 500;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--limit must be a positive integer.");
  }
  return parsed;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function collectStrings(value: unknown, path = "value", output: Array<{ path: string; value: string }> = []): Array<{ path: string; value: string }> {
  if (typeof value === "string") {
    output.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, `${path}[${index}]`, output));
  } else if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => collectStrings(entry, `${path}.${key}`, output));
  }
  return output;
}

function closeDatePath(row: Row): string {
  return row.close_at.toISOString().slice(0, 10).replaceAll("-", "/");
}

function inspectRow(row: Row): MarketIntegrityIssue[] {
  const issues: MarketIntegrityIssue[] = [];
  const contract = readObject(row.market_contract);
  const source = readObject(contract.resolutionSource);
  const sourceIds = readStringArray(source.sourceIds);
  const combined = `${row.market_contract_text}\n${row.oracle_source_policy_text}`;

  if (contract.objectType !== "market_contract_v1") {
    issues.push({ marketId: row.id, severity: "blocker", code: "missing_market_contract_v1", detail: "market_contract.objectType is missing or not market_contract_v1" });
  }
  if (sourceIds.length === 0) {
    issues.push({ marketId: row.id, severity: "blocker", code: "missing_source_ids", detail: "market_contract.resolutionSource.sourceIds is empty" });
  }

  if (sourceIds.includes("src_ims_daily_observations")) {
    const expected = closeDatePath(row);
    for (const endpoint of collectStrings(row.market_contract, "market_contract").concat(collectStrings(row.oracle_source_policy, "oracle_source_policy"))) {
      if (endpoint.value.includes("api.ims.gov.il") && /\/data\/daily\/\d{4}\/\d{2}\/\d{2}/.test(endpoint.value) && !endpoint.value.includes(`/data/daily/${expected}`)) {
        issues.push({ marketId: row.id, severity: "blocker", code: "ims_endpoint_date_mismatch", detail: `${endpoint.path}: expected ${expected}` });
      }
    }
  }

  if (
    row.status === "open" &&
    combined.includes("market-watch-pings-only-no-mutation") &&
    row.enabled_watch_plan_count === 0
  ) {
    issues.push({ marketId: row.id, severity: "blocker", code: "missing_market_watch_plan", detail: "contract declares market-watch pings but no enabled plan is attached to the market/event" });
  }

  if (row.status === "closed" && row.resolution_count === 0 && row.active_oracle_case_count === 0) {
    issues.push({ marketId: row.id, severity: "watch", code: "closed_without_resolution_or_case", detail: "closed market has no resolution and no active Oracle case" });
  }

  if (row.unresolved_cascade_failure_count > 0) {
    issues.push({
      marketId: row.id,
      severity: "blocker",
      code: "unresolved_resolution_cascade_failure",
      detail: "A resolution cascade failed and no later successful cascade receipt cleared it."
    });
  }

  return issues;
}

export async function runMarketIntegrityScan(
  db: Queryable,
  input: { marketIds?: string[]; status?: string; limit?: number } = {}
): Promise<MarketIntegrityScanReport> {
  const marketIds = [...new Set((input.marketIds ?? []).map((market) => market.trim()).filter(Boolean))];
  const result = await db.query<Row>(
      `
        select
          m.id,
          m.title,
          m.status,
          m.event_id,
          m.close_at,
          m.market_contract,
          m.oracle_source_policy,
          m.market_contract::text as market_contract_text,
          m.oracle_source_policy::text as oracle_source_policy_text,
          (
            select count(*)::int
            from market_watch_plans mwp
            where mwp.enabled = true
              and (mwp.market_id = m.id or (m.event_id is not null and mwp.event_id = m.event_id))
          ) as enabled_watch_plan_count,
          (
            select count(*)::int
            from oracle_cases oc
            where oc.market_id = m.id
              and oc.case_status in ('recommended', 'review_needed')
          ) as active_oracle_case_count,
          (
            select count(*)::int
            from market_resolutions mr
            where mr.market_id = m.id
          ) as resolution_count,
          (
            select count(*)::int
            from lifecycle_events failed
            where failed.market_id = m.id
              and failed.event_type = 'resolution_cascade_failed'
              and not exists (
                select 1
                from lifecycle_events completed
                where completed.market_id = failed.market_id
                  and completed.event_type = 'resolution_cascade_completed'
                  and completed.occurred_at > failed.occurred_at
              )
          ) as unresolved_cascade_failure_count
        from markets m
        where ($1::text[] is null or m.id = any($1::text[]))
          and ($2::text is null or m.status = $2)
        order by m.close_at asc, m.id asc
        limit $3
      `,
      [marketIds.length > 0 ? marketIds : null, input.status?.trim() || null, input.limit ?? 500]
    );

  const issues = result.rows.flatMap(inspectRow);
  return {
    objectType: "market_integrity_scan",
    generatedAt: new Date().toISOString(),
    scannedCount: result.rows.length,
    issueCount: issues.length,
    blockerCount: issues.filter((issue) => issue.severity === "blocker").length,
    watchCount: issues.filter((issue) => issue.severity === "watch").length,
    issues
  };
}

async function run(options: Options): Promise<void> {
  const pool = createDbPool(loadAppEnv().db);

  try {
    const receipt = await runMarketIntegrityScan(pool, {
      marketIds: options.market,
      status: options.status,
      limit: readLimit(options.limit)
    });
    console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
    if (receipt.blockerCount > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

const program = new Command("market-integrity-scan")
  .description("Read-only scan for market contract/source/lifecycle integrity drift.")
  .option("--market <market-id>", "Exact market id; repeatable.", repeated)
  .option("--status <status>", "Optional market status filter. Default scans all statuses.")
  .option("--limit <n>", "Maximum markets to scan.", "500")
  .option("--json")
  .action(run);

if (require.main === module) {
  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
