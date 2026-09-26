import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { RequestActor } from "./actor-resolver";
import { withTransaction } from "../db/tx/with-transaction";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import { insertAuditEvent } from "../shared/audit-events";
import {
  parseObjectBody,
  parseRequiredStringField
} from "../shared/zod-request-body";

type LedgerHeadRow = {
  sequence_number: string;
  transaction_hash: string;
};

type GrantTransactionRow = {
  id: string;
  reference_id: string;
  compensates_transaction_id: string | null;
  compensation_reason: string | null;
  transaction_hash: string;
};

type LedgerEntryRow = {
  account_id: string;
  amount: string;
  entry_role: string;
  account_type: "user_cash" | "platform_treasury";
};

type AccountRow = {
  id: string;
  type: "user_cash" | "platform_treasury";
  balance_cached: string;
};

export type StarterGrantReversalResponse = {
  userId: string;
  grantTransactionId: string;
  reversalTransactionId: string;
  reversedAmount: string;
  compensationReason: string;
  userCashBefore: string;
  userCashAfter: string;
  platformTreasuryBefore: string;
  platformTreasuryAfter: string;
  alreadyReversed: boolean;
  auditEventId: string | null;
};

export class StarterGrantReversalServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "StarterGrantReversalServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const MAX_ADMIN_REASON_CODE_LENGTH = 120;

function createStarterGrantReversalRequestError(message: string): StarterGrantReversalServiceError {
  return new StarterGrantReversalServiceError(400, "invalid_request", message);
}

function readRequiredReasonCode(body: unknown): string {
  const candidate = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createStarterGrantReversalRequestError
  );
  const reasonCode = parseRequiredStringField(
    candidate,
    "reasonCode",
    createStarterGrantReversalRequestError
  );

  if (/[\u0000-\u001f\u007f]/.test(reasonCode)) {
    throw createStarterGrantReversalRequestError("reasonCode cannot contain control characters.");
  }

  if (reasonCode.length > MAX_ADMIN_REASON_CODE_LENGTH) {
    throw createStarterGrantReversalRequestError(
      `reasonCode must be ${MAX_ADMIN_REASON_CODE_LENGTH} characters or fewer.`
    );
  }

  return reasonCode;
}

async function readLedgerHead(client: PoolClient): Promise<LedgerHeadRow | null> {
  await client.query("select pg_advisory_xact_lock(hashtext('navi_ledger_sequence'))");

  const result = await client.query<LedgerHeadRow>(
    `
      select sequence_number, transaction_hash
      from ledger_transactions
      order by sequence_number desc
      limit 1
      for update
    `
  );

  return result.rows[0] ?? null;
}

async function readStarterGrantTransaction(
  client: PoolClient,
  userId: string
): Promise<GrantTransactionRow | null> {
  const result = await client.query<GrantTransactionRow>(
    `
      select
        id,
        reference_id,
        compensates_transaction_id,
        compensation_reason,
        transaction_hash
      from ledger_transactions
      where reference_type = 'grant'
        and reference_id = $1
      order by sequence_number asc
      limit 1
      for update
    `,
    [`starter_bonus:${userId}`]
  );

  return result.rows[0] ?? null;
}

async function readLedgerEntries(
  client: PoolClient,
  transactionId: string
): Promise<LedgerEntryRow[]> {
  const result = await client.query<LedgerEntryRow>(
    `
      select
        le.account_id,
        le.amount,
        le.entry_role,
        a.type as account_type
      from ledger_entries le
      join accounts a
        on a.id = le.account_id
      where le.transaction_id = $1
      order by le.entry_role asc
    `,
    [transactionId]
  );

  return result.rows;
}

async function readLockedAccounts(
  client: PoolClient,
  accountIds: string[]
): Promise<AccountRow[]> {
  const result = await client.query<AccountRow>(
    `
      select id, type, balance_cached
      from accounts
      where id = any($1::text[])
      for update
    `,
    [accountIds]
  );

  return result.rows;
}

