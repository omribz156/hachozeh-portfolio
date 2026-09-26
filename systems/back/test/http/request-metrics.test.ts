import { afterEach, describe, expect, it } from "vitest";

import {
  readRequestMetricsSnapshot,
  recordRequestMetric,
  resetRequestMetricsForTest
} from "../../src/http/request-metrics";

afterEach(() => {
  resetRequestMetricsForTest();
});

describe("request metrics", () => {
  it("summarizes recent 5xx and history latency", () => {
    const nowMs = Date.now();

    recordRequestMetric({
      method: "GET",
      path: "/api/markets/demo/history",
      statusCode: 200,
      durationMs: 120
    });
    recordRequestMetric({
      method: "GET",
      path: "/api/markets/demo/history",
      statusCode: 503,
      durationMs: 360
    });
    recordRequestMetric({
      method: "GET",
      path: "/api/markets/live-count",
      statusCode: 200,
      durationMs: 20
    });

    const snapshot = readRequestMetricsSnapshot(nowMs);

    expect(snapshot.windows.oneMinute.requestCount).toBe(3);
    expect(snapshot.windows.oneMinute.error5xxCount).toBe(1);
    expect(snapshot.windows.oneMinute.history.count).toBe(2);
    expect(snapshot.windows.oneMinute.history.p95Ms).toBe(360);
  });
});
