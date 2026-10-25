export type TrafficSignal = {
  source: "web" | "backend";
  kind: "burst" | "recovery";
  requests: number;
  rejected: number;
  windowSeconds: number;
  category?: "auth";
  notFound?: number;
  rateLimited?: number;
  serverErrors?: number;
};

/** Constant-space fixed windows; unsuccessful delivery does not consume cooldown. */
export function createTrafficMonitor(options: {
  source: TrafficSignal["source"];
  send: (signal: TrafficSignal) => Promise<boolean>;
  now?: () => number;
  threshold?: number;
  rejectionThreshold?: number;
  notFoundThreshold?: number;
  includeNotFoundInRejections?: boolean;
  windowMs?: number;
  cooldownMs?: number;
  retryMs?: number;
}) {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 60_000;
  let start = now();
  let requests = 0;
  let rejected = 0;
  let notFound = 0;
  let rateLimited = 0;
  let serverErrors = 0;
  let lastHot = 0;
  let incident = false;
  let lastSent = -Infinity;
  let lastAttempt = -Infinity;
  let pending: Promise<void> | null = null;
  let undeliveredBurst: TrafficSignal | null = null;
  function signal(kind: TrafficSignal["kind"]): TrafficSignal {
    return { source: options.source, kind, requests, rejected, notFound, rateLimited, serverErrors, windowSeconds: windowMs / 1000 };
  }
  function notify(kind: TrafficSignal["kind"]) {
    const time = now();
    if (pending || time - lastAttempt < (options.retryMs ?? 60_000)) return;
    if (kind === "burst" && incident && time - lastSent < (options.cooldownMs ?? 600_000)) return;
    lastAttempt = time;
    const snapshot = kind === "burst" && undeliveredBurst ? undeliveredBurst : signal(kind);
    pending = Promise.resolve().then(() => options.send(snapshot)).then((sent) => {
      if (sent) {
        lastSent = time; incident = kind === "burst";
        if (kind === "burst") undeliveredBurst = null;
      }
    }).catch(() => undefined).finally(() => { pending = null; });
  }
  function tick() {
    const time = now();
    if (time - start >= windowMs) { requests = 0; rejected = 0; notFound = 0; rateLimited = 0; serverErrors = 0; start = time; }
    if (undeliveredBurst) notify("burst");
    else if (incident && time - lastHot >= windowMs * 2) notify("recovery");
  }
  return {
    observe(status?: number) {
      tick();
      requests += 1;
      if (status !== undefined && (status === 429 || status === 404 || status >= 500)) rejected += 1;
      if (status === 404) notFound += 1;
      if (status === 429) rateLimited += 1;
      if (status !== undefined && status >= 500) serverErrors += 1;
      // Routine missing-path scans have their own budget; auth keeps its strict combined budget.
      const actionableRejections = rejected - (options.includeNotFoundInRejections ? 0 : notFound);
      if (requests >= (options.threshold ?? 600) || actionableRejections >= (options.rejectionThreshold ?? 100) || notFound >= (options.notFoundThreshold ?? 500)) {
        lastHot = now();
        // Keep one snapshot across idle windows when delivery fails.
        if (!incident) undeliveredBurst = signal("burst");
        notify("burst");
      }
    },
    tick,
    async drain() { await pending; },
    snapshot() { return { requests, rejected, incident, sending: pending !== null }; }
  };
}
