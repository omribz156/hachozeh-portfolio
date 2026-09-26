import { createAppServer } from "./http/app";
import { assertProductionInvariants, loadAppEnv } from "./config/env";
import { createDbPool } from "./db/client/pool";
import {
  readAccountDeletionErasureWorkerConfig,
  startAccountDeletionErasureWorker
} from "./auth/account-deletion-erasure-worker";
import {
  readPrivacyRetentionCleanupWorkerConfig,
  startPrivacyRetentionCleanupWorker
} from "./auth/privacy-retention-cleanup-worker";
import {
  prewarmTrendingMarketReads,
  readMarketReadPrewarmRuntimeConfig
} from "./markets/market-read-prewarm";
import type { Socket } from "node:net";

import { createLogger, formatUnknownError } from "./shared/logger";
import { DEFAULT_NOTIFICATION_STREAM_BUS } from "./http/default-notification-stream-bus";
import { DEFAULT_MARKET_STREAM_BUS } from "./http/default-market-stream-bus";
import { DEFAULT_PORTFOLIO_STREAM_BUS } from "./http/default-portfolio-stream-bus";
import { startNotificationListener } from "./notifications/notification-listener";
import { startMarketLifecycleListener } from "./http/market-lifecycle-listener";
import { assertProductionObjectStorageConfigured } from "./storage/object-storage-config";

const env = loadAppEnv();
assertProductionInvariants(env);
assertProductionObjectStorageConfigured();
const logger = createLogger(env.logLevel, {
  service: env.serviceName,
  environment: env.nodeEnv
});
const dbPool = createDbPool(env.db);

const server = createAppServer({
  env,
  logger,
  dbPool
});

// Track every open socket so shutdown can destroy any that don't drain in time. Long-lived
// SSE (discovery streams + keep-alive) otherwise keep server.close() pending forever, which is
// what made the grace timeout SIGKILL us on every deploy.
const activeSockets = new Set<Socket>();
server.on("connection", (socket: Socket) => {
  activeSockets.add(socket);
  socket.once("close", () => activeSockets.delete(socket));
});

let shuttingDown = false;
let shutdownTimeout: NodeJS.Timeout | null = null;

const SHUTDOWN_GRACE_MS = Number(process.env.BACKEND_SHUTDOWN_GRACE_MS ?? 5_000);
// After this, force-destroy any socket still open (discovery SSE + keep-alive the buses don't
// own) so server.close() can complete and we exit 0 instead of timing out. Well under the grace.
const SOCKET_DRAIN_MS = Number(process.env.BACKEND_SOCKET_DRAIN_MS ?? 1_500);
const marketReadPrewarmConfig = readMarketReadPrewarmRuntimeConfig(process.env, env.nodeEnv);
const accountDeletionErasureWorkerConfig = readAccountDeletionErasureWorkerConfig(process.env);
const privacyRetentionCleanupWorkerConfig = readPrivacyRetentionCleanupWorkerConfig(process.env);
let accountDeletionErasureWorker: ReturnType<typeof startAccountDeletionErasureWorker> = null;
let privacyRetentionCleanupWorker: ReturnType<typeof startPrivacyRetentionCleanupWorker> = null;
let notificationListener: ReturnType<typeof startNotificationListener> | null = null;
let marketLifecycleListener: ReturnType<typeof startMarketLifecycleListener> | null = null;

function clearShutdownTimeout(): void {
  if (!shutdownTimeout) {
    return;
  }

  clearTimeout(shutdownTimeout);
  shutdownTimeout = null;
}

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("server.stopping", { signal });
  accountDeletionErasureWorker?.stop();
  privacyRetentionCleanupWorker?.stop();
  notificationListener?.stop();
  marketLifecycleListener?.stop();

  // Gracefully end the long-lived SSE we own so server.close() can drain. Without this it
  // hangs on the streams until the grace timeout SIGKILLs the process (the recurring
  // server.stop_timeout). Discovery SSE + idle keep-alive are caught by the socket backstop.
  try {
    const endedStreams =
      DEFAULT_MARKET_STREAM_BUS.closeAll() +
      DEFAULT_PORTFOLIO_STREAM_BUS.closeAll() +
      DEFAULT_NOTIFICATION_STREAM_BUS.closeAll();
    logger.info("server.streams_closed", { signal, endedStreams });
  } catch (streamError) {
    logger.warn("server.stream_close_failed", {
      signal,
      error: formatUnknownError(streamError)
    });
  }

  const socketDestroyTimer = setTimeout(() => {
    for (const socket of activeSockets) {
      socket.destroy();
    }
  }, SOCKET_DRAIN_MS);
  socketDestroyTimer.unref();

  shutdownTimeout = setTimeout(() => {
    logger.error("server.stop_timeout", {
      signal,
      graceMs: SHUTDOWN_GRACE_MS
    });
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  shutdownTimeout.unref();

  server.close(async (error) => {
    clearTimeout(socketDestroyTimer);

    if (error) {
      clearShutdownTimeout();
      logger.error("server.stop_failed", { signal, error });
      process.exitCode = 1;
      return;
    }

    try {
      await dbPool.end();
      clearShutdownTimeout();
      logger.info("server.stopped", { signal });
    } catch (poolError) {
      clearShutdownTimeout();
      logger.error("server.stop_failed", { signal, error: poolError });
      process.exitCode = 1;
    }
  });
}

server.listen(env.port, env.host, () => {
  logger.info("server.started", {
    host: env.host,
    port: env.port
  });

  if (marketReadPrewarmConfig.enabled) {
    const prewarmTimer = setTimeout(() => {
      void prewarmTrendingMarketReads(dbPool, {
        limit: marketReadPrewarmConfig.limit,
        historyRange: marketReadPrewarmConfig.historyRange,
        logger: logger.child({ component: "market_read_prewarm" })
      }).catch((error) => {
        logger.warn("market_read_prewarm.failed", { error });
      });
    }, 0);

    prewarmTimer.unref();
  }

  accountDeletionErasureWorker = startAccountDeletionErasureWorker({
    dbPool,
    logger: logger.child({ component: "account_deletion_erasure_worker" }),
    config: accountDeletionErasureWorkerConfig
  });

  privacyRetentionCleanupWorker = startPrivacyRetentionCleanupWorker({
    dbPool,
    logger: logger.child({ component: "privacy_retention_cleanup_worker" }),
    config: privacyRetentionCleanupWorkerConfig
  });

  notificationListener = startNotificationListener({
    env,
    logger: logger.child({ component: "notification_listener" }),
    streamBus: DEFAULT_NOTIFICATION_STREAM_BUS
  });

  marketLifecycleListener = startMarketLifecycleListener({
    env,
    logger: logger.child({ component: "market_lifecycle_listener" }),
    dbPool
  });
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
