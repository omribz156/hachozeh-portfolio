import type { Pool } from "pg";

import type { RequestActor } from "../auth/actor-resolver";
import { DEFAULT_PORTFOLIO_STREAM_BUS } from "./default-portfolio-stream-bus";
import type { PortfolioStreamBus } from "./portfolio-stream-bus";

type PortfolioInvalidationContext = {
  dbPool: Pool;
  portfolioStreamBus?: PortfolioStreamBus;
};

export function broadcastPortfolioInvalidation(
  context: PortfolioInvalidationContext,
  options: {
    actor?: Pick<RequestActor, "actorId" | "mode"> | null;
    reason: "trade" | "claim" | "settlement" | "void";
    marketKey?: string;
    claimId?: string;
    broadcastAll?: boolean;
  }
): void {
  void context.dbPool;

  const streamBus = context.portfolioStreamBus ?? DEFAULT_PORTFOLIO_STREAM_BUS;
  const payload = {
    eventId: `portfolio:${options.reason}:${Date.now()}`,
    eventType: "portfolio.snapshot_invalidated",
    reason: options.reason,
    ...(options.marketKey ? { marketKey: options.marketKey } : {}),
    ...(options.claimId ? { claimId: options.claimId } : {}),
    at: new Date().toISOString()
  };

  if (options.broadcastAll) {
    streamBus.broadcastAll("portfolio.snapshot_invalidated", payload);
    return;
  }

  if (options.actor?.mode === "session") {
    streamBus.broadcastActor(options.actor.actorId, "portfolio.snapshot_invalidated", payload);
  }
}
