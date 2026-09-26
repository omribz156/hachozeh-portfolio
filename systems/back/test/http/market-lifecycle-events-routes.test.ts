import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

function buildMarketRow() {
  return {
    market_id: "market_alpha",
    market_status: "closed",
    persisted_status: "closed",
    title: "Lifecycle market",
    category_key: "politics",
    open_at: new Date("2026-05-01T10:00:00.000Z"),
    close_at: new Date("2026-05-02T10:00:00.000Z"),
    published_at: new Date("2026-05-01T10:05:00.000Z"),
    updated_at: new Date("2026-05-02T10:10:00.000Z"),
    settlement_status: null,
    market_resolved_at: null,
    market_contract: null
  };
}

describe("market lifecycle event routes", () => {
  it("returns public lifecycle timeline events for a market", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(values).toEqual(["market_alpha"]);
          return { rows: [buildMarketRow()] };
        }

        if (sql.includes("from lifecycle_events")) {
          expect(values).toEqual(["market_alpha", 2]);
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
                  sourceSnapshot: { hidden: true }
                },
                created_at: new Date("2026-05-02T10:00:01.000Z")
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(
      `${baseUrl}/api/markets/market_alpha/lifecycle-events?limit=2&order=asc`
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      marketKey: "market_alpha",
      marketId: "market_alpha",
      marketStatus: "closed",
      order: "asc",
      limit: 2,
      count: 1,
      events: [
        {
          id: "lifevt_close",
          type: "market_closed",
          source: {
            system: "horizon"
          },
          actor: {
            kind: "system",
            label: "horizon"
          },
          payload: {
            reason: "close_at_reached"
          }
        }
      ]
    });
    expect(payload.events[0].payload.sourceSnapshot).toBeUndefined();
  });

  it("returns market_not_found for unknown lifecycle timelines", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async () => ({ rows: [] })
    });

    const response = await fetch(`${baseUrl}/api/markets/nope/lifecycle-events`);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      error: {
        code: "market_not_found"
      }
    });
  });
});
