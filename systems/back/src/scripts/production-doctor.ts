import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import type { Queryable } from "../db/client/pool";
import {
  auditAvatarStorageIntegrity,
  type AvatarStorageIntegrityReport
} from "../auth/avatar-storage-integrity";
import type { StoredAvatar } from "../auth/avatar-storage";
import {
  runProductionIntegrityChecks,
  type ProductionIntegrityReport
} from "../ops/production-integrity-checks";
import {
  auditActiveEvents,
  type ActiveEventLifecycleAuditReport
} from "./event-dependency-doctor";
import {
  runMarketWatchCoverageDoctor,
  type MarketWatchCoverageDoctorReport
} from "./market-watch-coverage-doctor";
import {
  runMarketIntegrityScan,
  type MarketIntegrityScanReport
} from "./market-integrity-scan";
import {
  runLifecycleQueueDoctor,
  type LifecycleQueueDoctorReport
} from "./lifecycle-queue-doctor";
import {
  runNotificationIntegrityScan,
  type NotificationIntegrityScanReport
} from "./notification-integrity-scan";
import { parseDoctorOptions, runPlatformDoctor } from "./platform-doctor";
import { insertAuditEvent } from "../shared/audit-events";
import {
  inferRepoRoot,
  readEnvValue,
  readNonNegativeNumberArg,
  readStringArg
} from "./script-args";

const execFileAsync = promisify(execFile);
const repoRoot = inferRepoRoot("PRODUCTION_DOCTOR_REPO_ROOT");
const DEFAULT_RENDER_PUBLIC_BASE_URL = "https://hachozeh-gateway.onrender.com";
const DEFAULT_HORIZON_SCHEDULER_STALE_MS = 15 * 60_000;
const DEFAULT_PRODUCTION_HISTORY_P95_WATCH_MS = 2_000;
const DEFAULT_PRODUCTION_FRONTEND_ELAPSED_WATCH_MS = 3_000;
const DEFAULT_PRODUCTION_TIMEOUT_MS = 5_000;
const DEFAULT_WATCH_ALERT_REMINDER_MS = 24 * 60 * 60_000;
const WATCH_ALERT_ACTION = "production_doctor_watch_alert_sent";
const WATCH_ALERT_ENTITY_TYPE = "production_doctor_alert";

type Verdict = "ok" | "watch" | "bad";

type ProductionDoctorModule = {
  name:
    | "platform"
    | "economy_integrity"
    | "event_integrity"
    | "market_watch"
    | "market_integrity"
    | "lifecycle_queue"
    | "notification_integrity"
    | "avatar_integrity";
  verdict: Verdict;
  report: unknown;
};

export type ProductionDoctorReport = {
  event: "production_doctor_report";
  generatedAt: string;
  verdict: Verdict;
  modules: ProductionDoctorModule[];
};

export type ProductionDoctorOptions = {
  json: boolean;
  failOnWatch: boolean;
  alert: boolean;
  alertOnWatch: boolean;
  watchAlertReminderMs: number;
  receiptPath: string;
  alertScriptPath: string;
  platformArgs: string[];
};

type ProductionDoctorDeps = {
  db?: Queryable;
  fetchImpl?: typeof fetch;
  listStoredAvatars?: () => Promise<StoredAvatar[]>;
};

export type ProductionDoctorWatchAlertState = {
  fingerprint: string;
  sentAt: Date;
} | null;

