import { existsSync, readFileSync, statSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  inferRepoRoot,
  readNonNegativeNumberArg,
  readPositiveNumberArg,
  readStringArg
} from "./script-args";

type DoctorCheckName = string;

type DoctorCheck = {
  name: DoctorCheckName;
  url: string;
  ok: boolean;
  skipped?: boolean;
  status: number | null;
  elapsedMs: number;
  error: string | null;
  severity?: "watch" | "bad";
  payload?: unknown;
};

type DoctorVerdict = "ok" | "watch" | "bad";

type DoctorReport = {
  event: "platform_doctor_report";
  at: string;
  deep: boolean;
  production: boolean;
  verdict: DoctorVerdict;
  selectedMarketKey?: string | null;
  checks: DoctorCheck[];
  notes: string[];
};

type DoctorOptions = {
  backendBaseUrl: string;
  frontendBaseUrl?: string;
  frontendUrl: string;
  diagnosticsCookie?: string;
  diagnosticsBearer?: string;
  timeoutMs: number;
  frontendElapsedWatchMs?: number;
  production?: boolean;
  deep?: boolean;
  deepMarketKey?: string;
  skipFrontend?: boolean;
  request5xxWatch?: number;
  request5xxRateWatch?: number;
  dbWaitingWatch?: number;
  historyP95WatchMs?: number;
  historyP99WatchMs?: number;
  readLatencySamples?: number;
  readLatencyP95WatchMs?: number;
  lifecycleStaleMs?: number;
  lifecycleHeartbeatRequired?: boolean;
  horizonSchedulerStaleMs?: number;
  horizonSchedulerRequired?: boolean;
  missingResolutionCaseWatch?: number;
  recommendedResolutionCaseWatch?: number;
  reviewNeededResolutionCaseWatch?: number;
  backupRequired?: boolean;
  backupFreshMs?: number;
  json: boolean;
  report: boolean;
  reportPath: string;
};

type DoctorDeps = {
  fetchImpl?: typeof fetch;
};

function inferFrontendBaseUrl(frontendUrl: string): string {
  try {
    return new URL(frontendUrl).origin;
  } catch {
    return "http://127.0.0.1:6969";
  }
}

const repoRoot = inferRepoRoot("DOCTOR_REPO_ROOT");