function buildHashInput(input: {
  sequenceNumber: number;
  previousTransactionHash: string;
  grantTransactionId: string;
  reversalTransactionId: string;
  compensationReason: string;
  triggeredById: string;
  entries: Array<{
    accountId: string;
    amount: string;
    entryRole: string;
  }>;
}): string {
  return createHash("sha256").update(
    JSON.stringify({
    sequenceNumber: input.sequenceNumber,
    previousTransactionHash: input.previousTransactionHash,
    type: "adjustment",
    referenceType: "admin_adjustment",
    referenceId: input.reversalTransactionId,
    compensatesTransactionId: input.grantTransactionId,
    compensationReason: input.compensationReason,
    triggeredBy: "admin",
    triggeredById: input.triggeredById,
    entries: input.entries
      .map((entry) => ({
        accountId: entry.accountId,
        amount: entry.amount,
        entryRole: entry.entryRole
      }))
      .sort((left, right) => left.accountId.localeCompare(right.accountId))
    })
  ).digest("hex");
}

async function insertGrantReversalTransaction(
  client: PoolClient,
  input: {
    grantTransactionId: string;
    compensationReason: string;
    actorId: string;
    userCashAccountId: string;
    platformTreasuryAccountId: string;
    reversedAmount: string;
  }
): Promise<string> {
  const head = await readLedgerHead(client);
  const nextSequenceNumber = head ? Number(head.sequence_number) + 1 : 1;
  const previousTransactionHash = head?.transaction_hash ?? "GENESIS";
  const reversalTransactionId = `ledger_tx_${randomUUID()}`;
  const entries = [
    {
      accountId: input.userCashAccountId,
      amount: quantizeMoney(toDecimal(input.reversedAmount).negated()),
      entryRole: "debit_user_cash"
    },
    {
      accountId: input.platformTreasuryAccountId,
      amount: input.reversedAmount,
      entryRole: "credit_platform_treasury"
    }
  ];
  const transactionHash = buildHashInput({
    sequenceNumber: nextSequenceNumber,
    previousTransactionHash,
    grantTransactionId: input.grantTransactionId,
    reversalTransactionId,
    compensationReason: input.compensationReason,
    triggeredById: input.actorId,
    entries
  });

  await client.query(
    `
      insert into ledger_transactions (
        id,
        sequence_number,
        type,
        reference_type,
        reference_id,
        created_by,
        posted_at,
        compensates_transaction_id,
        compensation_reason,
        triggered_by,
        triggered_by_id,
        previous_transaction_hash,
        transaction_hash
      )
      values (
        $1,
        $2,
        'adjustment',
        'admin_adjustment',
        $3,
        $4,
        now(),
        $5,
        $6,
        'admin',
        $4,
        $7,
        $8
      )
    `,
    [
      reversalTransactionId,
      nextSequenceNumber,
      `starter_grant_reversal:${input.grantTransactionId}`,
      input.actorId,
      input.grantTransactionId,
      input.compensationReason,
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
      [
        `ledger_entry_${reversalTransactionId}_${entry.entryRole}`,
        reversalTransactionId,
        entry.accountId,
        entry.amount,
        entry.entryRole
      ]
    );
  }

  return reversalTransactionId;
}

function buildResponse(
  input: {
    userId: string;
    grantTransactionId: string;
    compensationReason: string;
    reversedAmount: string;
  },
  state: {
    reversalTransactionId: string;
    userCashBefore: string;
    userCashAfter: string;
    platformTreasuryBefore: string;
    platformTreasuryAfter: string;
    alreadyReversed: boolean;
    auditEventId: string | null;
  }
): StarterGrantReversalResponse {
  return {
    userId: input.userId,
    grantTransactionId: input.grantTransactionId,
    reversalTransactionId: state.reversalTransactionId,
    reversedAmount: input.reversedAmount,
    compensationReason: input.compensationReason,
    userCashBefore: state.userCashBefore,
    userCashAfter: state.userCashAfter,
    platformTreasuryBefore: state.platformTreasuryBefore,
    platformTreasuryAfter: state.platformTreasuryAfter,
    alreadyReversed: state.alreadyReversed,
    auditEventId: state.auditEventId
  };
}

