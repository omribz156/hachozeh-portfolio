import { randomUUID } from "node:crypto";

import type { Queryable } from "../db/client/pool";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import { readLockedLedgerHead } from "../shared/ledger-head";
import { hashStablePayload } from "../shared/stable-hash";

export class EconomyLedgerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EconomyLedgerError";
    this.code = code;
  }
}

type AccountType = "user_cash" | "market_treasury" | "platform_treasury" | "mint_source" | "sink";

type AccountRow = {
  id: string;
  type: AccountType;
  status: string;
  balance_cached: string;
};

export type EconomyLedgerTransferResult = {
  ledgerTransactionId: string;
  sourceAccountId: string;
  targetAccountId: string;
  sourceBalanceBefore: string;
  sourceBalanceAfter: string;
  targetBalanceBefore: string;
  targetBalanceAfter: string;
  amount: string;
};

async function readLockedAccountById(
  db: Queryable,
  accountId: string
): Promise<AccountRow | null> {
  const result = await db.query<AccountRow>(
    `
      select id, type, status, balance_cached::text as balance_cached
      from accounts
      where id = $1
      limit 1
      for update
    `,
    [accountId]
  );

  return result.rows[0] ?? null;
}

async function readLockedAccountByType(
  db: Queryable,
  accountType: AccountType
): Promise<AccountRow | null> {
  const result = await db.query<AccountRow>(
    `
      select id, type, status, balance_cached::text as balance_cached
      from accounts
      where type = $1
      order by created_at asc
      limit 1
      for update
    `,
    [accountType]
  );

  return result.rows[0] ?? null;
}

async function updateAccountBalance(
  db: Queryable,
  accountId: string,
  nextBalance: string
): Promise<void> {
  await db.query(
    `
      update accounts
      set balance_cached = $2,
          updated_at = now()
      where id = $1
    `,
    [accountId, nextBalance]
  );
}

function assertActiveAccount(account: AccountRow | null, expectedType: AccountType, label: string): AccountRow {
  if (!account || account.type !== expectedType || account.status !== "active") {
    throw new EconomyLedgerError(
      `${label}_unavailable`,
      `${label} account is unavailable for economy transfer.`
    );
  }

  return account;
}