function resolveReceiptPath(path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

export function parseProductionDoctorOptions(
  args = process.argv.slice(2)
): ProductionDoctorOptions {
  const platformArgs = [...args];
  if (
    !platformArgs.some((arg) => arg.startsWith("--public-base-url=")) &&
    process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL
  ) {
    platformArgs.push(`--public-base-url=${process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL}`);
  } else if (!platformArgs.some((arg) => arg.startsWith("--public-base-url="))) {
    platformArgs.push(`--public-base-url=${DEFAULT_RENDER_PUBLIC_BASE_URL}`);
  }
  if (!platformArgs.includes("--production")) {
    platformArgs.push("--production");
  }
  if (!platformArgs.some((arg) => arg.startsWith("--horizon-scheduler-stale-ms="))) {
    platformArgs.push(`--horizon-scheduler-stale-ms=${DEFAULT_HORIZON_SCHEDULER_STALE_MS}`);
  }
  if (!platformArgs.some((arg) => arg.startsWith("--timeout-ms="))) {
    platformArgs.push(
      `--timeout-ms=${readEnvValue(
        "PRODUCTION_DOCTOR_TIMEOUT_MS",
        String(DEFAULT_PRODUCTION_TIMEOUT_MS)
      )}`
    );
  }
  if (!platformArgs.some((arg) => arg.startsWith("--frontend-elapsed-watch-ms="))) {
    platformArgs.push(
      `--frontend-elapsed-watch-ms=${readEnvValue(
        "PRODUCTION_DOCTOR_FRONTEND_ELAPSED_WATCH_MS",
        String(DEFAULT_PRODUCTION_FRONTEND_ELAPSED_WATCH_MS)
      )}`
    );
  }
  if (!platformArgs.some((arg) => arg.startsWith("--history-p95-watch-ms="))) {
    platformArgs.push(
      `--history-p95-watch-ms=${readEnvValue(
        "PRODUCTION_DOCTOR_HISTORY_P95_WATCH_MS",
        String(DEFAULT_PRODUCTION_HISTORY_P95_WATCH_MS)
      )}`
    );
  }
  if (!platformArgs.includes("--allow-missing-backup")) {
    platformArgs.push("--allow-missing-backup");
  }
  if (
    !platformArgs.some((arg) => arg.startsWith("--diagnostics-bearer=")) &&
    process.env.DIAGNOSTICS_BEARER_TOKEN
  ) {
    platformArgs.push(`--diagnostics-bearer=${process.env.DIAGNOSTICS_BEARER_TOKEN}`);
  }

  return {
    json: args.includes("--json"),
    failOnWatch: args.includes("--fail-on-watch"),
    alert: args.includes("--alert"),
    alertOnWatch: args.includes("--alert-on-watch"),
    watchAlertReminderMs: readNonNegativeNumberArg(
      args,
      "watch-alert-reminder-ms",
      Number(readEnvValue("PRODUCTION_DOCTOR_WATCH_ALERT_REMINDER_MS", String(DEFAULT_WATCH_ALERT_REMINDER_MS)))
    ),
    receiptPath: readStringArg(
      args,
      "receipt-path",
      readEnvValue(
        "PRODUCTION_DOCTOR_RECEIPT_PATH",
        readEnvValue("PRODUCTION_INTEGRITY_RECEIPT_PATH", "workspace/runtime/doctor/production.jsonl")
      )
    ),
    alertScriptPath: resolve(
      repoRoot,
      readStringArg(
        args,
        "alert-script",
        readEnvValue("PLATFORM_ALERT_SCRIPT", "workspace/scripts/platform-alert.sh")
      )
    ),
    platformArgs
  };
}

function combineVerdict(modules: ProductionDoctorModule[]): Verdict {
  if (modules.some((module) => module.verdict === "bad")) {
    return "bad";
  }
  if (modules.some((module) => module.verdict === "watch")) {
    return "watch";
  }
  return "ok";
}

export function buildProductionDoctorReport(
  modules: ProductionDoctorModule[],
  generatedAt = new Date().toISOString()
): ProductionDoctorReport {
  return {
    event: "production_doctor_report",
    generatedAt,
    verdict: combineVerdict(modules),
    modules
  };
}

function nonZeroEconomyChecks(report: ProductionIntegrityReport) {
  return report.checks.filter((check) => check.count > 0);
}

function platformNotes(report: unknown): string[] {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return [];
  }

  const notes = (report as { notes?: unknown }).notes;
  return Array.isArray(notes)
    ? notes.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
    : [];
}

function platformAlertNotes(report: unknown): string[] {
  return platformNotes(report).filter(
    (note) => !/^runtime_backup_(missing|unavailable)_provider_managed_receipts_ok$/.test(note)
  );
}

export function shouldAlertProductionDoctor(
  report: ProductionDoctorReport,
  options: Pick<ProductionDoctorOptions, "alert" | "alertOnWatch">
): boolean {
  if (!options.alert) {
    return false;
  }

  return report.verdict === "bad" || (options.alertOnWatch && report.verdict === "watch");
}

export function classifyMarketWatchVerdict(report: MarketWatchCoverageDoctorReport): Verdict {
  if (report.blockerCount > 0) return "bad";
  return report.status === "findings" ? "watch" : "ok";
}

export function formatProductionDoctorAlert(report: ProductionDoctorReport): string {
  const details = formatProductionDoctorAlertDetails(report);

  return `production-doctor: ${report.verdict} at ${report.generatedAt}; ${details}`;
}

