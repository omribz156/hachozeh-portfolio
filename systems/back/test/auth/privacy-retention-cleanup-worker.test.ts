import { describe, expect, it, vi } from "vitest";

import {
  readPrivacyRetentionCleanupWorkerConfig,
  startPrivacyRetentionCleanupWorker
} from "../../src/auth/privacy-retention-cleanup-worker";
import { createLogger } from "../../src/shared/logger";

describe("privacy retention cleanup worker", () => {
  it("reads runtime config from env", () => {
    expect(readPrivacyRetentionCleanupWorkerConfig({
      PRIVACY_RETENTION_CLEANUP_WORKER_ENABLED: "false",
      PRIVACY_RETENTION_CLEANUP_WORKER_INTERVAL_MS: "1000",
      PRIVACY_RETENTION_CLEANUP_WORKER_STARTUP_DELAY_MS: "2000"
    })).toEqual({
      enabled: false,
      intervalMs: 1000,
      startupDelayMs: 2000
    });
  });

  it("does not start when disabled", () => {
    const handle = startPrivacyRetentionCleanupWorker({
      dbPool: {} as never,
      logger: createLogger("error"),
      config: {
        enabled: false,
        intervalMs: 1000,
        startupDelayMs: 1000
      }
    });

    expect(handle).toBeNull();
  });

  it("runs manually through the handle", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from users")) return { rows: [], rowCount: 0 };
      if (sql.trim().startsWith("select count")) return { rows: [{ count: "0" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const handle = startPrivacyRetentionCleanupWorker({
      dbPool: { query } as never,
      logger: createLogger("error"),
      config: {
        enabled: true,
        intervalMs: 60_000,
        startupDelayMs: 60_000
      }
    });

    expect(handle).not.toBeNull();
    await handle!.runNow();
    handle!.stop();

    expect(query).toHaveBeenCalledWith(expect.stringContaining("from otp_challenges"), [
      expect.any(String)
    ]);
  });
});
