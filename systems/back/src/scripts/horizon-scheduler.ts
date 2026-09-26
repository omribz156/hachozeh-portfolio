import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import type { PoolClient } from "pg";
import { runHorizonCloseSweep } from "../lifecycle/horizon/close-sweep-service";
import {
  acquireHorizonSchedulerLock,
  calculateHorizonSchedulerSleepMs,
  normalizeSchedulerInteger,
  persistHorizonSchedulerSnapshot,
  readHorizonSchedulerClockSnapshot,
  releaseHorizonSchedulerLock
} from "../lifecycle/horizon/scheduler-service";

type HorizonSchedulerOptions = {
  dryRun: boolean;
  json: boolean;
  jsonl: boolean;
  limit: number;
  maxTicks: number | null;
  minSleepMs: number;
  maxSleepMs: number;
  errorSleepMs: number;
  clockSkewWarnMs: number;
  persistSnapshot: boolean;
  requireLock: boolean;
};

type HorizonSchedulerTick = {
  objectType: "horizon_scheduler_tick";
  tickNumber: number;
  startedAt: string;
  completedAt: string;
  dryRun: boolean;
  closeCandidateCount: number;
  closeExecutionCount: number;
  alertCount: number;
  dbNow: string;
  appNow: string;
  appDbClockSkewMs: number;
  clockSkewWarning: boolean;
  overdueOpenMarketCountBefore: number;
  overdueOpenMarketCountAfter: number;
  closedMarketIds: string[];
  nextCloseAt: string | null;
  nextWakeAt: string | null;
  sleepMs: number;
  runtimeSnapshotId?: string;
};

type HorizonSchedulerErrorTick = {
  objectType: "horizon_scheduler_error_tick";
  tickNumber: number;
  startedAt: string;
  completedAt: string;
  error: string;
  nextWakeAt: string | null;
  sleepMs: number;
  runtimeSnapshotId?: string;
};

type HorizonSchedulerLockEvent = {
  objectType: "horizon_scheduler_lock_event";
  status: "lock_not_acquired";
  at: string;
  sleepMs: number;
  nextWakeAt: string;
};

let stopRequested = false;

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(`--${name}`);
  const next = index >= 0 ? args[index + 1] : undefined;
  return next && !next.startsWith("--") ? next : undefined;
}