function formatProductionDoctorAlertDetails(report: ProductionDoctorReport): string {
  const details = report.modules
    .filter((module) => module.verdict !== "ok")
    .map((module) => {
      if (module.name === "economy_integrity") {
        const economyReport = module.report as ProductionIntegrityReport;
        const checks = nonZeroEconomyChecks(economyReport);
        const checkText = checks.length
          ? checks.map((check) => `${check.severity}:${check.name}=${check.count}`).join(",")
          : "non_ok_without_counts";
        return `${module.name}:${module.verdict}:${checkText}`;
      }

      if (module.name === "platform") {
        const notes = platformAlertNotes(module.report);
        return notes.length
          ? `${module.name}:${module.verdict}:${notes.join(",")}`
          : `${module.name}:${module.verdict}`;
      }

      if (module.name === "event_integrity") {
        const eventReport = module.report as ActiveEventLifecycleAuditReport;
        return `${module.name}:${module.verdict}:events=${eventReport.findingEventCount}/${eventReport.auditedEventCount},warnings=${eventReport.warningCount}`;
      }

      if (module.name === "market_watch") {
        const watchReport = module.report as MarketWatchCoverageDoctorReport;
        const visibleIssues = watchReport.issues.slice(0, 4).map((issue) => {
          const scope = issue.eventId ? `event:${issue.eventId}` : `market:${issue.marketId}`;
          return `${issue.code}@${scope}`;
        });
        const omitted = Math.max(0, watchReport.issues.length - visibleIssues.length);
        const issueDetails = visibleIssues.length
          ? `,details=${visibleIssues.join("|")}${omitted > 0 ? `|+${omitted}_more` : ""}`
          : "";
        return `${module.name}:${module.verdict}:issues=${watchReport.issueCount},blockers=${watchReport.blockerCount},warnings=${watchReport.warningCount}${issueDetails}`;
      }

      if (module.name === "market_integrity") {
        const integrityReport = module.report as MarketIntegrityScanReport;
        return `${module.name}:${module.verdict}:issues=${integrityReport.issueCount},blockers=${integrityReport.blockerCount},warnings=${integrityReport.watchCount}`;
      }

      if (module.name === "lifecycle_queue") {
        const queueReport = module.report as LifecycleQueueDoctorReport;
        return `${module.name}:${module.verdict}:blockers=${queueReport.blockerCount},ready=${queueReport.watchCount}`;
      }

      if (module.name === "notification_integrity") {
        const notificationReport = module.report as NotificationIntegrityScanReport;
        return `${module.name}:${module.verdict}:issues=${notificationReport.issueCount}`;
      }

      if (module.name === "avatar_integrity") {
        const avatarReport = module.report as AvatarStorageIntegrityReport;
        return `${module.name}:${module.verdict}:references=${avatarReport.databaseReferenceCount},stored=${avatarReport.storedObjectCount},dangling=${avatarReport.danglingReferenceCount},invalid=${avatarReport.invalidReferenceCount}`;
      }

      return `${module.name}:${module.verdict}`;
    });

  return details.length ? details.join("; ") : "all modules ok";
}

export function productionDoctorWatchFingerprint(report: ProductionDoctorReport): string {
  return createHash("sha256")
    .update(`${report.verdict};${formatProductionDoctorAlertDetails(report)}`)
    .digest("hex");
}

export function shouldSendProductionDoctorWatchAlert(
  report: ProductionDoctorReport,
  state: ProductionDoctorWatchAlertState,
  reminderMs: number,
  nowMs = Date.now()
): boolean {
  if (!state) {
    return true;
  }

  if (state.fingerprint !== productionDoctorWatchFingerprint(report)) {
    return true;
  }

  return nowMs - state.sentAt.valueOf() >= reminderMs;
}

async function appendReceipt(path: string, report: ProductionDoctorReport): Promise<void> {
  if (!path.trim()) {
    return;
  }

  const resolved = resolveReceiptPath(path);
  await mkdir(dirname(resolved), { recursive: true });
  await appendFile(resolved, `${JSON.stringify(report)}\n`);
}

