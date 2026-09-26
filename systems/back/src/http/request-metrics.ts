type RequestMetric = {
  atMs: number;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
};

type LatencySummary = {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
};

type WindowSummary = {
  windowMs: number;
  requestCount: number;
  error5xxCount: number;
  error4xxCount: number;
  errorRate5xx: number;
  latency: LatencySummary;
  history: LatencySummary;
};

const MAX_METRICS = 2_000;
const metrics: RequestMetric[] = [];

function percentile(sorted: number[], percentileValue: number): number | null {
  if (sorted.length === 0) {
    return null;
  }

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  );

  return Number(sorted[index].toFixed(1));
}

function summarizeLatency(rows: RequestMetric[]): LatencySummary {
  const durations = rows.map((row) => row.durationMs).sort((left, right) => left - right);

  return {
    count: durations.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations.length ? Number(durations[durations.length - 1].toFixed(1)) : null
  };
}

function summarizeWindow(windowMs: number, nowMs: number): WindowSummary {
  const cutoff = nowMs - windowMs;
  const rows = metrics.filter((row) => row.atMs >= cutoff);
  const error5xxCount = rows.filter((row) => row.statusCode >= 500).length;
  const historyRows = rows.filter((row) => row.path.includes("/history"));

  return {
    windowMs,
    requestCount: rows.length,
    error5xxCount,
    error4xxCount: rows.filter((row) => row.statusCode >= 400 && row.statusCode < 500).length,
    errorRate5xx: rows.length ? Number((error5xxCount / rows.length).toFixed(4)) : 0,
    latency: summarizeLatency(rows),
    history: summarizeLatency(historyRows)
  };
}

export function recordRequestMetric(metric: Omit<RequestMetric, "atMs">): void {
  metrics.push({
    ...metric,
    atMs: Date.now()
  });

  if (metrics.length > MAX_METRICS) {
    metrics.splice(0, metrics.length - MAX_METRICS);
  }
}

export function readRequestMetricsSnapshot(nowMs = Date.now()) {
  return {
    retained: metrics.length,
    maxRetained: MAX_METRICS,
    windows: {
      oneMinute: summarizeWindow(60_000, nowMs),
      fiveMinutes: summarizeWindow(5 * 60_000, nowMs)
    }
  };
}

export function resetRequestMetricsForTest(): void {
  metrics.splice(0, metrics.length);
}