function readBooleanFlag(args: string[], name: string, fallback: boolean): boolean {
  const raw = readFlag(args, name);

  if (raw === undefined) {
    return args.includes(`--${name}`) ? true : fallback;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  throw new Error(`--${name} must be true or false.`);
}

function parseOptions(args: string[]): HorizonSchedulerOptions {
  const maxTicksRaw = readFlag(args, "max-ticks") ?? process.env["HORIZON_SCHEDULER_MAX_TICKS"];
  const maxTicks = maxTicksRaw === undefined
    ? null
    : normalizeSchedulerInteger(maxTicksRaw, 1, {
        min: 1,
        max: 1_000_000,
        fieldName: "maxTicks"
      });

  return {
    dryRun: readBooleanFlag(args, "dry-run", process.env["HORIZON_SCHEDULER_DRY_RUN"] === "true"),
    persistSnapshot: readBooleanFlag(
      args,
      "persist-snapshot",
      process.env["HORIZON_SCHEDULER_PERSIST_SNAPSHOT"] !== "false"
    ),
    requireLock: readBooleanFlag(
      args,
      "require-lock",
      process.env["HORIZON_SCHEDULER_REQUIRE_LOCK"] !== "false"
    ),
    json: args.includes("--json"),
    jsonl: args.includes("--jsonl") || !args.includes("--json"),
    limit: normalizeSchedulerInteger(readFlag(args, "limit") ?? process.env["HORIZON_SCHEDULER_LIMIT"], 50, {
      min: 1,
      max: 500,
      fieldName: "limit"
    }),
    maxTicks,
    minSleepMs: normalizeSchedulerInteger(
      readFlag(args, "min-sleep-ms") ?? process.env["HORIZON_SCHEDULER_MIN_SLEEP_MS"],
      1_000,
      {
        min: 250,
        max: 3_600_000,
        fieldName: "minSleepMs"
      }
    ),
    maxSleepMs: normalizeSchedulerInteger(
      readFlag(args, "max-sleep-ms") ?? process.env["HORIZON_SCHEDULER_MAX_SLEEP_MS"],
      30_000,
      {
        min: 250,
        max: 3_600_000,
        fieldName: "maxSleepMs"
      }
    ),
    errorSleepMs: normalizeSchedulerInteger(
      readFlag(args, "error-sleep-ms") ?? process.env["HORIZON_SCHEDULER_ERROR_SLEEP_MS"],
      60_000,
      {
        min: 1_000,
        max: 3_600_000,
        fieldName: "errorSleepMs"
      }
    ),
    clockSkewWarnMs: normalizeSchedulerInteger(
      readFlag(args, "clock-skew-warn-ms") ?? process.env["HORIZON_SCHEDULER_CLOCK_SKEW_WARN_MS"],
      2_000,
      {
        min: 100,
        max: 300_000,
        fieldName: "clockSkewWarnMs"
      }
    )
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNextWakeAt(completedAt: string, sleepMs: number): string | null {
  if (stopRequested || sleepMs <= 0) {
    return null;
  }

  return new Date(Date.parse(completedAt) + sleepMs).toISOString();
}

function printEvent(
  event: HorizonSchedulerTick | HorizonSchedulerErrorTick | HorizonSchedulerLockEvent,
  options: HorizonSchedulerOptions
): void {
  if (options.json && !options.jsonl) {
    console.log(JSON.stringify(event, null, 2));
    return;
  }

  console.log(JSON.stringify(event));
}

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);
  let lockClient: PoolClient | null = null;

  process.once("SIGINT", () => {
    stopRequested = true;
  });
  process.once("SIGTERM", () => {
    stopRequested = true;
  });

  try {
    if (options.requireLock) {
      lockClient = await acquireHorizonSchedulerLock(dbPool);

      if (!lockClient) {
        const at = new Date().toISOString();
        const sleepMs = options.maxSleepMs;
        printEvent(
          {
            objectType: "horizon_scheduler_lock_event",
            status: "lock_not_acquired",
            at,
            sleepMs,
            nextWakeAt: new Date(Date.parse(at) + sleepMs).toISOString()
          },
          options
        );
        return;
      }
    }

    for (let tickNumber = 1; !stopRequested; tickNumber += 1) {
      const appStartedAt = new Date();

      try {
        const beforeClock = await readHorizonSchedulerClockSnapshot(dbPool);
        const startedAt = beforeClock.dbNow;
        const sweep = await runHorizonCloseSweep(dbPool, {
          evaluatedAt: startedAt,
          dryRun: options.dryRun,
          limit: options.limit
        });
        const afterClock = await readHorizonSchedulerClockSnapshot(dbPool);
        const hadDueWork =
          sweep.candidates.length > 0 ||
          sweep.executions.length > 0 ||
          sweep.alerts.length > 0;
        const appDbClockSkewMs = appStartedAt.getTime() - Date.parse(startedAt);
        const sleepMs = calculateHorizonSchedulerSleepMs({
          now: new Date(afterClock.dbNow),
          nextCloseAt: afterClock.nextCloseAt,
          minSleepMs: options.minSleepMs,
          maxSleepMs: options.maxSleepMs,
          hadDueWork
        });
        const completedAt = new Date().toISOString();
        const closedMarketIds = sweep.executions.map((execution) => execution.marketId);
        const summarySnapshot = {
          status:
            sweep.alerts.length > 0 || Math.abs(appDbClockSkewMs) >= options.clockSkewWarnMs
              ? "watch"
              : "ok",
          tickNumber,
          dryRun: options.dryRun,
          dbNow: startedAt,
          appNow: appStartedAt.toISOString(),
          appDbClockSkewMs,
          clockSkewWarnMs: options.clockSkewWarnMs,
          closeCandidateCount: sweep.candidates.length,
          closeExecutionCount: sweep.executions.length,
          alertCount: sweep.alerts.length,
          overdueOpenMarketCountBefore: beforeClock.overdueOpenMarketCount,
          overdueOpenMarketCountAfter: afterClock.overdueOpenMarketCount,
          nextCloseAt: afterClock.nextCloseAt,
          closedMarketIds,
          nextWakeAt: toNextWakeAt(completedAt, sleepMs),
          sleepMs
        };
        const runtimeSnapshotId = options.persistSnapshot
          ? await persistHorizonSchedulerSnapshot(dbPool, {
              generatedAt: completedAt,
              summarySnapshot,
              payloadSnapshot: {
                objectType: "horizon_scheduler_tick_snapshot",
                summary: summarySnapshot,
                closeSweep: sweep
              }
            })
          : undefined;

        printEvent(
          {
            objectType: "horizon_scheduler_tick",
            tickNumber,
            startedAt,
            completedAt,
            dryRun: options.dryRun,
            closeCandidateCount: sweep.candidates.length,
            closeExecutionCount: sweep.executions.length,
            alertCount: sweep.alerts.length,
            dbNow: startedAt,
            appNow: appStartedAt.toISOString(),
            appDbClockSkewMs,
            clockSkewWarning: Math.abs(appDbClockSkewMs) >= options.clockSkewWarnMs,
            overdueOpenMarketCountBefore: beforeClock.overdueOpenMarketCount,
            overdueOpenMarketCountAfter: afterClock.overdueOpenMarketCount,
            closedMarketIds,
            nextCloseAt: afterClock.nextCloseAt,
            nextWakeAt: toNextWakeAt(completedAt, sleepMs),
            sleepMs,
            ...(runtimeSnapshotId ? { runtimeSnapshotId } : {})
          },
          options
        );

        if (options.maxTicks !== null && tickNumber >= options.maxTicks) {
          break;
        }

        await sleep(sleepMs);
      } catch (error) {
        const completedAt = new Date().toISOString();
        const sleepMs = options.errorSleepMs;
        const summarySnapshot = {
          status: "bad",
          tickNumber,
          error: error instanceof Error ? error.message : String(error),
          nextWakeAt: toNextWakeAt(completedAt, sleepMs),
          sleepMs
        };
        let runtimeSnapshotId: string | undefined;

        try {
          runtimeSnapshotId = options.persistSnapshot
            ? await persistHorizonSchedulerSnapshot(dbPool, {
                generatedAt: completedAt,
                summarySnapshot,
                payloadSnapshot: {
                  objectType: "horizon_scheduler_error_tick_snapshot",
                  summary: summarySnapshot
                }
              })
            : undefined;
        } catch {
          runtimeSnapshotId = undefined;
        }

        printEvent(
          {
            objectType: "horizon_scheduler_error_tick",
            tickNumber,
            startedAt: appStartedAt.toISOString(),
            completedAt,
            error: error instanceof Error ? error.message : String(error),
            nextWakeAt: toNextWakeAt(completedAt, sleepMs),
            sleepMs,
            ...(runtimeSnapshotId ? { runtimeSnapshotId } : {})
          },
          options
        );

        if (options.maxTicks !== null && tickNumber >= options.maxTicks) {
          process.exitCode = 1;
          break;
        }

        await sleep(sleepMs);
      }
    }
  } finally {
    await releaseHorizonSchedulerLock(lockClient);
    await dbPool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
