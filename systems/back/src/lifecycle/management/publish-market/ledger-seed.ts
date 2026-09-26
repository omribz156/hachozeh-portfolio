import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { quantizeMoney, toDecimal } from "../../../shared/decimals";
import { readLockedLedgerHead } from "../../../shared/ledger-head";
import { hashStablePayload } from "../../../shared/stable-hash";

export async function insertLedgerTransactionWithEntries(
  client: PoolClient,
  input: {
    transactionId: string;
    idempotencyKey: string;
    actorId: string;
    marketId: string;
    amount: string;
    platformTreasuryAccountId: string;
    marketTreasuryAccountId: string;
  }
): Promise<void> {
  const head = await readLockedLedgerHead(client);
  const nextSequenceNumber = head ? Number(head.sequence_number) + 1 : 1;
  const previousTransactionHash = head?.transaction_hash ?? "GENESIS";

  const entries = [
    {
      accountId: input.platformTreasuryAccountId,
      amount: quantizeMoney(toDecimal(input.amount).negated()),
      entryRole: "debit_platform_treasury"
    },
    {
      accountId: input.marketTreasuryAccountId,
      amount: input.amount,
      entryRole: "credit_market_treasury"
    }
  ];

  const transactionHash = hashStablePayload({
    sequenceNumber: nextSequenceNumber,
    previousTransactionHash,
    type: "market_seed",
    referenceType: "market",
    referenceId: input.marketId,
    idempotencyKey: input.idempotencyKey,
    marketId: input.marketId,
    triggeredBy: "admin_publish",
    triggeredById: input.actorId,
    entries: entries
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
        triggered_by,
        triggered_by_id,
        previous_transaction_hash,
        transaction_hash
      )
      values (
        $1,
        $2,
        'market_seed',
        'market',
        $3,
        $4,
        $5,
        now(),
        $3,
        'admin_publish',
        $5,
        $6,
        $7
      )
    `,
    [
      input.transactionId,
      nextSequenceNumber,
      input.marketId,
      input.idempotencyKey,
      input.actorId,
      previousTransactionHash,
      transactionHash
    ]
  );

  for (const entry of entries) {
    await client.query(
      `
        insert into ledger_entries (id, transaction_id, account_id, amount, entry_role)
        values ($1, $2, $3, $4, $5)
      `,
      [`ledger_entry_${randomUUID()}`, input.transactionId, entry.accountId, entry.amount, entry.entryRole]
    );
  }
}
