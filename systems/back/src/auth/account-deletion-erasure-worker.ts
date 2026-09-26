import type { Pool } from "pg";

import { sweepDueAccountDeletionErasures } from "./account-deletion-erasure-service";
import { formatUnknownError, type Logger } from "../shared/logger";

export type AccountDeletionErasureWorkerConfig = {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
  limit: number;
};

export type AccountDeletionErasureWorkerHandle = {
  stop(): void;
  runNow(): Promise<void>;
};

function readBooleanEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean
): boolean {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function readPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function readAccountDeletionErasureWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): AccountDeletionErasureWorkerConfig {
  return {
    enabled: readBooleanEnv(env, "ACCOUNT_DELETION_ERASURE_WORKER_ENABLED", true),
    intervalMs: readPositiveIntegerEnv(
      env,
      "ACCOUNT_DELETION_ERASURE_WORKER_INTERVAL_MS",
      6 * 60 * 60 * 1000
    ),
    startupDelayMs: readPositiveIntegerEnv(
      env,
      "ACCOUNT_DELETION_ERASURE_WORKER_STARTUP_DELAY_MS",
      60_000
    ),
    limit: Math.min(readPositiveIntegerEnv(env, "ACCOUNT_DELETION_ERASURE_WORKER_LIMIT", 50), 500)
  };
}

export function startAccountDeletionErasureWorker(input: {
  dbPool: Pool;
  logger: Logger;
  config: AccountDeletionErasureWorkerConfig;
}): AccountDeletionErasureWorkerHandle | null {
  if (!input.config.enabled) {
    input.logger.info("account_deletion_erasure_worker.disabled");
    return null;
  }

  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  async function runOnce(): Promise<void> {
    if (running) {
      input.logger.warn("account_deletion_erasure_worker.tick_skipped", {
        reason: "previous_tick_running"
      });
      return;
    }

    running = true;
    try {
      const result = await sweepDueAccountDeletionErasures(input.dbPool, {
        execute: true,
        limit: input.config.limit
      });
      input.logger.info("account_deletion_erasure_worker.tick_completed", {
        scannedCount: result.scannedCount,
        completedCount: result.completedCount,
        skippedCount: result.skippedCount
      });
    } catch (error) {
      input.logger.error("account_deletion_erasure_worker.tick_failed", {
        error: formatUnknownError(error)
      });
    } finally {
      running = false;
    }
  }

  function schedule(delayMs: number): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void runOnce().finally(() => schedule(input.config.intervalMs));
    }, delayMs);
    timer.unref();
  }

  schedule(input.config.startupDelayMs);
  input.logger.info("account_deletion_erasure_worker.started", {
    intervalMs: input.config.intervalMs,
    startupDelayMs: input.config.startupDelayMs,
    limit: input.config.limit
  });

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    runNow: runOnce
  };
}
