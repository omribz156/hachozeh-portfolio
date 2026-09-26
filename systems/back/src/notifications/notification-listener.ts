import { Client } from "pg";

import type { AppEnv } from "../config/env";
import type { PortfolioStreamBus } from "../http/portfolio-stream-bus";
import { formatUnknownError, type Logger } from "../shared/logger";

const RECONNECT_MS = 2_000;

// One dedicated Postgres LISTEN connection, held in the API process. Migration 057
// makes every INSERT into user_notifications fire NOTIFY 'user_notification' <user_id>;
// we relay it as a 'notification.new' push on that user's bell SSE. Cross-process:
// works no matter which service inserted the row. A dropped connection auto-reconnects.
export function startNotificationListener(options: {
  env: AppEnv;
  logger: Logger;
  streamBus: PortfolioStreamBus;
}): { stop: () => void } {
  const { env, logger, streamBus } = options;
  let client: Client | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const dead = client;
    client = null;
    if (dead) {
      dead.removeAllListeners();
      dead.end().catch(() => {});
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RECONNECT_MS);
    reconnectTimer.unref?.();
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const next = new Client({
      host: env.db.host,
      port: env.db.port,
      database: env.db.name,
      user: env.db.user,
      password: env.db.password,
      application_name: "hachozeh-notify-listener"
    });
    client = next;
    next.on("notification", (message) => {
      if (message.channel !== "user_notification") return;
      const userId = message.payload;
      if (!userId) return;
      streamBus.broadcastActor(userId, "notification.new", {
        eventType: "notification.new",
        at: new Date().toISOString()
      });
    });
    next.on("error", (error) => {
      logger.warn("notification_listener.client_error", { error: formatUnknownError(error) });
      scheduleReconnect();
    });
    try {
      await next.connect();
      await next.query("listen user_notification");
      logger.info("notification_listener.listening");
    } catch (error) {
      logger.warn("notification_listener.connect_failed", { error: formatUnknownError(error) });
      scheduleReconnect();
    }
  }

  void connect();

  return {
    stop(): void {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const dead = client;
      client = null;
      if (dead) {
        dead.removeAllListeners();
        dead.end().catch(() => {});
      }
    }
  };
}
