import { createMarketStreamBus } from "./market-stream-bus";

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

export const DEFAULT_MARKET_STREAM_BUS = createMarketStreamBus({
  maxConnectionsPerMarket: readStreamLimit("MARKET_STREAM_MAX_CONNECTIONS_PER_MARKET", 50),
  maxTotalConnections: readStreamLimit("MARKET_STREAM_MAX_TOTAL_CONNECTIONS", 1000)
});
