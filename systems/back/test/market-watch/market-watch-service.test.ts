import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectShowOfficialKeywordSignals,
  defaultMarketWatchFetch,
  scanDueMarketWatchPlans,
  type MarketWatchPlan
} from "../../src/market-watch/service";
import { buildMarketWatchMessage } from "../../src/market-watch/notifier";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(response: Response): void {
  globalThis.fetch = vi.fn(async () => response) as typeof fetch;
}

function mockFetchSequence(responses: Response[]): void {
  let index = 0;
  globalThis.fetch = vi.fn(async () => responses[Math.min(index++, responses.length - 1)]) as typeof fetch;
}

function createAbortAwareMockFetch(handler: (url: string | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = vi.fn(async (url, init) => handler(url as string | URL, init)) as typeof fetch;
}

function plan(overrides: Partial<MarketWatchPlan> = {}): MarketWatchPlan {
  return {
    id: "mwp_test",
    marketId: null,
    eventId: "evt_test",
    checkerKind: "show_official_keywords",
    enabled: true,
    timezone: "Asia/Jerusalem",
    runPolicy: { proximityChars: 120 },
    nextRunAt: "2026-07-01T20:00:00.000Z",
    sourceUrls: ["https://example.test/show"],
    entities: ["נועה כהן", "עדן גולן"],
    keywords: ["הודחה", "הזוכה"],
    lastCheckedAt: null,
    lastAlertFingerprint: null,
    note: null,
    ...overrides
  };
}

describe("market watch show official keyword checker", () => {
  it("creates a signal when a watched entity appears near a watched keyword", () => {
    const signals = detectShowOfficialKeywordSignals({
      plan: plan(),
      sourceUrl: "https://example.test/show",
      observedAt: "2026-07-01T20:00:00.000Z",
      html: `
        <html>
          <head><title>רוקדים עם כוכבים</title></head>
          <body>
            אחרי ערב מותח, נועה כהן הודחה מרוקדים עם כוכבים.
          </body>
        </html>
      `
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      signalKind: "keyword_match",
      matchedEntity: "נועה כהן",
      matchedKeyword: "הודחה",
      sourceUrl: "https://example.test/show",
      sourceTitle: "רוקדים עם כוכבים"
    });
    expect(signals[0]?.fingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  it("does not create a signal when entity and keyword are too far apart", () => {
    const signals = detectShowOfficialKeywordSignals({
      plan: plan({ runPolicy: { proximityChars: 20 } }),
      sourceUrl: "https://example.test/show",
      observedAt: "2026-07-01T20:00:00.000Z",
      html: `<html><head><title>עדכון התוכנית</title></head><body><p>נועה כהן ${"x".repeat(220)} הודחה</p></body></html>`
    });

    expect(signals).toHaveLength(0);
  });

  it("does not bleed roster status across adjacent official show cards", () => {
    const signals = detectShowOfficialKeywordSignals({
      plan: plan({
        entities: ["שירי מימון ורפאל פליישמן", "מיה דגן ושחר זיסמנוביץ'"],
        keywords: ["הודחו"],
        runPolicy: { proximityChars: 180 }
      }),
      sourceUrl: "https://example.test/show",
      observedAt: "2026-07-01T20:00:00.000Z",
      html: `
        <ul>
          <li><a><h3>שירי מימון ורפאל פליישמן</h3></a></li>
          <li><a><i>הודחו</i><h3>מיה דגן ושחר זיסמנוביץ'</h3></a></li>
        </ul>
      `
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      matchedEntity: "מיה דגן ושחר זיסמנוביץ'",
      matchedKeyword: "הודחו"
    });
  });

  it("collapses overlapping entity aliases and keyword stems into one signal", () => {
    const signals = detectShowOfficialKeywordSignals({
      plan: plan({
        entities: ["מיה דגן ושחר זיסמנוביץ'", "מיה דגן"],
        keywords: ["הודח", "הודחו"]
      }),
      sourceUrl: "https://example.test/show",
      observedAt: "2026-07-01T20:00:00.000Z",
      html: `<article>מיה דגן ושחר זיסמנוביץ' הודחו מהתחרות.</article>`
    });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      matchedEntity: "מיה דגן ושחר זיסמנוביץ'",
      matchedKeyword: "הודחו"
    });
  });

  it("builds an operator ping without market mutation language", () => {
    const message = buildMarketWatchMessage({
      planId: "mwp_test",
      summary: `Possible watch signal: "הודחה" near "נועה כהן".`,
      sourceUrl: "https://example.test/show",
      suggestedHumanPrompt: "check market watch signal mws_test"
    });

    expect(message).toContain("market watch ping");
    expect(message).toContain("Paste to Codex: check market watch signal mws_test");
    expect(message).not.toContain("resolve now");
    expect(message).not.toContain("settle");

    const caseReadyMessage = buildMarketWatchMessage({
      kind: "market_case_ready",
      planId: "mwp_test",
      summary: "market case ready: נועה כהן requires close-condition review.",
      sourceUrl: "https://example.test/show",
      suggestedHumanPrompt: "review Oracle close-condition case orc_test"
    });
    expect(caseReadyMessage).toContain("Hachozeh: market case ready");
    expect(caseReadyMessage).not.toContain("market watch ping");
  });

  it("rejects non-https, credentialed, and private URLs before fetch", async () => {
    await expect(defaultMarketWatchFetch("http://api.example.test/result")).rejects.toThrow(/must use https/);
    await expect(defaultMarketWatchFetch("https://user:pass@api.example.test/result")).rejects.toThrow(
      /must not include credentials/
    );
    await expect(defaultMarketWatchFetch("https://127.0.0.1/result")).rejects.toThrow(/blocked network/);
  });

  it("follows a relative redirect and enforces final URL checks", async () => {
    mockFetchSequence([
      new Response("", {
        status: 302,
        headers: {
          location: "/result?page=2"
        }
      }),
      new Response("market-watch-page")
    ]);

    const payload = await defaultMarketWatchFetch("https://203.0.113.10/result?page=1");
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe(200);
    expect(payload.text).toBe("market-watch-page");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("blocks public-to-private redirected URLs", async () => {
    mockFetchSequence([
      new Response("", {
        status: 302,
        headers: {
          location: "https://10.0.0.5/result"
        }
      }),
      new Response("ok")
    ]);

    await expect(defaultMarketWatchFetch("https://203.0.113.10/result")).rejects.toThrow(/blocked network/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects redirect loops after hop limit", async () => {
    mockFetchSequence([
      new Response("", {
        status: 302,
        headers: {
          location: "/result?page=2"
        }
      })
    ]);

    await expect(
      defaultMarketWatchFetch("https://203.0.113.10/result?page=1")
    ).rejects.toThrow(/exceeded redirect limit/);
  });

  it("shares timeout budget across redirect hops", async () => {
    const timeoutMs = 40;

    createAbortAwareMockFetch(async (_url, init) => {
      if ((globalThis.fetch as { mock: { calls: unknown[] } }).mock.calls.length === 1) {
        return new Response("", {
          status: 302,
          headers: {
            location: "https://203.0.113.10/slow"
          }
        });
      }

      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }

        const timeout = setTimeout(() => {
          reject(new Error("timeout"));
        }, timeoutMs * 2);

        if (signal.aborted) {
          clearTimeout(timeout);
          reject(signal.reason as Error);
          return;
        }

        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(signal.reason as Error);
        }, { once: true });
      });
    });

    await expect(defaultMarketWatchFetch("https://203.0.113.10/result", { timeoutMs })).rejects.toBeTruthy();
  });

  it("cancels redirect response body when redirect location is missing", async () => {
    const cancelSpy = vi.spyOn(ReadableStream.prototype, "cancel").mockResolvedValue(undefined);
    mockFetch(new Response("gone", { status: 302 }));

    await expect(defaultMarketWatchFetch("https://203.0.113.10/result")).rejects.toThrow(/missing redirect location/);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    cancelSpy.mockRestore();
  });

  it("rejects when hostname DNS lookup exceeds deadline", async () => {
    const timeoutMs = 20;
    const lookup = vi.fn(async (_hostname: string, _init: { all: true }) => {
      if (lookup.mock.calls.length === 1) {
        return [{ address: "203.0.113.10", family: 4 }];
      }

      return new Promise(() => {});
    });

    mockFetchSequence([
      new Response("", {
        status: 302,
        headers: {
          location: "/result"
        }
      })
    ]);

    await expect(
      defaultMarketWatchFetch("https://market-watch.example.test/result", {
        timeoutMs,
        lookup
      })
    ).rejects.toThrow("Market Watch fetch request timed out.");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("rejects declared and streamed oversized responses", async () => {
    mockFetch(new Response("{}", {
      headers: {
        "content-length": "2000001"
      }
    }));

    await expect(defaultMarketWatchFetch("https://203.0.113.10/result")).rejects.toThrow(/too large/);

    mockFetch(new Response("a".repeat(1_000_001)));
    await expect(defaultMarketWatchFetch("https://203.0.113.10/result")).rejects.toThrow(/too large/);
  });

  it("promotes a new elimination signal and points the ping at its Oracle case", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes("from market_watch_plans")) {
          return {
            rows: [{
              id: "mwp_test",
              market_id: null,
              event_id: "evt_test",
              checker_kind: "show_official_keywords",
              enabled: true,
              timezone: "Asia/Jerusalem",
              run_policy: { intervalMinutes: 1440, proximityChars: 120 },
              next_run_at: new Date("2026-07-13T20:00:00.000Z"),
              source_urls: ["https://example.test/show"],
              entities: ["נועה כהן"],
              keywords: ["הודחה"],
              last_checked_at: null,
              last_alert_fingerprint: null,
              note: null
            }],
            rowCount: 1
          };
        }
        if (sql.includes("insert into market_watch_signals")) {
          return {
            rows: [{
              id: "mws_test",
              fingerprint: String(params?.[10]),
              status: "new",
              oracle_case_id: null
            }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 1 };
      })
    };
    const casePromoter = vi.fn(async () => ({
      status: "promoted" as const,
      marketId: "market_noa",
      oracleCaseId: "orc_noa"
    }));
    const send = vi.fn(async () => undefined);

    const result = await scanDueMarketWatchPlans(db, {
      now: "2026-07-13T20:00:00.000Z",
      fetcher: async () => ({
        ok: true,
        status: 200,
        text: "<article>נועה כהן הודחה מהתחרות.</article>"
      }),
      casePromoter,
      notifier: { channel: "test", send }
    });

    expect(result.promotedCaseCount).toBe(1);
    expect(casePromoter).toHaveBeenCalledWith(expect.objectContaining({
      signalId: "mws_test",
      signal: expect.objectContaining({ matchedEntity: "נועה כהן" })
    }));
    expect(queries).toContainEqual(expect.objectContaining({
      sql: expect.stringContaining("oracle_case_id = $2"),
      params: ["mws_test", "orc_noa", null]
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      kind: "market_case_ready",
      summary: expect.stringContaining("market case ready"),
      suggestedHumanPrompt: "review Oracle close-condition case orc_noa"
    }));
  });
});
