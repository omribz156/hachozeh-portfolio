import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

import { insertLedgerTransactionWithEntries } from "../../../src/engine/trading/ledger-writes";
import { hashStablePayload } from "../../../src/shared/stable-hash";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LedgerEntry = {
  id: string;
  transactionId: string;
  accountId: string;
  amount: string;
  entryRole: string;
};

type LedgerTransaction = {
  id: string;
  sequenceNumber: number;
  type: string;
  previousTransactionHash: string;
  transactionHash: string;
  tradeSide: string;
  tradePriceBefore: string;
  tradePriceAfter: string;
};

function createLedgerClient(headRow?: { sequence_number: string; transaction_hash: string }) {
  const transactions: LedgerTransaction[] = [];
  const entries: LedgerEntry[] = [];

  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      // Advisory lock
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [], rowCount: 0 };
      }

      // Read ledger head
      if (sql.includes("order by sequence_number desc")) {
        return {
          rows: headRow ? [headRow] : [],
          rowCount: headRow ? 1 : 0
        };
      }

      // Insert ledger transaction
      if (sql.includes("insert into ledger_transactions")) {
        const v = values as unknown[];
        transactions.push({
          id: String(v[0]),
          sequenceNumber: Number(v[1]),
          type: String(v[2]),
          tradeSide: String(v[8]),
          tradePriceBefore: String(v[9]),
          tradePriceAfter: String(v[10]),
          previousTransactionHash: String(v[11]),
          transactionHash: String(v[12])
        });
        return { rows: [], rowCount: 1 };
      }

      // Insert ledger entry
      if (sql.includes("insert into ledger_entries")) {
        const v = values as unknown[];
        entries.push({
          id: String(v[0]),
          transactionId: String(v[1]),
          accountId: String(v[2]),
          amount: String(v[3]),
          entryRole: String(v[4])
        });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    }),
    release: vi.fn()
  } as unknown as PoolClient;

  return { client, transactions, entries };
}

