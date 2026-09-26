import { describe, expect, it } from "vitest";

import {
  parseSupportTradeAuditArgs,
  readSupportTradeAudit,
  type SupportTradeAuditOptions
} from "../../src/scripts/support-trade-audit";

describe("support trade audit script", () => {
  it("requires a narrow support filter", () => {
    expect(() => parseSupportTradeAuditArgs(["--market=lapid"]))
      .toThrow("Provide at least one support filter");
  });

  it("normalizes handle and caps limit", () => {
    expect(parseSupportTradeAuditArgs([
      "--handle",
      "@Mr_Tam",
      "--market=disc-cm-israel-next-pm-yair-lapid-2026",
      "--limit=999",
      "--json"
    ])).toMatchObject({
      handle: "mr_tam",
      market: "disc-cm-israel-next-pm-yair-lapid-2026",
      limit: 200,
      json: true
    });
  });

  it("returns sanitized trade audit entries", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const options: SupportTradeAuditOptions = {
      email: "support-user@example.invalid",
      handle: null,
      userId: null,
      market: "disc-cm-israel-next-pm-yair-lapid-2026",
      requestId: null,
      tradeId: null,
      limit: 25,
      json: true
    };
    const db = {
      async query(sql: string, values?: unknown[]) {
        queries.push({ sql, values: values ?? [] });
        return {
          rows: [
            {
              audit_event_id: "audit_1",
              created_at: "2026-07-01T19:07:51.171Z",
              actor_id: "user_1",
              user_handle: "mr_tam",
              user_display_name: "ItamarTrades",
              trade_id: "trade_1",
              request_id: "req_1",
              market_key: "disc-cm-israel-next-pm-yair-lapid-2026",
              market_id: "market_lapid",
              side: "buy",
              contract_side: "no",
              outcome_key: "no-outcome",
              outcome_id: "outcome_no",
              execution_outcome_key: "yes-outcome",
              execution_outcome_id: "outcome_yes",
              quote_id: "quote_1",
              average_price: "0.51",
              price_before: "0.50",
              price_after: "0.53",
              cash_spent: "350.00",
              shares_bought: "677.09",
              shares_sold: null,
              proceeds_received: null
            }
          ]
        };
      }
    };

    const report = await readSupportTradeAudit(db, options);

    expect(queries[0]?.values).toEqual([
      "support-user@example.invalid",
      null,
      null,
      true,
      "disc-cm-israel-next-pm-yair-lapid-2026",
      null,
      null,
      25
    ]);
    expect(JSON.stringify(report)).not.toContain("support-user@example.invalid");
    expect(report.entries[0]).toMatchObject({
      user: {
        actorId: "user_1",
        handle: "mr_tam",
        displayName: "ItamarTrades"
      },
      trade: {
        requestId: "req_1",
        contractSide: "no",
        requestedOutcomeKey: "no-outcome",
        executionOutcomeKey: "yes-outcome"
      }
    });
  });
});
