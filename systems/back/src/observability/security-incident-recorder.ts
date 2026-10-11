import type { TrafficSignal } from "../../../shared/security-traffic";
import type { Queryable } from "../db/client/pool";
import { insertAuditEvent } from "../shared/audit-events";

/** Fixed keys and a ten-minute write budget keep alert retries from growing the DB. */
export function createSecurityIncidentRecorder(
  db: Queryable,
  send: (signal: TrafficSignal) => Promise<boolean>,
  now = Date.now
) {
  const nextWrite = new Map<string, number>();
  return async (signal: TrafficSignal): Promise<boolean> => {
    const source = signal.source === "web" ? "web" : "backend";
    const kind = signal.kind === "recovery" ? "recovery" : "burst";
    const category = signal.category === "auth" ? "auth" : "requests";
    const key = `${source}:${category}:${kind}`;
    const time = now();
    const delivery = Promise.resolve().then(() => send(signal)).catch(() => false);
    if (time >= (nextWrite.get(key) ?? -Infinity)) {
      nextWrite.set(key, time + 600_000);
      try {
        await insertAuditEvent(db, {
          actorId: "system:security-monitor",
          action: "security.traffic.signal",
          entityType: "service",
          entityId: source,
          payload: {
            source, kind, category, requests: signal.requests,
            rejected: signal.rejected, windowSeconds: signal.windowSeconds,
            observedAt: new Date(time).toISOString(),
            revision: process.env.RENDER_GIT_COMMIT || "local"
          }
        });
      } catch {
        console.warn(JSON.stringify({ event: "security.incident.persist_failed", source, kind, category }));
      }
    }
    return delivery;
  };
}
