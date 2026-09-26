import { createPortfolioStreamBus } from "./portfolio-stream-bus";

function readStreamLimit(name: string, fallback: number): number {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallback;
  }

  return parsedValue;
}

export const DEFAULT_PORTFOLIO_STREAM_BUS = createPortfolioStreamBus({
  maxConnectionsPerActor: readStreamLimit("PORTFOLIO_STREAM_MAX_CONNECTIONS_PER_ACTOR", 10),
  maxTotalConnections: readStreamLimit("PORTFOLIO_STREAM_MAX_TOTAL_CONNECTIONS", 1000)
});
