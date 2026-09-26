import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { quantizeMoney, toDecimal } from "../../shared/decimals";
import { readLockedLedgerHead } from "../../shared/ledger-head";
import { hashStablePayload } from "../../shared/stable-hash";
import type { TradeSide } from "./trade-types";

export async function insertLedgerTransactionWithEntries(
  client: PoolClient,
  params: {
    tradeId: string;
    actorId: string;
    marketId: string;
    outcomeId: string;
    side: TradeSide;
    idempotencyKey: string;
    amount: string;
    priceBefore: string;
    priceAfter: string;
    userCashAccountId: string;
    marketTreasuryAccountId: string;
  }
): Promise<void> {
  const head = await readLockedLedgerHead(client);
  const nextSequenceNumber = head ? Number(head.sequence_number) + 1 : 1;
  const previousTransactionHash = head?.transaction_hash ?? "GENESIS";
  const ledgerTransactionId = `ledger_tx_${randomUUID()}`;
  const entryPairs =
    params.side === "buy"
      ? [
          {
            id: `ledger_entry_${randomUUID()}`,
            accountId: params.userCashAccountId,
            amount: quantizeMoney(toDecimal(params.amount).negated()),
            entryRole: "debit_user_cash"
          },
          {
            id: `ledger_entry_${randomUUID()}`,
            accountId: params.marketTreasuryAccountId,
            amount: params.amount,
            entryRole: "credit_market_treasury"
          }
        ]
      : [
          {
            id: `ledger_entry_${randomUUID()}`,
            accountId: params.marketTreasuryAccountId,
            amount: quantizeMoney(toDecimal(params.amount).negated()),
            entryRole: "debit_market_treasury"
          },
          {
            id: `ledger_entry_${randomUUID()}`,
            accountId: params.userCashAccountId,
            amount: params.amount,
            entryRole: "credit_user_cash"
          }
        ];

  const transactionHash = hashStablePayload({
    sequenceNumber: nextSequenceNumber,
    previousTransactionHash,
    type: params.side === "buy" ? "trade_buy" : "trade_sell",
    referenceType: "trade",
    referenceId: params.tradeId,
    idempotencyKey: params.idempotencyKey,
    marketId: params.marketId,
    outcomeId: params.outcomeId,
    triggeredBy: "user",
    triggeredById: params.actorId,
    tradeSide: params.side,
    tradePriceBefore: params.priceBefore,
    tradePriceAfter: params.priceAfter,
    entries: entryPairs
      .map((entry) => ({
        accountId: entry.accountId,
        amount: entry.amount,
        entryRole: entry.entryRole
      }))
      .sort((left, right) => left.accountId.localeCompare(right.accountId))
  });

  await client.query(
    `
      insert into ledger_transactions (
        id,
        sequence_number,
        type,
        reference_type,
        reference_id,
        idempotency_key,
        created_by,
        posted_at,
        market_id,
        outcome_id,
        triggered_by,
        triggered_by_id,
        trade_side,
        trade_price_before,
        trade_price_after,
        previous_transaction_hash,
        transaction_hash
      )
      values (
        $1,
        $2,
        $3,
        'trade',
        $4,
        $5,
        $6,
        now(),
        $7,
        $8,
        'user',
        $6,
        $9,
        $10,
        $11,
        $12,
        $13
      )
    `,
    [
      ledgerTransactionId,
      nextSequenceNumber,
      params.side === "buy" ? "trade_buy" : "trade_sell",
      params.tradeId,
      params.idempotencyKey,
      params.actorId,
      params.marketId,
      params.outcomeId,
      params.side,
      params.priceBefore,
      params.priceAfter,
      previousTransactionHash,
      transactionHash
    ]
  );

  for (const entry of entryPairs) {
    await client.query(
      `
        insert into ledger_entries (id, transaction_id, account_id, amount, entry_role)
        values ($1, $2, $3, $4, $5)
      `,
      [entry.id, ledgerTransactionId, entry.accountId, entry.amount, entry.entryRole]
    );
  }
}