const BASE_PARAMS = {
  tradeId: "trade_abc123",
  actorId: "user_1",
  marketId: "market_1",
  outcomeId: "outcome_yes",
  idempotencyKey: "idem_key_1",
  amount: "25.000000",
  priceBefore: "0.50000000",
  priceAfter: "0.52000000",
  userCashAccountId: "account_user_cash",
  marketTreasuryAccountId: "account_market_treasury"
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("insertLedgerTransactionWithEntries", () => {
  it("buy: debit user cash and credit market treasury amounts balance to zero", async () => {
    const { client, entries } = createLedgerClient();

    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "buy" });

    expect(entries).toHaveLength(2);

    const debit = entries.find((e) => e.entryRole === "debit_user_cash");
    const credit = entries.find((e) => e.entryRole === "credit_market_treasury");

    expect(debit).toBeDefined();
    expect(credit).toBeDefined();

    // Amounts must be equal in magnitude and opposite in sign → sum = 0
    const sum = Number(debit!.amount) + Number(credit!.amount);
    expect(sum).toBeCloseTo(0, 6);
  });

  it("sell: debit market treasury and credit user cash amounts balance to zero", async () => {
    const { client, entries } = createLedgerClient();

    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "sell" });

    expect(entries).toHaveLength(2);

    const debit = entries.find((e) => e.entryRole === "debit_market_treasury");
    const credit = entries.find((e) => e.entryRole === "credit_user_cash");

    expect(debit).toBeDefined();
    expect(credit).toBeDefined();

    const sum = Number(debit!.amount) + Number(credit!.amount);
    expect(sum).toBeCloseTo(0, 6);
  });

  it("buy: debit amount equals -amount and credit amount equals +amount exactly", async () => {
    const { client, entries } = createLedgerClient();

    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "buy" });

    const debit = entries.find((e) => e.entryRole === "debit_user_cash")!;
    const credit = entries.find((e) => e.entryRole === "credit_market_treasury")!;

    expect(debit.amount).toBe("-25.000000");
    expect(credit.amount).toBe("25.000000");
  });

  it("sell: debit amount equals -amount and credit amount equals +amount exactly", async () => {
    const { client, entries } = createLedgerClient();

    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "sell" });

    const debit = entries.find((e) => e.entryRole === "debit_market_treasury")!;
    const credit = entries.find((e) => e.entryRole === "credit_user_cash")!;

    expect(debit.amount).toBe("-25.000000");
    expect(credit.amount).toBe("25.000000");
  });

  it("chained-hash: transaction hash matches independently recomputed value (genesis head)", async () => {
    const { client, transactions, entries } = createLedgerClient();
    // No head row → previousTransactionHash = "GENESIS", sequenceNumber = 1

    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "buy" });

    expect(transactions).toHaveLength(1);
    const tx = transactions[0]!;

    // Recompute the expected hash exactly as the source does
    const sortedEntries = entries
      .map((e) => ({
        accountId: e.accountId,
        amount: e.amount,
        entryRole: e.entryRole
      }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    const expectedHash = hashStablePayload({
      sequenceNumber: 1,
      previousTransactionHash: "GENESIS",
      type: "trade_buy",
      referenceType: "trade",
      referenceId: BASE_PARAMS.tradeId,
      idempotencyKey: BASE_PARAMS.idempotencyKey,
      marketId: BASE_PARAMS.marketId,
      outcomeId: BASE_PARAMS.outcomeId,
      triggeredBy: "user",
      triggeredById: BASE_PARAMS.actorId,
      tradeSide: "buy",
      tradePriceBefore: BASE_PARAMS.priceBefore,
      tradePriceAfter: BASE_PARAMS.priceAfter,
      entries: sortedEntries
    });

    expect(tx.transactionHash).toBe(expectedHash);
  });

  it("chained-hash: previous hash is threaded correctly when a head row exists", async () => {
    const existingHash = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    const { client, transactions, entries } = createLedgerClient({
      sequence_number: "7",
      transaction_hash: existingHash
    });

    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "sell" });

    expect(transactions).toHaveLength(1);
    const tx = transactions[0]!;

    expect(tx.previousTransactionHash).toBe(existingHash);
    expect(tx.sequenceNumber).toBe(8);

    const sortedEntries = entries
      .map((e) => ({
        accountId: e.accountId,
        amount: e.amount,
        entryRole: e.entryRole
      }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    const expectedHash = hashStablePayload({
      sequenceNumber: 8,
      previousTransactionHash: existingHash,
      type: "trade_sell",
      referenceType: "trade",
      referenceId: BASE_PARAMS.tradeId,
      idempotencyKey: BASE_PARAMS.idempotencyKey,
      marketId: BASE_PARAMS.marketId,
      outcomeId: BASE_PARAMS.outcomeId,
      triggeredBy: "user",
      triggeredById: BASE_PARAMS.actorId,
      tradeSide: "sell",
      tradePriceBefore: BASE_PARAMS.priceBefore,
      tradePriceAfter: BASE_PARAMS.priceAfter,
      entries: sortedEntries
    });

    expect(tx.transactionHash).toBe(expectedHash);
  });

  it("chained-hash: flipped sign on amount produces a different hash", async () => {
    const { client: clientA, transactions: txA, entries: entriesA } = createLedgerClient();
    await insertLedgerTransactionWithEntries(clientA, { ...BASE_PARAMS, side: "buy" });

    // Manually compute what the hash would be if the debit entry had a positive sign
    const tamperedEntries = entriesA
      .map((e) => ({
        accountId: e.accountId,
        amount: e.entryRole === "debit_user_cash" ? BASE_PARAMS.amount : e.amount, // wrong sign
        entryRole: e.entryRole
      }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    const tamperedHash = hashStablePayload({
      sequenceNumber: 1,
      previousTransactionHash: "GENESIS",
      type: "trade_buy",
      referenceType: "trade",
      referenceId: BASE_PARAMS.tradeId,
      idempotencyKey: BASE_PARAMS.idempotencyKey,
      marketId: BASE_PARAMS.marketId,
      outcomeId: BASE_PARAMS.outcomeId,
      triggeredBy: "user",
      triggeredById: BASE_PARAMS.actorId,
      tradeSide: "buy",
      tradePriceBefore: BASE_PARAMS.priceBefore,
      tradePriceAfter: BASE_PARAMS.priceAfter,
      entries: tamperedEntries
    });

    expect(txA[0]!.transactionHash).not.toBe(tamperedHash);
  });

  it("chained-hash: wrong amount value produces a different hash", async () => {
    const { client, transactions, entries } = createLedgerClient();
    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "buy" });

    // Replace the credit amount with a different value
    const tamperedEntries = entries
      .map((e) => ({
        accountId: e.accountId,
        amount: e.entryRole === "credit_market_treasury" ? "99.000000" : e.amount,
        entryRole: e.entryRole
      }))
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    const tamperedHash = hashStablePayload({
      sequenceNumber: 1,
      previousTransactionHash: "GENESIS",
      type: "trade_buy",
      referenceType: "trade",
      referenceId: BASE_PARAMS.tradeId,
      idempotencyKey: BASE_PARAMS.idempotencyKey,
      marketId: BASE_PARAMS.marketId,
      outcomeId: BASE_PARAMS.outcomeId,
      triggeredBy: "user",
      triggeredById: BASE_PARAMS.actorId,
      tradeSide: "buy",
      tradePriceBefore: BASE_PARAMS.priceBefore,
      tradePriceAfter: BASE_PARAMS.priceAfter,
      entries: tamperedEntries
    });

    expect(transactions[0]!.transactionHash).not.toBe(tamperedHash);
  });

  it("buy: debit goes to user cash account, credit goes to market treasury account", async () => {
    const { client, entries } = createLedgerClient();

    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "buy" });

    const debit = entries.find((e) => e.entryRole === "debit_user_cash")!;
    const credit = entries.find((e) => e.entryRole === "credit_market_treasury")!;

    expect(debit.accountId).toBe(BASE_PARAMS.userCashAccountId);
    expect(credit.accountId).toBe(BASE_PARAMS.marketTreasuryAccountId);
  });

  it("sell: debit goes to market treasury account, credit goes to user cash account", async () => {
    const { client, entries } = createLedgerClient();

    await insertLedgerTransactionWithEntries(client, { ...BASE_PARAMS, side: "sell" });

    const debit = entries.find((e) => e.entryRole === "debit_market_treasury")!;
    const credit = entries.find((e) => e.entryRole === "credit_user_cash")!;

    expect(debit.accountId).toBe(BASE_PARAMS.marketTreasuryAccountId);
    expect(credit.accountId).toBe(BASE_PARAMS.userCashAccountId);
  });
});
