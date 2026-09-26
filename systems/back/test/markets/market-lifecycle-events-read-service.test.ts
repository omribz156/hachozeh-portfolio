import { describe, expect, it } from "vitest";

import { readMarketLifecycleEvents } from "../../src/markets/market-lifecycle-events-read-service";

function buildMarketRow(overrides: Record<string, unknown> = {}) {
  return {
    market_id: "market_alpha",
    market_status: "closed",
    persisted_status: "open",
    title: "Lifecycle market",
    category_key: "politics",
    open_at: new Date("2026-05-01T10:00:00.000Z"),
    close_at: new Date("2026-05-02T10:00:00.000Z"),
    published_at: new Date("2026-05-01T10:05:00.000Z"),
    updated_at: new Date("2026-05-02T10:10:00.000Z"),
    settlement_status: null,
    market_resolved_at: null,
    market_contract: {
      objectType: "market_contract_v1",
      timeline: {
        expectedResolutionAt: "2026-05-02T12:00:00.000Z"
      },
      payoutPolicy: {
        kind: "after_resolution",
        label: "After official resolution"
      }
    },
    ...overrides
  };
}

describe("readMarketLifecycleEvents", () => {
  it("returns ordered public lifecycle events with sanitized payloads", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const db = {
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });

        if (sql.includes("from markets m")) {
          return {
            rows: [buildMarketRow()]
          };
        }

        if (sql.includes("from lifecycle_events")) {
          return {
            rows: [
              {
                id: "lifevt_close",
                event_type: "market_closed",
                source_system: "horizon",
                actor_id: "system:horizon",
                occurred_at: new Date("2026-05-02T10:00:00.000Z"),
                correlation_id: "close-key",
                audit_event_id: "audit_close",
                oracle_case_id: null,
                resolution_id: null,
                payload: {
                  reason: "close_at_reached",
                  closedAt: "2026-05-02T10:00:00.000Z",
                  sourceSnapshot: { private: true },
                  token: "secret"
                },
                created_at: new Date("2026-05-02T10:00:01.000Z")
              },
              {
                id: "lifevt_observed",
                event_type: "operator_observed_outcome",
                source_system: "admin",
                actor_id: "user_private_operator",
                occurred_at: new Date("2026-05-02T10:05:00.000Z"),
                correlation_id: "observe-key",
                audit_event_id: null,
                oracle_case_id: "orc_1",
                resolution_id: null,
                payload: {
                  objectType: "operator_observed_outcome_payload",
                  summary: "Operator saw official result.",
                  sourceUrl: "https://example.com/result",
                  note: "Visible note",
                  internalUserId: "user_private_operator"
                },
                created_at: new Date("2026-05-02T10:05:01.000Z")
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    const payload = await readMarketLifecycleEvents(db, "market_alpha", {
      limit: "200",
      order: "asc"
    });

    expect(payload).toMatchObject({
      marketKey: "market_alpha",
      marketId: "market_alpha",
      marketStatus: "closed",
      order: "asc",
      limit: 100,
      count: 2,
      lifecycle: {
        persistedStatus: "open",
        effectiveStatus: "closed",
        expectedResolutionAt: "2026-05-02T12:00:00.000Z",
        payoutPolicy: {
          kind: "after_resolution",
          label: "After official resolution"
        }
      }
    });
    expect(payload?.events).toEqual([
      {
        id: "lifevt_close",
        type: "market_closed",
        occurredAt: "2026-05-02T10:00:00.000Z",
        createdAt: "2026-05-02T10:00:01.000Z",
        source: {
          system: "horizon"
        },
        actor: {
          kind: "system",
          label: "horizon"
        },
        payload: {
          reason: "close_at_reached",
          closedAt: "2026-05-02T10:00:00.000Z"
        }
      },
      {
        id: "lifevt_observed",
        type: "operator_observed_outcome",
        occurredAt: "2026-05-02T10:05:00.000Z",
        createdAt: "2026-05-02T10:05:01.000Z",
        source: {
          system: "admin"
        },
        actor: {
          kind: "operator",
          label: "operator"
        },
        payload: {
          objectType: "operator_observed_outcome_payload",
          summary: "Operator saw official result.",
          sourceUrl: "https://example.com/result",
          note: "Visible note"
        }
      }
    ]);
    expect(queries[0].values).toEqual(["market_alpha"]);
    expect(queries[1].values).toEqual(["market_alpha", 100]);
    expect(JSON.stringify(payload)).not.toContain("close-key");
    expect(JSON.stringify(payload)).not.toContain("audit_close");
    expect(JSON.stringify(payload)).not.toContain("orc_1");
  });

  it("drops unsafe public URL fields from historical lifecycle payloads", async () => {
    const db = {
      query: async (sql: string) => {
        if (sql.includes("from markets m")) {
          return {
            rows: [buildMarketRow()]
          };
        }

        if (sql.includes("from lifecycle_events")) {
          return {
            rows: [
              {
                id: "lifevt_unsafe_source",
                event_type: "operator_observed_outcome",
                source_system: "admin",
                actor_id: "user_private_operator",
                occurred_at: new Date("2026-05-02T10:05:00.000Z"),
                correlation_id: "observe-key",
                audit_event_id: null,
                oracle_case_id: "orc_1",
                resolution_id: null,
                payload: {
                  objectType: "operator_observed_outcome_payload",
                  summary: "Operator saw official result.",
                  sourceUrl: "javascript:alert(1)",
                  officialJsonUrl: "http://example.com/feed.json",
                  sourceLabel: "Official source"
                },
                created_at: new Date("2026-05-02T10:05:01.000Z")
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    const payload = await readMarketLifecycleEvents(db, "market_alpha");

    expect(payload?.events[0]?.payload).toEqual({
      objectType: "operator_observed_outcome_payload",
      summary: "Operator saw official result.",
      sourceLabel: "Official source"
    });
  });

  it("returns null for unknown markets", async () => {
    const db = {
      query: async () => ({ rows: [] })
    };

    await expect(readMarketLifecycleEvents(db, "missing")).resolves.toBeNull();
  });
});
