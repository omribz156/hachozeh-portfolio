import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import type { Queryable } from "../../src/db/client/pool";
import {
  buildProductionDoctorReport,
  classifyMarketWatchVerdict,
  formatProductionDoctorAlert,
  parseProductionDoctorOptions,
  productionDoctorWatchFingerprint,
  runProductionDoctor,
  shouldAlertProductionDoctor,
  shouldSendProductionDoctorWatchAlert
} from "../../src/scripts/production-doctor";

function createDb(counts: Record<string, number> = {}): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from events e")) {
        return { rows: [] };
      }
      if (sql.includes("from market_watch_plans")) {
        return { rows: [] };
      }
      if (sql.includes("from markets m") || sql.includes("from user_notifications")) {
        return { rows: [] };
      }
      if (sql.includes("from user_notification_events") || sql.includes("from ledger_transactions lt")) {
        return { rows: [] };
      }
      if (sql.includes("select avatar_url")) {
        return { rows: [] };
      }
      const match = sql.match(/\/\* check:([a-z_]+) \*\//);
      const name = match?.[1] ?? "unknown";
      return { rows: [{ count: counts[name] ?? 0 }] };
    })
  };
}

describe("production doctor", () => {
  it("does not let imported doctor modules parse Render alert CLI flags", () => {
    const cwd = resolve(__dirname, "../..");
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        "process.argv.push('--json','--alert','--alert-on-watch'); require('./src/scripts/production-doctor.ts'); console.log('import-ok');"
      ],
      { cwd, encoding: "utf8" }
    );

    expect(output.trim()).toBe("import-ok");
  });

  it("defaults to launch-safe production platform checks and diagnostics bearer from env", () => {
    const previousBearer = process.env.DIAGNOSTICS_BEARER_TOKEN;
    const previousBaseUrl = process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL;
    process.env.DIAGNOSTICS_BEARER_TOKEN = "secret-token";
    process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL = "https://hachozeh-gateway.onrender.com";

    try {
      const options = parseProductionDoctorOptions([
        "--json",
        "--fail-on-watch",
        "--alert",
        "--alert-on-watch"
      ]);

      expect(options).toMatchObject({
        json: true,
        failOnWatch: true,
        alert: true,
        alertOnWatch: true,
        watchAlertReminderMs: 86_400_000
      });
      expect(options.platformArgs).toEqual(expect.arrayContaining([
        "--production",
        "--public-base-url=https://hachozeh-gateway.onrender.com",
        "--horizon-scheduler-stale-ms=900000",
        "--timeout-ms=5000",
        "--frontend-elapsed-watch-ms=3000",
        "--history-p95-watch-ms=2000",
        "--allow-missing-backup",
        "--diagnostics-bearer=secret-token"
      ]));
      expect(options.platformArgs).not.toContain("--deep");
      expect(options.receiptPath).toContain("workspace/runtime/");
    } finally {
      if (previousBearer === undefined) delete process.env.DIAGNOSTICS_BEARER_TOKEN;
      else process.env.DIAGNOSTICS_BEARER_TOKEN = previousBearer;
      if (previousBaseUrl === undefined) delete process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL;
      else process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL = previousBaseUrl;
    }
  });

  it("uses the direct Render gateway URL by default for production public probes", () => {
    const previousBaseUrl = process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL;
    delete process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL;

    try {
      const options = parseProductionDoctorOptions([]);
      expect(options.platformArgs).toContain("--public-base-url=https://hachozeh-gateway.onrender.com");
    } finally {
      if (previousBaseUrl !== undefined) {
        process.env.PRODUCTION_DOCTOR_PUBLIC_BASE_URL = previousBaseUrl;
      }
    }
  });

  it("keeps explicit production history p95 thresholds", () => {
    const options = parseProductionDoctorOptions(["--history-p95-watch-ms=1250"]);
    const matchingArgs = options.platformArgs.filter((arg) => arg.startsWith("--history-p95-watch-ms="));

    expect(matchingArgs).toEqual(["--history-p95-watch-ms=1250"]);
  });

  it("keeps explicit production timeout thresholds", () => {
    const options = parseProductionDoctorOptions(["--timeout-ms=4500"]);
    const matchingArgs = options.platformArgs.filter((arg) => arg.startsWith("--timeout-ms="));

    expect(matchingArgs).toEqual(["--timeout-ms=4500"]);
  });

  it("keeps explicit production frontend elapsed watch thresholds", () => {
    const options = parseProductionDoctorOptions(["--frontend-elapsed-watch-ms=3500"]);
    const matchingArgs = options.platformArgs.filter((arg) => arg.startsWith("--frontend-elapsed-watch-ms="));

    expect(matchingArgs).toEqual(["--frontend-elapsed-watch-ms=3500"]);
  });

  it("combines module verdicts with bad above watch above ok", () => {
    const report = buildProductionDoctorReport([
      { name: "platform", verdict: "ok", report: {} },
      { name: "economy_integrity", verdict: "watch", report: { checks: [] } }
    ], "2026-06-28T16:00:00.000Z");

    expect(report.verdict).toBe("watch");

    const badReport = buildProductionDoctorReport([
      { name: "platform", verdict: "bad", report: {} },
      { name: "economy_integrity", verdict: "watch", report: { checks: [] } }
    ], "2026-06-28T16:00:00.000Z");

    expect(badReport.verdict).toBe("bad");
  });

  it("treats missing watch coverage blockers as bad", () => {
    expect(classifyMarketWatchVerdict({
      objectType: "market_watch_coverage_doctor",
      generatedAt: "2026-09-02T12:00:00.000Z",
      status: "findings",
      scannedCount: 7,
      issueCount: 1,
      blockerCount: 1,
      warningCount: 0,
      issues: [],
      rows: []
    })).toBe("bad");
  });

  it("alerts on watch only when configured", () => {
    const report = buildProductionDoctorReport([
      { name: "platform", verdict: "watch", report: {} },
      { name: "economy_integrity", verdict: "ok", report: { checks: [] } }
    ]);

    expect(shouldAlertProductionDoctor(report, { alert: true, alertOnWatch: false })).toBe(false);
    expect(shouldAlertProductionDoctor(report, { alert: true, alertOnWatch: true })).toBe(true);
  });

  it("suppresses unchanged watch alerts until the reminder window", () => {
    const first = buildProductionDoctorReport([
      { name: "platform", verdict: "watch", report: { notes: ["missing_resolution_cases:2"] } }
    ], "2026-08-02T03:20:00.000Z");
    const repeated = buildProductionDoctorReport([
      { name: "platform", verdict: "watch", report: { notes: ["missing_resolution_cases:2"] } }
    ], "2026-08-02T04:20:00.000Z");
    const changed = buildProductionDoctorReport([
      { name: "platform", verdict: "watch", report: { notes: ["missing_resolution_cases:3"] } }
    ], "2026-08-02T04:20:00.000Z");
    const sentAt = new Date("2026-08-02T03:20:00.000Z");
    const state = { fingerprint: productionDoctorWatchFingerprint(first), sentAt };

    expect(productionDoctorWatchFingerprint(repeated)).toBe(state.fingerprint);
    expect(shouldSendProductionDoctorWatchAlert(repeated, state, 86_400_000, sentAt.valueOf() + 3_600_000)).toBe(false);
    expect(shouldSendProductionDoctorWatchAlert(changed, state, 86_400_000, sentAt.valueOf() + 3_600_000)).toBe(true);
    expect(shouldSendProductionDoctorWatchAlert(repeated, state, 86_400_000, sentAt.valueOf() + 86_400_000)).toBe(true);
  });

  it("suppresses unchanged bad alerts until the reminder window", () => {
    const first = buildProductionDoctorReport([
      { name: "lifecycle_queue", verdict: "bad", report: { blockerCount: 2, watchCount: 0 } }
    ], "2026-08-02T17:17:00.000Z");
    const repeated = buildProductionDoctorReport([
      { name: "lifecycle_queue", verdict: "bad", report: { blockerCount: 2, watchCount: 0 } }
    ], "2026-08-02T18:17:00.000Z");
    const changed = buildProductionDoctorReport([
      { name: "lifecycle_queue", verdict: "bad", report: { blockerCount: 3, watchCount: 0 } }
    ], "2026-08-02T18:17:00.000Z");
    const sentAt = new Date("2026-08-02T17:17:00.000Z");
    const state = { fingerprint: productionDoctorWatchFingerprint(first), sentAt };

    expect(productionDoctorWatchFingerprint(repeated)).toBe(state.fingerprint);
    expect(shouldSendProductionDoctorWatchAlert(repeated, state, 86_400_000, sentAt.valueOf() + 3_600_000)).toBe(false);
    expect(shouldSendProductionDoctorWatchAlert(changed, state, 86_400_000, sentAt.valueOf() + 3_600_000)).toBe(true);
  });

  it("formats compact economy check details in alerts", () => {
    const report = buildProductionDoctorReport([
      { name: "platform", verdict: "ok", report: {} },
      {
        name: "economy_integrity",
        verdict: "bad",
        report: {
          checks: [
            { name: "ledger_unbalanced_transactions", severity: "bad", count: 2 },
            { name: "account_cached_balance_ledger_drift", severity: "watch", count: 1 }
          ]
        }
      }
    ], "2026-06-28T16:00:00.000Z");

    expect(formatProductionDoctorAlert(report)).toBe(
      "production-doctor: bad at 2026-06-28T16:00:00.000Z; economy_integrity:bad:bad:ledger_unbalanced_transactions=2,watch:account_cached_balance_ledger_drift=1"
    );
  });

  it("formats platform notes in alerts", () => {
    const report = buildProductionDoctorReport([
      {
        name: "platform",
        verdict: "watch",
        report: {
          notes: ["missing_resolution_cases:1", "lifecycle_blocked"]
        }
      },
      { name: "economy_integrity", verdict: "ok", report: { checks: [] } }
    ], "2026-06-28T16:00:00.000Z");

    expect(formatProductionDoctorAlert(report)).toBe(
      "production-doctor: watch at 2026-06-28T16:00:00.000Z; platform:watch:missing_resolution_cases:1,lifecycle_blocked"
    );
  });

  it("formats compact event integrity counts in alerts", () => {
    const report = buildProductionDoctorReport([
      { name: "platform", verdict: "ok", report: {} },
      { name: "economy_integrity", verdict: "ok", report: { checks: [] } },
      {
        name: "event_integrity",
        verdict: "watch",
        report: {
          status: "findings",
          auditedEventCount: 7,
          findingEventCount: 2,
          warningCount: 3,
          events: []
        }
      }
    ], "2026-07-14T20:00:00.000Z");

    expect(formatProductionDoctorAlert(report)).toBe(
      "production-doctor: watch at 2026-07-14T20:00:00.000Z; event_integrity:watch:events=2/7,warnings=3"
    );
  });

  it("formats compact actionable market watch findings in alerts", () => {
    const report = buildProductionDoctorReport([
      {
        name: "market_watch",
        verdict: "watch",
        report: {
          objectType: "market_watch_coverage_doctor",
          generatedAt: "2026-07-15T20:00:00.000Z",
          status: "findings",
          scannedCount: 4,
          issueCount: 2,
          blockerCount: 1,
          warningCount: 1,
          issues: [
            {
              marketId: null,
              eventId: "evt_show",
              severity: "blocker",
              code: "missing_enabled_watch_plan",
              affectedMarketCount: 7
            },
            {
              marketId: "market_weather",
              eventId: null,
              severity: "watch",
              code: "stale_due_watch_plan",
              count: 1,
              affectedMarketCount: 1
            }
          ],
          rows: []
        }
      }
    ], "2026-07-15T20:00:00.000Z");

    expect(formatProductionDoctorAlert(report)).toBe(
      "production-doctor: watch at 2026-07-15T20:00:00.000Z; market_watch:watch:issues=2,blockers=1,warnings=1,details=missing_enabled_watch_plan@event:evt_show|stale_due_watch_plan@market:market_weather"
    );
  });

  it("formats compact lifecycle integrity counts in alerts", () => {
    const report = buildProductionDoctorReport([
      {
        name: "market_integrity",
        verdict: "bad",
        report: {
          objectType: "market_integrity_scan",
          generatedAt: "2026-07-16T20:00:00.000Z",
          scannedCount: 128,
          issueCount: 2,
          blockerCount: 1,
          watchCount: 1,
          issues: []
        }
      },
      {
        name: "lifecycle_queue",
        verdict: "watch",
        report: {
          objectType: "lifecycle_queue_doctor",
          generatedAt: "2026-07-16T20:00:00.000Z",
          checkedCount: 128,
          blockerCount: 0,
          watchCount: 2,
          items: []
        }
      },
      {
        name: "notification_integrity",
        verdict: "watch",
        report: {
          objectType: "notification_integrity_scan",
          generatedAt: "2026-07-16T20:00:00.000Z",
          marketId: null,
          issueCount: 3,
          staleLossAfterCompensation: [],
          staleWinAfterResolutionRepair: [],
          orphanEvents: [],
          notificationWithoutRealization: [],
          compensationWithoutCorrectionNotification: []
        }
      }
    ], "2026-07-16T20:00:00.000Z");

    expect(formatProductionDoctorAlert(report)).toBe(
      "production-doctor: bad at 2026-07-16T20:00:00.000Z; market_integrity:bad:issues=2,blockers=1,warnings=1; lifecycle_queue:watch:blockers=0,ready=2; notification_integrity:watch:issues=3"
    );
  });

  it("formats aggregate-only avatar integrity counts in alerts", () => {
    const report = buildProductionDoctorReport([
      {
        name: "avatar_integrity",
        verdict: "bad",
        report: {
          objectType: "avatar_storage_integrity_report",
          generatedAt: "2026-07-14T20:00:00.000Z",
          verdict: "bad",
          databaseReferenceCount: 2,
          referencedObjectCount: 2,
          storedObjectCount: 0,
          danglingReferenceCount: 2,
          invalidReferenceCount: 0,
          unreferencedObjectCount: 0
        }
      }
    ], "2026-07-14T20:00:00.000Z");

    expect(formatProductionDoctorAlert(report)).toBe(
      "production-doctor: bad at 2026-07-14T20:00:00.000Z; avatar_integrity:bad:references=2,stored=0,dangling=2,invalid=0"
    );
  });

  it("suppresses provider-managed backup proof notes in alerts", () => {
    const report = buildProductionDoctorReport([
      {
        name: "platform",
        verdict: "watch",
        report: {
          notes: [
            "runtime_backup_unavailable_provider_managed_receipts_ok",
            "missing_resolution_cases:1"
          ]
        }
      },
      { name: "economy_integrity", verdict: "ok", report: { checks: [] } }
    ], "2026-06-28T16:00:00.000Z");

    expect(formatProductionDoctorAlert(report)).toBe(
      "production-doctor: watch at 2026-06-28T16:00:00.000Z; platform:watch:missing_resolution_cases:1"
    );
  });

  it("runs platform, economy, and event integrity modules in one report", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              identity: {
                commitSha: "abc123",
                buildTimestamp: "2026-06-28T16:00:00.000Z",
                releaseId: "release-1"
              },
              migration: {
                status: "ok",
                latest: "001.sql",
                count: 1
              },
              backup: {
                status: "ok",
                ageMs: 60_000
              },
              latestHorizonScheduler: {
                generatedAt: new Date().toISOString(),
                summary: {
                  status: "ok",
                  overdueOpenMarketCountAfter: 0,
                  alertCount: 0,
                  appDbClockSkewMs: 100,
                  clockSkewWarnMs: 2000
                }
              },
              latestLifecycleHeartbeat: {
                generatedAt: new Date().toISOString(),
                summary: {
                  status: "ok",
                  missingResolutionCaseCount: 0,
                  recommendedResolutionCaseCount: 0,
                  reviewNeededResolutionCaseCount: 0
                }
              }
            }
          }
        : target.includes("/api/markets?status=open")
          ? { markets: [{ marketKey: "market-a" }] }
          : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runProductionDoctor({
      ...parseProductionDoctorOptions(["--public-base-url=https://hachozeh.com"]),
      alert: false,
      alertOnWatch: false,
      failOnWatch: false,
      json: true,
      platformArgs: [
        "--production",
        "--deep",
        "--public-base-url=https://hachozeh.com",
        "--read-latency-samples=1"
      ]
    }, {
      db: createDb(),
      fetchImpl,
      listStoredAvatars: async () => []
    });

    expect(report.verdict).toBe("ok");
    expect(report.modules.map((module) => module.name)).toEqual([
      "platform",
      "economy_integrity",
      "event_integrity",
      "market_watch",
      "market_integrity",
      "lifecycle_queue",
      "notification_integrity",
      "avatar_integrity"
    ]);
  });
});