async function sendPlatformAlert(scriptPath: string, message: string): Promise<boolean> {
  try {
    const result = await execFileAsync(scriptPath, ["--require-delivery", "send", message], {
      timeout: 15_000
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) {
      console.log(`[production-doctor] platform alert result: ${output}`);
    }
    return true;
  } catch (error) {
    console.error(
      `[production-doctor] platform alert failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

async function readLatestWatchAlertState(db: Queryable): Promise<ProductionDoctorWatchAlertState> {
  const result = await db.query<{ entity_id: string; created_at: Date }>(
    `
      select entity_id, created_at
      from audit_events
      where action = $1
        and entity_type = $2
      order by created_at desc
      limit 1
    `,
    [WATCH_ALERT_ACTION, WATCH_ALERT_ENTITY_TYPE]
  );
  const row = result.rows[0];
  return row ? { fingerprint: row.entity_id, sentAt: row.created_at } : null;
}

async function sendProductionDoctorAlert(
  options: ProductionDoctorOptions,
  report: ProductionDoctorReport
): Promise<void> {
  const db = createDbPool(loadAppEnv().db);
  try {
    const state = await readLatestWatchAlertState(db);
    if (!shouldSendProductionDoctorWatchAlert(report, state, options.watchAlertReminderMs)) {
      console.log("[production-doctor] unchanged alert suppressed");
      return;
    }

    const sent = await sendPlatformAlert(options.alertScriptPath, formatProductionDoctorAlert(report));
    if (!sent) {
      return;
    }

    const fingerprint = productionDoctorWatchFingerprint(report);
    await insertAuditEvent(db, {
      actorId: "production_doctor",
      action: WATCH_ALERT_ACTION,
      entityType: WATCH_ALERT_ENTITY_TYPE,
      entityId: fingerprint,
      payload: {
        verdict: report.verdict,
        generatedAt: report.generatedAt,
        reminderMs: options.watchAlertReminderMs
      }
    });
  } finally {
    await db.end();
  }
}

export async function runProductionDoctor(
  options: ProductionDoctorOptions,
  deps: ProductionDoctorDeps = {}
): Promise<ProductionDoctorReport> {
  const platformOptions = parseDoctorOptions(options.platformArgs);
  const platformReport = await runPlatformDoctor(platformOptions, { fetchImpl: deps.fetchImpl });

  let ownedDb = false;
  let db = deps.db;
  if (!db) {
    const env = loadAppEnv();
    db = createDbPool(env.db);
    ownedDb = true;
  }

  try {
    const economyReport = await runProductionIntegrityChecks(db);
    const eventIntegrityReport = await auditActiveEvents(db);
    const marketWatchReport = await runMarketWatchCoverageDoctor(db);
    const marketIntegrityReport = await runMarketIntegrityScan(db);
    const lifecycleQueueReport = await runLifecycleQueueDoctor(db);
    const notificationIntegrityReport = await runNotificationIntegrityScan(db);
    const avatarIntegrityReport = await auditAvatarStorageIntegrity(db, {
      listStoredAvatars: deps.listStoredAvatars
    });
    return buildProductionDoctorReport([
      {
        name: "platform",
        verdict: platformReport.verdict,
        report: platformReport
      },
      {
        name: "economy_integrity",
        verdict: economyReport.verdict,
        report: economyReport
      },
      {
        name: "event_integrity",
        verdict: eventIntegrityReport.status === "findings" ? "watch" : "ok",
        report: eventIntegrityReport
      },
      {
        name: "market_watch",
        verdict: classifyMarketWatchVerdict(marketWatchReport),
        report: marketWatchReport
      },
      {
        name: "market_integrity",
        verdict: marketIntegrityReport.blockerCount > 0
          ? "bad"
          : marketIntegrityReport.watchCount > 0
            ? "watch"
            : "ok",
        report: marketIntegrityReport
      },
      {
        name: "lifecycle_queue",
        verdict: lifecycleQueueReport.blockerCount > 0
          ? "bad"
          : lifecycleQueueReport.watchCount > 0
            ? "watch"
            : "ok",
        report: lifecycleQueueReport
      },
      {
        name: "notification_integrity",
        verdict: notificationIntegrityReport.issueCount > 0 ? "watch" : "ok",
        report: notificationIntegrityReport
      },
      {
        name: "avatar_integrity",
        verdict: avatarIntegrityReport.verdict,
        report: avatarIntegrityReport
      }
    ]);
  } finally {
    if (ownedDb && "end" in db && typeof db.end === "function") {
      await db.end();
    }
  }
}

async function run(): Promise<void> {
  const options = parseProductionDoctorOptions();
  const report = await runProductionDoctor(options);
  await appendReceipt(options.receiptPath, report);

  console.log(options.json ? JSON.stringify(report, null, 2) : formatProductionDoctorAlert(report));

  if (shouldAlertProductionDoctor(report, options)) {
    await sendProductionDoctorAlert(options, report);
  }

  if (report.verdict === "bad" || (options.failOnWatch && report.verdict === "watch")) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