export async function reverseStarterGrant(
  db: Pool,
  userId: string,
  body: unknown,
  actor: RequestActor
): Promise<StarterGrantReversalResponse> {
  const compensationReason = readRequiredReasonCode(body);

  return withTransaction(db, async (client) => {
    const grant = await readStarterGrantTransaction(client, userId);

    if (!grant) {
      throw new StarterGrantReversalServiceError(
        404,
        "starter_grant_not_found",
        "Starter grant was not found for this user."
      );
    }

    const grantEntries = await readLedgerEntries(client, grant.id);
    const userCashGrantEntry = grantEntries.find(
      (entry) => entry.account_type === "user_cash" && entry.entry_role === "credit_user_cash"
    );
    const platformTreasuryGrantEntry = grantEntries.find(
      (entry) =>
        entry.account_type === "platform_treasury" && entry.entry_role === "debit_platform_treasury"
    );

    if (!userCashGrantEntry || !platformTreasuryGrantEntry) {
      throw new StarterGrantReversalServiceError(
        500,
        "starter_grant_invalid",
        "Starter grant ledger shape is invalid."
      );
    }

    const reversedAmount = quantizeMoney(userCashGrantEntry.amount);
    const existingReversal = await client.query<{ id: string }>(
      `
        select id
        from ledger_transactions
        where compensates_transaction_id = $1
        limit 1
      `,
      [grant.id]
    );

    const accountRows = await readLockedAccounts(client, [
      userCashGrantEntry.account_id,
      platformTreasuryGrantEntry.account_id
    ]);
    const userCash = accountRows.find((account) => account.type === "user_cash") ?? null;
    const platformTreasury =
      accountRows.find((account) => account.type === "platform_treasury") ?? null;

    if (!userCash || !platformTreasury) {
      throw new StarterGrantReversalServiceError(
        404,
        "account_not_found",
        "Required treasury accounts were not found."
      );
    }

    const userCashBalanceBefore = toDecimal(userCash.balance_cached);

    if (userCashBalanceBefore.lt(toDecimal(reversedAmount))) {
      throw new StarterGrantReversalServiceError(
        409,
        "insufficient_cash_for_reversal",
        "User cash balance is too low to reverse the starter grant."
      );
    }

    const platformTreasuryBalanceBefore = toDecimal(platformTreasury.balance_cached);

    if (existingReversal.rows[0]) {
      return buildResponse(
        {
          userId,
          grantTransactionId: grant.id,
          compensationReason: grant.compensation_reason ?? compensationReason,
          reversedAmount
        },
        {
          reversalTransactionId: existingReversal.rows[0].id,
          userCashBefore: quantizeMoney(userCashBalanceBefore),
          userCashAfter: quantizeMoney(userCashBalanceBefore),
          platformTreasuryBefore: quantizeMoney(platformTreasuryBalanceBefore),
          platformTreasuryAfter: quantizeMoney(platformTreasuryBalanceBefore),
          alreadyReversed: true,
          auditEventId: null
        }
      );
    }

    const userCashBalanceAfter = quantizeMoney(userCashBalanceBefore.minus(reversedAmount));
    const platformTreasuryBalanceAfter = quantizeMoney(
      platformTreasuryBalanceBefore.plus(reversedAmount)
    );
    const reversalTransactionId = await insertGrantReversalTransaction(client, {
      grantTransactionId: grant.id,
      compensationReason,
      actorId: actor.actorId,
      userCashAccountId: userCash.id,
      platformTreasuryAccountId: platformTreasury.id,
      reversedAmount
    });

    await Promise.all([
      client.query(
        `
          update accounts
          set balance_cached = $2,
              updated_at = now()
          where id = $1
        `,
        [userCash.id, userCashBalanceAfter]
      ),
      client.query(
        `
          update accounts
          set balance_cached = $2,
              updated_at = now()
          where id = $1
        `,
        [platformTreasury.id, platformTreasuryBalanceAfter]
      )
    ]);

    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "admin.user.reverse_starter_grant",
      entityType: "user",
      entityId: userId,
      payload: {
        grantTransactionId: grant.id,
        reversalTransactionId,
        compensationReason,
        reversedAmount,
        userCashBefore: quantizeMoney(userCashBalanceBefore),
        userCashAfter: userCashBalanceAfter,
        platformTreasuryBefore: quantizeMoney(platformTreasuryBalanceBefore),
        platformTreasuryAfter: platformTreasuryBalanceAfter
      }
    });

    return buildResponse(
      {
        userId,
        grantTransactionId: grant.id,
        compensationReason,
        reversedAmount
      },
      {
        reversalTransactionId,
        userCashBefore: quantizeMoney(userCashBalanceBefore),
        userCashAfter: userCashBalanceAfter,
        platformTreasuryBefore: quantizeMoney(platformTreasuryBalanceBefore),
        platformTreasuryAfter: platformTreasuryBalanceAfter,
        alreadyReversed: false,
        auditEventId
      }
    );
  });
}
