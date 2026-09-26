import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { readLockedLedgerHead, hashStablePayload } from "../../back/src/platform-surface/oracle";

export async function insertLedgerTransactionWithEntries(
  client: PoolClient,
  input: {
    type: "market_settlement" | "treasury_sweep";
    referenceType: "resolution" | "market";
    referenceId: string;
    idempotencyKey: string;
    createdBy: string;
    marketId: string;
    outcomeId?: string | null;
    resolutionId?: string | null;
    triggeredBy: string;
    triggeredById?: string | null;
    sharesSettled?: string | null;
    settlementPrice?: string | null;
    entries: Array<{
      accountId: string;
      amount: string;
      entryRole: string;
    }>;
  }
): Promise<void> {
  const head = await readLockedLedgerHead(client);
  const nextSequenceNumber = head ? Number(head.sequence_number) + 1 : 1;
  const previousTransactionHash = head?.transaction_hash ?? "GENESIS";
  const ledgerTransactionId = `ledger_tx_${randomUUID()}`;

  const transactionHash = hashStablePayload({
    sequenceNumber: nextSequenceNumber,
    previousTransactionHash,
    type: input.type,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
    marketId: input.marketId,
    outcomeId: input.outcomeId,
    resolutionId: input.resolutionId,
    triggeredBy: input.triggeredBy,
    triggeredById: input.triggeredById,
    sharesSettled: input.sharesSettled,
    settlementPrice: input.settlementPrice,
    entries: input.entries
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
        resolution_id,
        shares_settled,
        settlement_price,
        triggered_by,
        triggered_by_id,
        previous_transaction_hash,
        transaction_hash
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        now(),
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16
      )
    `,
    [
      ledgerTransactionId,
      nextSequenceNumber,
      input.type,
      input.referenceType,
      input.referenceId,
      input.idempotencyKey,
      input.createdBy,
      input.marketId,
      input.outcomeId ?? null,
      input.resolutionId ?? null,
      input.sharesSettled ?? null,
      input.settlementPrice ?? null,
      input.triggeredBy,
      input.triggeredById ?? null,
      previousTransactionHash,
      transactionHash
    ]
  );

  for (const entry of input.entries) {
    await client.query(
      `
        insert into ledger_entries (id, transaction_id, account_id, amount, entry_role)
        values ($1, $2, $3, $4, $5)
      `,
      [`ledger_entry_${randomUUID()}`, ledgerTransactionId, entry.accountId, entry.amount, entry.entryRole]
    );
  }
}
