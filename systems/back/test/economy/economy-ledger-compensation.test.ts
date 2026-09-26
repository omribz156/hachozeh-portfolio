import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { insertEconomyTransferLedgerTransaction } from "../../src/economy/economy-ledger";

describe("economy compensating transfer", () => {
  it("links an adjustment to the original immutable ledger transaction", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("from ledger_transactions") && sql.includes("order by sequence_number")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("from accounts") && sql.includes("where id = $1")) {
          return { rows: [{
            id: params[0],
            type: params[0] === "market-cash" ? "market_treasury" : "user_cash",
            status: "active",
            balance_cached: params[0] === "market-cash" ? "5000.000000" : "100.000000"
          }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      })
    } as unknown as Queryable;

    await insertEconomyTransferLedgerTransaction(db, {
      type: "adjustment",
      referenceType: "known_result_trade_reversal",
      referenceId: "trade-1",
      idempotencyKey: "reverse:trade-1",
      createdBy: "operator",
      triggeredBy: "known_result_incident_repair",
      triggeredById: "operator",
      marketId: "market-1",
      outcomeId: "no",
      compensatesTransactionId: "ledger-original",
      compensationReason: "Known-result trade",
      sourceAccountId: "market-cash",
      sourceAccountType: "market_treasury",
      targetAccountId: "user-cash",
      targetAccountType: "user_cash",
      amount: "10.000000",
      sourceEntryRole: "debit_market_treasury_known_result_reversal",
      targetEntryRole: "credit_user_cash_known_result_reversal"
    });

    const insert = calls.find((call) => call.sql.includes("insert into ledger_transactions"));
    expect(insert?.sql).toContain("compensates_transaction_id");
    expect(insert?.params).toContain("ledger-original");
    expect(insert?.params).toContain("Known-result trade");
  });
});
