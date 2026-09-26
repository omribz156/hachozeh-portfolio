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

// Notifications reuse the generic per-actor SSE bus (byte-identical shape to the
// portfolio one): keyed by user id, broadcastActor pushes to that user's open bell
// streams. The Postgres LISTEN handler (notification-listener.ts) calls broadcastActor
// with the user_id carried in the NOTIFY payload. Caps are env-tunable at launch, matching
// the portfolio/market buses.
export const DEFAULT_NOTIFICATION_STREAM_BUS = createPortfolioStreamBus({
  maxConnectionsPerActor: readStreamLimit("NOTIFICATION_STREAM_MAX_CONNECTIONS_PER_ACTOR", 5),
  maxTotalConnections: readStreamLimit("NOTIFICATION_STREAM_MAX_TOTAL_CONNECTIONS", 1000)
});
