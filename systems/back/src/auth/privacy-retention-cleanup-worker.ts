import type { Pool } from "pg";

import { cleanupPrivacyRetention } from "./privacy-retention-cleanup-service";
import { formatUnknownError, type Logger } from "../shared/logger";

export type PrivacyRetentionCleanupWorkerConfig = {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
};

export type PrivacyRetentionCleanupWorkerHandle = {
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

export function readPrivacyRetentionCleanupWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): PrivacyRetentionCleanupWorkerConfig {
  return {
    enabled: readBooleanEnv(env, "PRIVACY_RETENTION_CLEANUP_WORKER_ENABLED", true),
    intervalMs: readPositiveIntegerEnv(
      env,
      "PRIVACY_RETENTION_CLEANUP_WORKER_INTERVAL_MS",
      24 * 60 * 60 * 1000
    ),
    startupDelayMs: readPositiveIntegerEnv(
      env,
      "PRIVACY_RETENTION_CLEANUP_WORKER_STARTUP_DELAY_MS",
      120_000
    )
  };
}

export function startPrivacyRetentionCleanupWorker(input: {
  dbPool: Pool;
  logger: Logger;
  config: PrivacyRetentionCleanupWorkerConfig;
}): PrivacyRetentionCleanupWorkerHandle | null {
  if (!input.config.enabled) {
    input.logger.info("privacy_retention_cleanup_worker.disabled");
    return null;
  }

  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  async function runOnce(): Promise<void> {
    if (running) {
      input.logger.warn("privacy_retention_cleanup_worker.tick_skipped", {
        reason: "previous_tick_running"
      });
      return;
    }

    running = true;
    try {
      const result = await cleanupPrivacyRetention(input.dbPool, {
        execute: true
      });
      input.logger.info("privacy_retention_cleanup_worker.tick_completed", {
        counts: result.counts
      });
    } catch (error) {
      input.logger.error("privacy_retention_cleanup_worker.tick_failed", {
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
  input.logger.info("privacy_retention_cleanup_worker.started", {
    intervalMs: input.config.intervalMs,
    startupDelayMs: input.config.startupDelayMs
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
