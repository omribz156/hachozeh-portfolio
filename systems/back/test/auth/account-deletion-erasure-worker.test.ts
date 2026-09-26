import { describe, expect, it, vi } from "vitest";

import {
  readAccountDeletionErasureWorkerConfig,
  startAccountDeletionErasureWorker
} from "../../src/auth/account-deletion-erasure-worker";
import { createLogger } from "../../src/shared/logger";

describe("account deletion erasure worker", () => {
  it("reads bounded runtime config from env", () => {
    expect(readAccountDeletionErasureWorkerConfig({
      ACCOUNT_DELETION_ERASURE_WORKER_ENABLED: "false",
      ACCOUNT_DELETION_ERASURE_WORKER_INTERVAL_MS: "1000",
      ACCOUNT_DELETION_ERASURE_WORKER_STARTUP_DELAY_MS: "2000",
      ACCOUNT_DELETION_ERASURE_WORKER_LIMIT: "999"
    })).toEqual({
      enabled: false,
      intervalMs: 1000,
      startupDelayMs: 2000,
      limit: 500
    });
  });

  it("does not start when disabled", () => {
    const handle = startAccountDeletionErasureWorker({
      dbPool: {} as never,
      logger: createLogger("error"),
      config: {
        enabled: false,
        intervalMs: 1000,
        startupDelayMs: 1000,
        limit: 50
      }
    });

    expect(handle).toBeNull();
  });

  it("runs manually through the handle", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const pool = { query } as never;
    const handle = startAccountDeletionErasureWorker({
      dbPool: pool,
      logger: createLogger("error"),
      config: {
        enabled: true,
        intervalMs: 60_000,
        startupDelayMs: 60_000,
        limit: 3
      }
    });

    expect(handle).not.toBeNull();
    await handle!.runNow();
    handle!.stop();

    expect(query).toHaveBeenCalledWith(expect.stringContaining("from account_deletion_requests"), [
      expect.any(String),
      3
    ]);
  });
});
