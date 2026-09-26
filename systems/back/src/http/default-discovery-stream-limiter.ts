import { createDiscoveryStreamLimiter } from "./discovery-stream-limiter";

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

export const DEFAULT_DISCOVERY_STREAM_LIMITER = createDiscoveryStreamLimiter({
  maxConnectionsPerFeed: readStreamLimit("DISCOVERY_STREAM_MAX_CONNECTIONS_PER_FEED", 100),
  maxTotalConnections: readStreamLimit("DISCOVERY_STREAM_MAX_TOTAL_CONNECTIONS", 1000)
});