export async function insertEconomyTransferLedgerTransaction(
  db: Queryable,
  input: {
    type: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey?: string | null;
    createdBy: string;
    triggeredBy: string;
    triggeredById: string;
    marketId?: string | null;
    outcomeId?: string | null;
    resolutionId?: string | null;
    compensatesTransactionId?: string | null;
    compensationReason?: string | null;
    sourceAccountId?: string;
    sourceAccountType: AccountType;
    targetAccountId?: string;
    targetAccountType: AccountType;
    amount: string;
    sourceEntryRole: string;
    targetEntryRole: string;
    allowSourceOverdraft?: boolean;
  }
): Promise<EconomyLedgerTransferResult> {
  const amount = toDecimal(input.amount);
  if (amount.lte(0)) {
    throw new EconomyLedgerError("invalid_amount", "Economy transfer amount must be positive.");
  }

  const head = await readLockedLedgerHead(db);
  const source = assertActiveAccount(
    input.sourceAccountId
      ? await readLockedAccountById(db, input.sourceAccountId)
      : await readLockedAccountByType(db, input.sourceAccountType),
    input.sourceAccountType,
    "source"
  );
  const target = assertActiveAccount(
    input.targetAccountId
      ? await readLockedAccountById(db, input.targetAccountId)
      : await readLockedAccountByType(db, input.targetAccountType),
    input.targetAccountType,
    "target"
  );

  const sourceBefore = toDecimal(source.balance_cached);
  const targetBefore = toDecimal(target.balance_cached);
  if (!input.allowSourceOverdraft && sourceBefore.lt(amount)) {
    throw new EconomyLedgerError(
      "source_insufficient_funds",
      "Source account cannot cover this economy transfer."
    );
  }

  const transferAmount = quantizeMoney(amount);
  const sourceAfter = quantizeMoney(sourceBefore.minus(amount));
  const targetAfter = quantizeMoney(targetBefore.plus(amount));
  const nextSequenceNumber = Number(head?.sequence_number ?? "0") + 1;
  const previousTransactionHash = head?.transaction_hash ?? "GENESIS";
  const ledgerTransactionId = `ledger_tx_${randomUUID()}`;
  const entries = [
    {
      id: `ledger_entry_${randomUUID()}`,
      accountId: source.id,
      amount: quantizeMoney(amount.negated()),
      entryRole: input.sourceEntryRole
    },
    {
      id: `ledger_entry_${randomUUID()}`,
      accountId: target.id,
      amount: transferAmount,
      entryRole: input.targetEntryRole
    }
  ];
  const transactionHash = hashStablePayload({
    sequenceNumber: nextSequenceNumber,
    previousTransactionHash,
    type: input.type,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey ?? null,
    createdBy: input.createdBy,
    triggeredBy: input.triggeredBy,
    triggeredById: input.triggeredById,
    marketId: input.marketId ?? null,
    outcomeId: input.outcomeId ?? null,
    resolutionId: input.resolutionId ?? null,
    compensatesTransactionId: input.compensatesTransactionId ?? null,
    compensationReason: input.compensationReason ?? null,
    entries: entries
      .map((entry) => ({
        accountId: entry.accountId,
        amount: entry.amount,
        entryRole: entry.entryRole
      }))
      .sort((left, right) => left.accountId.localeCompare(right.accountId))
  });

  await db.query(
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
        compensates_transaction_id,
        compensation_reason,
        triggered_by,
        triggered_by_id,
        previous_transaction_hash,
        transaction_hash
      )
      values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `,
    [
      ledgerTransactionId,
      nextSequenceNumber,
      input.type,
      input.referenceType,
      input.referenceId,
      input.idempotencyKey ?? null,
      input.createdBy,
      input.marketId ?? null,
      input.outcomeId ?? null,
      input.resolutionId ?? null,
      input.compensatesTransactionId ?? null,
      input.compensationReason ?? null,
      input.triggeredBy,
      input.triggeredById,
      previousTransactionHash,
      transactionHash
    ]
  );

  for (const entry of entries) {
    await db.query(
      `
        insert into ledger_entries (id, transaction_id, account_id, amount, entry_role)
        values ($1, $2, $3, $4, $5)
      `,
      [entry.id, ledgerTransactionId, entry.accountId, entry.amount, entry.entryRole]
    );
  }

  await Promise.all([
    updateAccountBalance(db, source.id, sourceAfter),
    updateAccountBalance(db, target.id, targetAfter)
  ]);

  return {
    ledgerTransactionId,
    sourceAccountId: source.id,
    targetAccountId: target.id,
    sourceBalanceBefore: quantizeMoney(sourceBefore),
    sourceBalanceAfter: sourceAfter,
    targetBalanceBefore: quantizeMoney(targetBefore),
    targetBalanceAfter: targetAfter,
    amount: transferAmount
  };
}

export async function transferPlatformTreasuryToUser(
  db: Queryable,
  input: {
    userId: string;
    userCashAccountId: string;
    amount: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey?: string | null;
    createdBy: string;
    triggeredBy: string;
    sourceEntryRole?: string;
    targetEntryRole?: string;
  }
): Promise<EconomyLedgerTransferResult> {
  return insertEconomyTransferLedgerTransaction(db, {
    type: "grant",
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
    createdBy: input.createdBy,
    triggeredBy: input.triggeredBy,
    triggeredById: input.userId,
    sourceAccountType: "platform_treasury",
    targetAccountId: input.userCashAccountId,
    targetAccountType: "user_cash",
    amount: input.amount,
    sourceEntryRole: input.sourceEntryRole ?? "debit_platform_treasury",
    targetEntryRole: input.targetEntryRole ?? "credit_user_cash"
  });
}

export async function topUpPlatformTreasury(
  db: Queryable,
  input: {
    actorId: string;
    amount: string;
    referenceId: string;
    idempotencyKey?: string | null;
    createdBy: string;
  }
): Promise<EconomyLedgerTransferResult> {
  return insertEconomyTransferLedgerTransaction(db, {
    type: "treasury_top_up",
    referenceType: "treasury_top_up",
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
    createdBy: input.createdBy,
    triggeredBy: "admin",
    triggeredById: input.actorId,
    sourceAccountType: "mint_source",
    targetAccountType: "platform_treasury",
    amount: input.amount,
    sourceEntryRole: "debit_mint_source",
    targetEntryRole: "credit_platform_treasury",
    allowSourceOverdraft: true
  });
}
