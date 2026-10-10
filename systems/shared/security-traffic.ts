export type TrafficSignal = {
  source: "web" | "backend";
  kind: "burst" | "recovery";
  requests: number;
  rejected: number;
  windowSeconds: number;
  category?: "auth";
};

/** Constant-space fixed windows; unsuccessful delivery does not consume cooldown. */
export function createTrafficMonitor(options: {
  source: TrafficSignal["source"];
  send: (signal: TrafficSignal) => Promise<boolean>;
  now?: () => number;
  threshold?: number;
  rejectionThreshold?: number;
  windowMs?: number;
  cooldownMs?: number;
  retryMs?: number;
}) {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 60_000;
  let start = now();
  let requests = 0;
  let rejected = 0;
  let lastHot = 0;
  let incident = false;
  let lastSent = -Infinity;
  let lastAttempt = -Infinity;
  let pending: Promise<void> | null = null;
  let undeliveredBurst: TrafficSignal | null = null;
  function notify(kind: TrafficSignal["kind"]) {
    const time = now();
    if (pending || time - lastAttempt < (options.retryMs ?? 60_000)) return;
    if (kind === "burst" && incident && time - lastSent < (options.cooldownMs ?? 600_000)) return;
    lastAttempt = time;
    const signal: TrafficSignal = kind === "burst" && undeliveredBurst ? undeliveredBurst : { source: options.source, kind, requests, rejected, windowSeconds: windowMs / 1000 };
    pending = Promise.resolve().then(() => options.send(signal)).then((sent) => {
      if (sent) {
        lastSent = time; incident = kind === "burst";
        if (kind === "burst") undeliveredBurst = null;
      }
    }).catch(() => undefined).finally(() => { pending = null; });
  }
  function tick() {
    const time = now();
    if (undeliveredBurst) notify("burst");
    else if (incident && time - lastHot >= windowMs * 2) notify("recovery");
    if (time - start >= windowMs) { requests = 0; rejected = 0; start = time; }
  }
  return {
    observe(status?: number) {
      tick();
      requests += 1;
      if (status !== undefined && (status === 429 || status === 404 || status >= 500)) rejected += 1;
      if (requests >= (options.threshold ?? 600) || rejected >= (options.rejectionThreshold ?? 100)) {
        lastHot = now();
        // Keep one snapshot across idle windows when delivery fails.
        if (!incident) undeliveredBurst = { source: options.source, kind: "burst", requests, rejected, windowSeconds: windowMs / 1000 };
        notify("burst");
      }
    },
    tick,
    async drain() { await pending; },
    snapshot() { return { requests, rejected, incident, sending: pending !== null }; }
  };
}
