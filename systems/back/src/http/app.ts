import type { Server } from "node:http";
import type { Pool } from "pg";

import type { AppEnv } from "../config/env";
import type { RateLimiter } from "./rate-limit";
import { type MarketStreamBus } from "./market-stream-bus";
import type { PortfolioStreamBus } from "./portfolio-stream-bus";
import type { DiscoveryStreamLimiter } from "./discovery-stream-limiter";
import type { StreamConnectionLimiter } from "./stream-connection-limiter";
import { formatUnknownError, type Logger } from "../shared/logger";
import { createFastifyApp } from "./fastify-app";

type AppContext = {
  env: AppEnv;
  logger: Logger;
  dbPool: Pool;
  rateLimiter?: RateLimiter;
  marketStreamBus?: MarketStreamBus;
  portfolioStreamBus?: PortfolioStreamBus;
  discoveryStreamLimiter?: DiscoveryStreamLimiter;
  streamConnectionLimiter?: StreamConnectionLimiter;
};

export function closeFastifyAppOnServerClose(
  server: Pick<Server, "once">,
  fastifyApp: { close(): Promise<void> },
  logger: Logger
): void {
  server.once("close", () => {
    void fastifyApp.close().catch((error) => {
      logger.warn("fastify_app.close_failed", {
        error: formatUnknownError(error)
      });
    });
  });
}

export function createAppServer(context: AppContext) {
  const app = createFastifyApp({
    ...context,
    requestLifecycle: true
  });
  const server = app.server;

  void Promise.resolve(app.ready()).catch((error: unknown) => {
    context.logger.error("fastify_app.ready_failed", {
      error: formatUnknownError(error)
    });
  });
  closeFastifyAppOnServerClose(server, app, context.logger);

  return server;
}