function buildFrontendBaseChecks(options: DoctorOptions): Array<[string, string]> {
  const frontendBaseUrl = (options.frontendBaseUrl ?? inferFrontendBaseUrl(options.frontendUrl)).replace(/\/$/, "");
  const checks: Array<[string, string]> = [
    ["frontend_ready", options.frontendUrl],
    ["frontend_portfolio", `${frontendBaseUrl}/portfolio`],
    ["frontend_settings", `${frontendBaseUrl}/settings`],
    ["frontend_breaking", `${frontendBaseUrl}/breaking-markets`],
    ["frontend_topic", `${frontendBaseUrl}/topics/economy`]
  ];
  const seen = new Set<string>();

  return checks.filter(([, url]) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function buildDiagnosticsHeaders(options: DoctorOptions): HeadersInit | undefined {
  const headers: Record<string, string> = {};
  if (options.diagnosticsCookie) {
    headers.cookie = options.diagnosticsCookie;
  }
  if (options.diagnosticsBearer) {
    headers.authorization = `Bearer ${options.diagnosticsBearer}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function resolveReportPath(path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

export function parseDoctorOptions(args = process.argv.slice(2)): DoctorOptions {
  const production = args.includes("--production");
  const publicBaseUrl = readStringArg(
    args,
    "public-base-url",
    process.env.PUBLIC_BASE_URL ?? process.env.PRODUCTION_BASE_URL ?? ""
  ).replace(/\/$/, "");
  const productionFrontendFallback =
    publicBaseUrl || process.env.FRONTEND_READY_URL || "http://127.0.0.1:6969/portfolio";
  const defaultFrontendUrl = production
    ? process.env.PUBLIC_FRONTEND_URL ?? productionFrontendFallback
    : process.env.FRONTEND_READY_URL ?? "http://127.0.0.1:6969/portfolio";
  const backupFreshMsFromEnv = Number(process.env.DOCTOR_BACKUP_FRESH_MS);
  const defaultBackendBaseUrl =
    production && publicBaseUrl
      ? publicBaseUrl
      : process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001";
  const frontendUrl = readStringArg(
    args,
    "frontend-url",
    defaultFrontendUrl
  );

  return {
    backendBaseUrl: readStringArg(
      args,
      "backend-base-url",
      process.env.PUBLIC_BACKEND_BASE_URL ?? defaultBackendBaseUrl
    ).replace(/\/$/, ""),
    frontendBaseUrl: readStringArg(
      args,
      "frontend-base-url",
      process.env.FRONTEND_BASE_URL ?? inferFrontendBaseUrl(frontendUrl)
    ).replace(/\/$/, ""),
    frontendUrl,
    diagnosticsCookie: readStringArg(
      args,
      "diagnostics-cookie",
      process.env.DOCTOR_DIAGNOSTICS_COOKIE ?? ""
    ),
    diagnosticsBearer: readStringArg(
      args,
      "diagnostics-bearer",
      process.env.DOCTOR_DIAGNOSTICS_BEARER ?? process.env.DIAGNOSTICS_BEARER_TOKEN ?? ""
    ),
    timeoutMs: readPositiveNumberArg(args, "timeout-ms", 3_000),
    frontendElapsedWatchMs: readNonNegativeNumberArg(args, "frontend-elapsed-watch-ms", 0),
    production,
    deep: args.includes("--deep"),
    skipFrontend: args.includes("--skip-frontend") || args.includes("--backend-only"),
    deepMarketKey: readStringArg(args, "market-key", process.env.DOCTOR_MARKET_KEY ?? ""),
    request5xxWatch: readNonNegativeNumberArg(args, "request-5xx-watch", 1),
    request5xxRateWatch: readNonNegativeNumberArg(args, "request-5xx-rate-watch", 0.01),
    dbWaitingWatch: readNonNegativeNumberArg(args, "db-waiting-watch", 1),
    historyP95WatchMs: readNonNegativeNumberArg(args, "history-p95-watch-ms", 1_000),
    historyP99WatchMs: readNonNegativeNumberArg(args, "history-p99-watch-ms", 2_000),
    readLatencySamples: readNonNegativeNumberArg(args, "read-latency-samples", 3),
    readLatencyP95WatchMs: readNonNegativeNumberArg(args, "read-latency-p95-watch-ms", 1_000),
    lifecycleStaleMs: readNonNegativeNumberArg(args, "lifecycle-stale-ms", 15 * 60_000),
    lifecycleHeartbeatRequired: args.includes("--require-lifecycle-heartbeat") || production,
    horizonSchedulerStaleMs: readNonNegativeNumberArg(args, "horizon-scheduler-stale-ms", 2 * 60_000),
    horizonSchedulerRequired: args.includes("--require-horizon-scheduler") || production,
    missingResolutionCaseWatch: readNonNegativeNumberArg(args, "missing-resolution-case-watch", 1),
    recommendedResolutionCaseWatch: readNonNegativeNumberArg(args, "recommended-resolution-case-watch", 1),
    reviewNeededResolutionCaseWatch: readNonNegativeNumberArg(args, "review-needed-resolution-case-watch", 1),
    backupRequired: !args.includes("--allow-missing-backup"),
    backupFreshMs: readNonNegativeNumberArg(
      args,
      "backup-fresh-ms",
      Number.isFinite(backupFreshMsFromEnv) && backupFreshMsFromEnv > 0
        ? backupFreshMsFromEnv
        : 25 * 60 * 60_000
    ),
    json: args.includes("--json"),
    report: args.includes("--report"),
    reportPath: resolveReportPath(
      readStringArg(
        args,
        "report-path",
        process.env.DOCTOR_REPORT_PATH ?? `workspace/runtime/doctor/platform-${Date.now().toString(36)}.jsonl`
      )
    )
  };
}

function percentile(values: number[], percentileRank: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1)
  );

  return sorted[index] ?? null;
}

function summarizeLatencySamples(samples: DoctorCheck[]): {
  attempts: number;
  ok: number;
  failed: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
} {
  const elapsed = samples
    .filter((sample) => sample.ok)
    .map((sample) => sample.elapsedMs);

  return {
    attempts: samples.length,
    ok: elapsed.length,
    failed: samples.length - elapsed.length,
    p50Ms: percentile(elapsed, 50),
    p95Ms: percentile(elapsed, 95),
    maxMs: elapsed.length ? Math.max(...elapsed) : null
  };
}

async function runReadLatencySummary(
  options: DoctorOptions,
  selectedMarketKey: string,
  fetchImpl: typeof fetch
): Promise<DoctorCheck> {
  const sampleCount = Math.max(1, options.readLatencySamples ?? 3);
  const encodedMarketKey = encodeURIComponent(selectedMarketKey);
  const endpoints = [
    {
      key: "market_detail",
      url: `${options.backendBaseUrl}/api/market-detail/markets/${encodedMarketKey}`
    },
    {
      key: "market_history_1d",
      url: `${options.backendBaseUrl}/api/markets/${encodedMarketKey}/history?range=1D&limit=250`
    },
    {
      key: "portfolio_snapshot",
      url: `${options.backendBaseUrl}/api/portfolio/snapshot`
    },
    {
      key: "portfolio_performance_day",
      url: `${options.backendBaseUrl}/api/portfolio/performance?timeframe=day`
    }
  ];
  const payload: Record<string, ReturnType<typeof summarizeLatencySamples>> = {};

  for (const endpoint of endpoints) {
    const samples: DoctorCheck[] = [];

    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(await fetchCheck(
        `latency_${endpoint.key}_${index + 1}`,
        endpoint.url,
        options.timeoutMs,
        fetchImpl
      ));
    }

    payload[endpoint.key] = summarizeLatencySamples(samples);
  }

  const slowEndpoints = Object.entries(payload)
    .filter(([, summary]) => {
      return (
        summary.failed > 0 ||
        (summary.p95Ms !== null && summary.p95Ms >= (options.readLatencyP95WatchMs ?? 1_000))
      );
    })
    .map(([key]) => key);

  return {
    name: "api_read_latency_summary",
    url: `${options.backendBaseUrl}/api/*`,
    ok: slowEndpoints.length === 0,
    status: slowEndpoints.length === 0 ? 200 : null,
    elapsedMs: Math.max(
      0,
      ...Object.values(payload)
        .map((summary) => summary.maxMs)
        .filter((value): value is number => value !== null)
    ),
    error: slowEndpoints.length ? `slow_or_failed:${slowEndpoints.join(",")}` : null,
    severity: "watch",
    payload
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readNestedRecord(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  return record ? asRecord(record[key]) : null;
}

function readNestedNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNestedString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function readNestedBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function resolveRepoPath(path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function readReceiptMaxAgeHours(): number {
  const raw = process.env.MIGRATION_RECOVERY_RECEIPT_MAX_AGE_HOURS?.trim();
  if (!raw) return 720;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 720;
}

function isPassReceipt(path: string, maxAgeHours: number): boolean {
  const receiptPath = resolveRepoPath(path);
  if (!existsSync(receiptPath)) return false;

  const contents = readFileSync(receiptPath, "utf8");
  if (!/Status:\s*PASS/i.test(contents) && !/restore_drill=pass/i.test(contents)) {
    return false;
  }

  const ageHours = (Date.now() - statSync(receiptPath).mtimeMs) / 3_600_000;
  return ageHours <= maxAgeHours;
}

function hasManagedProviderRecoveryProof(): boolean {
  if (process.env.PITR_MODE !== "managed-provider") {
    return false;
  }

  const restorePath = process.env.RESTORE_DRILL_RECEIPT_PATH?.trim();
  const pitrPath = process.env.PITR_DRILL_RECEIPT_PATH?.trim();
  if (!restorePath || !pitrPath) {
    return false;
  }

  const maxAgeHours = readReceiptMaxAgeHours();
  return isPassReceipt(restorePath, maxAgeHours) && isPassReceipt(pitrPath, maxAgeHours);
}

async function fetchCheck(
  name: DoctorCheckName,
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  headers?: HeadersInit
): Promise<DoctorCheck> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      ...(headers ? { headers } : {}),
      signal: controller.signal
    });
    const text = await response.text();
    let payload: unknown = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text.slice(0, 200);
    }

    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: null,
      payload
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      status: null,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readDiagnosticsVerdict(check: DoctorCheck): DoctorVerdict | null {
  if (!check.payload || typeof check.payload !== "object" || !("health" in check.payload)) {
    return null;
  }

  const health = (check.payload as { health?: unknown }).health;
  if (!health || typeof health !== "object" || !("verdict" in health)) {
    return null;
  }

  const verdict = (health as { verdict?: unknown }).verdict;
  return verdict === "ok" || verdict === "watch" || verdict === "bad" ? verdict : null;
}

function isLocalDiagnosticsAuthRequired(check: DoctorCheck | undefined, options: DoctorOptions): boolean {
  return Boolean(
    check &&
    check.name === "backend_diagnostics" &&
    !options.production &&
    !options.diagnosticsCookie &&
    !options.diagnosticsBearer &&
    (check.status === 401 || check.status === 403)
  );
}

function normalizeDiagnosticsAuthCheck(check: DoctorCheck, options: DoctorOptions): DoctorCheck {
  if (!isLocalDiagnosticsAuthRequired(check, options)) {
    return check;
  }

  return {
    ...check,
    ok: true,
    skipped: true,
    error: "diagnostics_auth_required",
    payload: {
      status: "skipped",
      reason: "diagnostics_auth_required"
    }
  };
}

function markSlowFrontendCheck(check: DoctorCheck, options: DoctorOptions): DoctorCheck {
  const thresholdMs = options.frontendElapsedWatchMs ?? 0;
  if (
    thresholdMs > 0 &&
    check.ok &&
    check.name.startsWith("frontend_") &&
    check.elapsedMs >= thresholdMs
  ) {
    return {
      ...check,
      severity: "watch",
      error: `slow_ms:${check.elapsedMs}`
    };
  }

  return check;
}

function assessDiagnostics(
  check: DoctorCheck | undefined,
  options: DoctorOptions
): {
  hardFailure: boolean;
  watch: boolean;
  notes: string[];
} {
  if (!check) {
    return { hardFailure: true, watch: false, notes: ["backend_diagnostics_missing"] };
  }

  if (check.skipped && check.name === "backend_diagnostics") {
    return { hardFailure: false, watch: false, notes: ["backend_diagnostics_auth_required"] };
  }

  if (!check.ok) {
    return { hardFailure: true, watch: false, notes: [] };
  }

  const payload = asRecord(check.payload);
  const diagnosticsVerdict = readDiagnosticsVerdict(check);
  const notes: string[] = [];
  let hardFailure = false;
  let watch = false;

  if (!payload || !diagnosticsVerdict) {
    return { hardFailure: true, watch: false, notes: ["backend_diagnostics_contract_missing"] };
  }

  if (diagnosticsVerdict === "bad") {
    hardFailure = true;
    notes.push("backend_diagnostics_bad");
  } else if (diagnosticsVerdict === "watch") {
    watch = true;
    notes.push("backend_diagnostics_watch");
  }

  const database = readNestedRecord(payload, "database");
  const pool = readNestedRecord(database, "pool");
  const waitingCount = readNestedNumber(pool, "waitingCount");
  if (waitingCount !== null && waitingCount >= (options.dbWaitingWatch ?? 1)) {
    watch = true;
    notes.push(`db_pool_waiting:${waitingCount}`);
  }

  const requests = readNestedRecord(payload, "requests");
  const windows = readNestedRecord(requests, "windows");
  const fiveMinutes = readNestedRecord(windows, "fiveMinutes");
  const error5xxCount = readNestedNumber(fiveMinutes, "error5xxCount");
  if (error5xxCount !== null && error5xxCount >= (options.request5xxWatch ?? 1)) {
    watch = true;
    notes.push(`request_5xx_count:${error5xxCount}`);
  }

  const errorRate5xx = readNestedNumber(fiveMinutes, "errorRate5xx");
  if (errorRate5xx !== null && errorRate5xx >= (options.request5xxRateWatch ?? 0.01)) {
    watch = true;
    notes.push(`request_5xx_rate:${errorRate5xx}`);
  }

  const history = readNestedRecord(fiveMinutes, "history");
  const historyCount = readNestedNumber(history, "count") ?? 0;
  const historyP95 = readNestedNumber(history, "p95Ms");
  const historyP99 = readNestedNumber(history, "p99Ms");
  if (historyCount > 0 && historyP95 !== null && historyP95 >= (options.historyP95WatchMs ?? 1_000)) {
    watch = true;
    notes.push(`history_p95_ms:${historyP95}`);
  }
  if (historyCount > 0 && historyP99 !== null && historyP99 >= (options.historyP99WatchMs ?? 2_000)) {
    watch = true;
    notes.push(`history_p99_ms:${historyP99}`);
  }

  const runtime = readNestedRecord(payload, "runtime");
  const identity = readNestedRecord(runtime, "identity");
  const commitSha = readNestedString(identity, "commitSha");
  const buildTimestamp = readNestedString(identity, "buildTimestamp");
  const releaseId = readNestedString(identity, "releaseId");
  if (options.production) {
    if (!identity) {
      hardFailure = true;
      notes.push("runtime_identity_missing");
    } else {
      if (!commitSha) {
        hardFailure = true;
        notes.push("runtime_commit_sha_missing");
      }
      if (!buildTimestamp) {
        hardFailure = true;
        notes.push("runtime_build_timestamp_missing");
      }
      if (!releaseId) {
        hardFailure = true;
        notes.push("runtime_release_id_missing");
      }
    }
  }

  const migration = readNestedRecord(runtime, "migration");
  const migrationStatus = readNestedString(migration, "status");
  const migrationLatest = readNestedString(migration, "latest");
  const migrationCount = readNestedNumber(migration, "count");
  if (options.production) {
    if (!migration || migrationStatus !== "ok") {
      hardFailure = true;
      notes.push("runtime_migration_unavailable");
    } else {
      if (!migrationLatest) {
        hardFailure = true;
        notes.push("runtime_migration_latest_missing");
      }
      if (migrationCount === null) {
        hardFailure = true;
        notes.push("runtime_migration_count_missing");
      }
    }
  }

  const backup = readNestedRecord(runtime, "backup");
  const backupStatus = readNestedString(backup, "status");
  const backupAgeMs = readNestedNumber(backup, "ageMs");
  if (options.production) {
    if (!backup || backupStatus === "missing" || backupStatus === "unavailable" || !backupStatus) {
      const note = `runtime_backup_${backupStatus ?? "missing"}`;
      if (hasManagedProviderRecoveryProof()) {
        notes.push(`${note}_provider_managed_receipts_ok`);
      } else if (options.backupRequired === false) {
        notes.push(`${note}_allowed`);
      } else {
        hardFailure = true;
        notes.push(note);
      }
    } else if (backupStatus === "watch") {
      watch = true;
      notes.push("runtime_backup_watch");
    }

    if (backupAgeMs !== null && backupAgeMs >= (options.backupFreshMs ?? 25 * 60 * 60_000)) {
      watch = true;
      notes.push(`runtime_backup_age_ms:${backupAgeMs}`);
    }
  }

  const economy = readNestedRecord(runtime, "economy");
  const economyStatus = readNestedString(economy, "status");
  const platformTreasury = readNestedRecord(economy, "platformTreasury");
  const platformTreasuryVerdict = readNestedString(platformTreasury, "verdict");
  const platformTreasuryBalanceRaw = readNestedString(platformTreasury, "balance");
  const platformTreasuryBalance = platformTreasuryBalanceRaw === null
    ? null
    : Number(platformTreasuryBalanceRaw);
  const faucetTables = readNestedRecord(economy, "faucetTables");
  const hasUserFaucetState = readNestedBoolean(faucetTables, "userFaucetState");
  const hasFaucetClaims = readNestedBoolean(faucetTables, "faucetClaims");
  const economyFlow = readNestedRecord(economy, "flow");
  const economyFlowStatus = readNestedString(economyFlow, "status");
  const faucetOutflow24h = readNestedString(economyFlow, "faucetOutflow24h");

  if (!economy) {
    // Older backends do not expose economy diagnostics. Keep compatibility:
    // explicit unavailable/bad values warn; absence alone does not.
  } else if (economyStatus === "unavailable") {
    watch = true;
    notes.push("economy_diagnostics_unavailable");
  } else if (platformTreasuryVerdict === "bad") {
    hardFailure = true;
    notes.push(`economy_platform_treasury_negative:${platformTreasuryBalanceRaw ?? "unknown"}`);
  } else if (platformTreasuryVerdict === "missing") {
    hardFailure = true;
    notes.push("economy_platform_treasury_missing");
  } else if (platformTreasuryVerdict === "watch") {
    watch = true;
    notes.push(`economy_platform_treasury_low:${platformTreasuryBalanceRaw ?? "unknown"}`);
  }

  if (platformTreasuryBalance !== null && Number.isFinite(platformTreasuryBalance) && platformTreasuryBalance < 0) {
    hardFailure = true;
    notes.push(`economy_platform_treasury_negative:${platformTreasuryBalanceRaw}`);
  }

  if (hasUserFaucetState === false || hasFaucetClaims === false) {
    watch = true;
    notes.push("economy_faucet_tables_missing");
  }

  if (economyFlowStatus === "unavailable") {
    watch = true;
    notes.push("economy_flow_unavailable");
  } else if (economyFlowStatus === "watch") {
    watch = true;
    notes.push(`economy_flow_watch:${faucetOutflow24h ?? "unknown"}`);
  }

  const latestHeartbeat = readNestedRecord(runtime, "latestLifecycleHeartbeat");
  const heartbeatGeneratedAt = readNestedString(latestHeartbeat, "generatedAt");
  if ((options.lifecycleHeartbeatRequired || options.production) && !latestHeartbeat) {
    if (options.production) {
      hardFailure = true;
    } else {
      watch = true;
    }
    notes.push("lifecycle_heartbeat_missing");
  }

  if (heartbeatGeneratedAt) {
    const generatedAtMs = Date.parse(heartbeatGeneratedAt);
    const staleMs = Date.now() - generatedAtMs;
    if (Number.isFinite(staleMs) && staleMs >= (options.lifecycleStaleMs ?? 15 * 60_000)) {
      if (options.production) {
        hardFailure = true;
      } else {
        watch = true;
      }
      notes.push(`lifecycle_heartbeat_stale_ms:${staleMs}`);
    }
  } else if (options.production && latestHeartbeat) {
    hardFailure = true;
    notes.push("lifecycle_heartbeat_generated_at_missing");
  }

  const heartbeatSummary = readNestedRecord(latestHeartbeat, "summary");
  const lifecycleStatus = readNestedString(heartbeatSummary, "status");
  if (lifecycleStatus === "blocked") {
    watch = true;
    notes.push("lifecycle_blocked");
  }

  const missingResolutionCaseCount = readNestedNumber(heartbeatSummary, "missingResolutionCaseCount");
  if (
    missingResolutionCaseCount !== null &&
    missingResolutionCaseCount >= (options.missingResolutionCaseWatch ?? 1)
  ) {
    watch = true;
    notes.push(`missing_resolution_cases:${missingResolutionCaseCount}`);
  }

  const recommendedResolutionCaseCount = readNestedNumber(heartbeatSummary, "recommendedResolutionCaseCount");
  if (
    recommendedResolutionCaseCount !== null &&
    recommendedResolutionCaseCount >= (options.recommendedResolutionCaseWatch ?? 1)
  ) {
    watch = true;
    notes.push(`recommended_resolution_cases:${recommendedResolutionCaseCount}`);
  }

  const reviewNeededResolutionCaseCount = readNestedNumber(heartbeatSummary, "reviewNeededResolutionCaseCount");
  if (
    reviewNeededResolutionCaseCount !== null &&
    reviewNeededResolutionCaseCount >= (options.reviewNeededResolutionCaseWatch ?? 1)
  ) {
    watch = true;
    notes.push(`review_needed_resolution_cases:${reviewNeededResolutionCaseCount}`);
  }

  const latestHorizonScheduler = readNestedRecord(runtime, "latestHorizonScheduler");
  const horizonSchedulerGeneratedAt = readNestedString(latestHorizonScheduler, "generatedAt");
  if ((options.horizonSchedulerRequired || options.production) && !latestHorizonScheduler) {
    if (options.production) {
      hardFailure = true;
    } else {
      watch = true;
    }
    notes.push("horizon_scheduler_missing");
  }

  if (horizonSchedulerGeneratedAt) {
    const generatedAtMs = Date.parse(horizonSchedulerGeneratedAt);
    const staleMs = Date.now() - generatedAtMs;
    if (Number.isFinite(staleMs) && staleMs >= (options.horizonSchedulerStaleMs ?? 2 * 60_000)) {
      if (options.production) {
        hardFailure = true;
      } else {
        watch = true;
      }
      notes.push(`horizon_scheduler_stale_ms:${staleMs}`);
    }
  } else if (options.production && latestHorizonScheduler) {
    hardFailure = true;
    notes.push("horizon_scheduler_generated_at_missing");
  }

  const horizonSchedulerSummary = readNestedRecord(latestHorizonScheduler, "summary");
  const horizonSchedulerStatus = readNestedString(horizonSchedulerSummary, "status");
  const horizonOverdueAfter = readNestedNumber(horizonSchedulerSummary, "overdueOpenMarketCountAfter");
  const horizonAlertCount = readNestedNumber(horizonSchedulerSummary, "alertCount");
  const clockSkewMs = readNestedNumber(horizonSchedulerSummary, "appDbClockSkewMs");
  const clockSkewWarnMs = readNestedNumber(horizonSchedulerSummary, "clockSkewWarnMs");

  if (horizonSchedulerStatus === "bad") {
    hardFailure = true;
    notes.push("horizon_scheduler_bad");
  } else if (horizonSchedulerStatus === "watch") {
    if (options.production) {
      hardFailure = true;
    } else {
      watch = true;
    }
    notes.push("horizon_scheduler_watch");
  }

  if (horizonOverdueAfter !== null && horizonOverdueAfter > 0) {
    if (options.production) {
      hardFailure = true;
    } else {
      watch = true;
    }
    notes.push(`horizon_scheduler_overdue_open_markets:${horizonOverdueAfter}`);
  }

  if (horizonAlertCount !== null && horizonAlertCount > 0) {
    if (options.production) {
      hardFailure = true;
    } else {
      watch = true;
    }
    notes.push(`horizon_scheduler_alerts:${horizonAlertCount}`);
  }

  if (
    clockSkewMs !== null &&
    clockSkewWarnMs !== null &&
    Math.abs(clockSkewMs) >= clockSkewWarnMs
  ) {
    if (options.production) {
      hardFailure = true;
    } else {
      watch = true;
    }
    notes.push(`horizon_scheduler_clock_skew_ms:${clockSkewMs}`);
  }

  return { hardFailure, watch, notes };
}

function buildVerdict(checks: DoctorCheck[], options: DoctorOptions): {
  verdict: DoctorVerdict;
  notes: string[];
} {
  const notes: string[] = [];
  let hardFailure = false;
  let watch = false;

  for (const check of checks) {
    if (check.skipped) {
      continue;
    }

    if (check.ok && check.severity === "watch" && check.error) {
      notes.push(`${check.name}_${check.error}`);
      watch = true;
      continue;
    }

    if (!check.ok) {
      notes.push(`${check.name}_failed`);
      if (check.severity === "watch") {
        watch = true;
      } else {
        hardFailure = true;
      }
    }
  }

  const diagnostics = checks.find((check) => check.name === "backend_diagnostics");
  const diagnosticsAssessment = assessDiagnostics(diagnostics, options);
  hardFailure = hardFailure || diagnosticsAssessment.hardFailure;
  watch = watch || diagnosticsAssessment.watch;
  notes.push(...diagnosticsAssessment.notes);

  if (hardFailure) {
    return { verdict: "bad", notes };
  }

  if (watch) {
    return { verdict: "watch", notes };
  }

  return {
    verdict: "ok",
    notes: notes.length ? notes : ["all_checks_ok"]
  };
}

function selectMarketKey(openMarketsCheck: DoctorCheck, options: DoctorOptions): string | null {
  if (options.deepMarketKey) {
    return options.deepMarketKey;
  }

  const payload = asRecord(openMarketsCheck.payload);
  const markets = payload?.markets;
  if (!Array.isArray(markets)) {
    return null;
  }

  for (const market of markets) {
    const record = asRecord(market);
    const marketKey = readNestedString(record, "marketKey") ?? readNestedString(record, "marketId");
    if (marketKey) {
      return marketKey;
    }
  }

  return null;
}

async function runDeepChecks(
  options: DoctorOptions,
  fetchImpl: typeof fetch
): Promise<{
  checks: DoctorCheck[];
  selectedMarketKey: string | null;
}> {
  const frontendBaseUrl = (options.frontendBaseUrl ?? inferFrontendBaseUrl(options.frontendUrl)).replace(/\/$/, "");
  const openMarketsCheck = await fetchCheck(
    "api_open_markets",
    `${options.backendBaseUrl}/api/markets?status=open&limit=10`,
    options.timeoutMs,
    fetchImpl
  );
  const checks: DoctorCheck[] = [
    await fetchCheck("api_live_count", `${options.backendBaseUrl}/api/markets/live-count`, options.timeoutMs, fetchImpl),
    openMarketsCheck
  ];

  if (!options.skipFrontend) {
    checks.push(
      await fetchCheck(
        "frontend_portfolio",
        `${frontendBaseUrl}/portfolio`,
        options.timeoutMs,
        fetchImpl
      )
    );
  }
  const selectedMarketKey = selectMarketKey(openMarketsCheck, options);

  if (!selectedMarketKey) {
    checks.push({
      name: "deep_market_candidate",
      url: `${options.backendBaseUrl}/api/markets?status=open&limit=10`,
      ok: false,
      status: null,
      elapsedMs: 0,
      error: "no_open_market_candidate",
      severity: "watch"
    });
    return { checks, selectedMarketKey: null };
  }

  const encodedMarketKey = encodeURIComponent(selectedMarketKey);
  checks.push(
    await fetchCheck("api_market", `${options.backendBaseUrl}/api/markets/${encodedMarketKey}`, options.timeoutMs, fetchImpl),
    await fetchCheck(
      "api_market_history",
      `${options.backendBaseUrl}/api/markets/${encodedMarketKey}/history?range=1H&limit=250`,
      options.timeoutMs,
      fetchImpl
    ),
    await fetchCheck(
      "api_market_detail",
      `${options.backendBaseUrl}/api/market-detail/markets/${encodedMarketKey}`,
      options.timeoutMs,
      fetchImpl
    ),
    await fetchCheck(
      "api_market_stream_once",
      `${options.backendBaseUrl}/api/markets/${encodedMarketKey}/stream?once=1`,
      options.timeoutMs,
      fetchImpl
    )
  );
  checks.push(await runReadLatencySummary(options, selectedMarketKey, fetchImpl));

  if (!options.skipFrontend) {
    checks.push(
      await fetchCheck(
        "frontend_market_detail",
        `${frontendBaseUrl}/markets/${encodedMarketKey}`,
        options.timeoutMs,
        fetchImpl
      )
    );
  }

  return { checks, selectedMarketKey };
}

export async function runPlatformDoctor(
  options: DoctorOptions,
  deps: DoctorDeps = {}
): Promise<DoctorReport> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseCheckPromises = [
    fetchCheck("backend_live", `${options.backendBaseUrl}/health/live`, options.timeoutMs, fetchImpl),
    fetchCheck("backend_ready", `${options.backendBaseUrl}/health/ready`, options.timeoutMs, fetchImpl),
    fetchCheck(
      "backend_diagnostics",
      `${options.backendBaseUrl}/health/diagnostics`,
      options.timeoutMs,
      fetchImpl,
      buildDiagnosticsHeaders(options)
    )
  ];

  if (!options.skipFrontend) {
    for (const [name, url] of buildFrontendBaseChecks(options)) {
      baseCheckPromises.push(fetchCheck(name, url, options.timeoutMs, fetchImpl));
    }
  }

  const checks: DoctorCheck[] = (await Promise.all(baseCheckPromises))
    .map((check) => normalizeDiagnosticsAuthCheck(check, options))
    .map((check) => markSlowFrontendCheck(check, options));
  let selectedMarketKey: string | null = null;

  if (options.deep) {
    const deepResult = await runDeepChecks(options, fetchImpl);
    checks.push(...deepResult.checks.map((check) => markSlowFrontendCheck(check, options)));
    selectedMarketKey = deepResult.selectedMarketKey;
  }

  const { verdict, notes } = buildVerdict(checks, options);

  return {
    event: "platform_doctor_report",
    at: new Date().toISOString(),
    deep: options.deep === true,
    production: options.production === true,
    verdict,
    selectedMarketKey,
    checks,
    notes
  };
}

function readCompactDiagnostics(checks: DoctorCheck[]) {
  const diagnostics = checks.find((check) => check.name === "backend_diagnostics");
  if (diagnostics?.skipped) {
    return {
      health: null,
      memory: null,
      database: null,
      requests5m: null,
      streams: null,
      runtime: null,
      skipped: true,
      reason: diagnostics.error
    };
  }

  const payload = diagnostics?.payload as {
    health?: { verdict?: unknown; warnings?: unknown };
    memory?: { rssMiB?: unknown; heapUsedMiB?: unknown };
    database?: { pool?: unknown };
    requests?: {
      windows?: {
        fiveMinutes?: {
          requestCount?: unknown;
          error5xxCount?: unknown;
          history?: { p95Ms?: unknown; maxMs?: unknown; count?: unknown };
        };
      };
    };
    streams?: unknown;
    runtime?: {
      identity?: unknown;
      migration?: unknown;
      backup?: unknown;
      latestHorizonScheduler?: unknown;
      latestLifecycleHeartbeat?: unknown;
    };
  } | undefined;

  return {
    health: payload?.health ?? null,
    memory: payload?.memory
      ? {
          rssMiB: payload.memory.rssMiB ?? null,
          heapUsedMiB: payload.memory.heapUsedMiB ?? null
        }
      : null,
    database: payload?.database ?? null,
    requests5m: payload?.requests?.windows?.fiveMinutes ?? null,
    streams: payload?.streams ?? null,
    runtime: payload?.runtime
      ? {
          identity: payload.runtime.identity ?? null,
          migration: payload.runtime.migration ?? null,
          backup: payload.runtime.backup ?? null,
          latestHorizonScheduler: payload.runtime.latestHorizonScheduler ?? null,
          latestLifecycleHeartbeat: payload.runtime.latestLifecycleHeartbeat ?? null
        }
      : null
  };
}

function formatCompactReport(report: DoctorReport): string {
  const diagnostics = readCompactDiagnostics(report.checks);
  const lines = [
    `platform_doctor verdict=${report.verdict} deep=${report.deep ? "yes" : "no"} at=${report.at}`,
    `production=${report.production ? "yes" : "no"}`,
    ...(report.selectedMarketKey ? [`selectedMarketKey=${report.selectedMarketKey}`] : []),
    `notes=${report.notes.join(",")}`,
    "checks:"
  ];

  for (const check of report.checks) {
    const state = check.skipped ? "skip" : check.ok ? "ok" : "fail";
    lines.push(
      `- ${check.name}: ${state} status=${check.status ?? "none"} elapsed=${check.elapsedMs}ms`
    );
  }

  lines.push(`diagnostics=${JSON.stringify(diagnostics)}`);
  return lines.join("\n");
}

async function appendReport(path: string, report: DoctorReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(report)}\n`);
}

async function run(): Promise<void> {
  const options = parseDoctorOptions();
  const report = await runPlatformDoctor(options);

  if (options.report) {
    await appendReport(options.reportPath, report);
  }

  console.log(options.json ? JSON.stringify(report, null, 2) : formatCompactReport(report));

  if (report.verdict === "bad") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
