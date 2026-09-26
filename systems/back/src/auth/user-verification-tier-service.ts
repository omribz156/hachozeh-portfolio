import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { Queryable } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import { updateAccountBalance } from "../shared/account-balances";
import {
  readLockedPlatformTreasury,
  type AccountRecord
} from "../shared/account-records";
import { insertAuditEvent } from "../shared/audit-events";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import {
  EFFECTIVE_PROCEEDS_SQL,
  EFFECTIVE_REALIZATION_TYPE_SQL,
  INCIDENT_COMPENSATION_LATERAL_JOIN
} from "../shared/incident-compensation";
import { readLockedLedgerHead } from "../shared/ledger-head";
import { hashStablePayload } from "../shared/stable-hash";

export type VerificationTier = "gray" | "gold" | "diamond";

export type PurchasedTierRow = {
  tier: VerificationTier;
  purchased_at: Date;
};

type SuccessfulReturnRow = {
  successful_return_count: string;
};

type UserCashAccountRow = AccountRecord & {
  type: "user_cash";
};

export type VerificationTierDefinition = {
  tier: VerificationTier;
  minSuccessfulReturns: number;
  price: string;
  label: string;
  badgeLabel: string;
};

export type VerificationTierSummary = {
  successfulReturns: number;
  currentTier: VerificationTier | null;
  purchasedTiers: VerificationTier[];
  tiers: VerificationTierDefinition[];
  nextPurchase: {
    tier: VerificationTier;
    label: string;
    price: string;
    minSuccessfulReturns: number;
    progressSuccessfulReturns: number;
    requiredSuccessfulReturns: number;
    eligible: boolean;
    missingSuccessfulReturns: number;
  } | null;
};

export type VerificationTierPurchaseResponse = {
  purchased: {
    tier: VerificationTier;
    label: string;
    price: string;
    ledgerTransactionId: string;
  };
  summary: VerificationTierSummary;
};

export class VerificationTierServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "VerificationTierServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const VERIFICATION_TIERS: VerificationTierDefinition[] = [
  {
    tier: "gray",
    minSuccessfulReturns: 10,
    price: "5000.000000",
    label: "תג אפור",
    badgeLabel: "אפור"
  },
  {
    tier: "gold",
    minSuccessfulReturns: 20,
    price: "5000.000000",
    label: "תג זהב",
    badgeLabel: "זהב"
  },
  {
    tier: "diamond",
    minSuccessfulReturns: 50,
    price: "10000.000000",
    label: "תג יהלום",
    badgeLabel: "יהלום"
  }
];

const TIER_RANK: Record<VerificationTier, number> = {
  gray: 1,
  gold: 2,
  diamond: 3
};

function isVerificationTier(value: unknown): value is VerificationTier {
  return value === "gray" || value === "gold" || value === "diamond";
}

function readRequestedTier(body: unknown): VerificationTier {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new VerificationTierServiceError(
      400,
      "invalid_request",
      "Request body must be a JSON object."
    );
  }

  const tier = (body as { tier?: unknown }).tier;

  if (!isVerificationTier(tier)) {
    throw new VerificationTierServiceError(
      400,
      "invalid_tier",
      "A valid verification tier is required."
    );
  }

  return tier;
}

async function readSuccessfulReturnCount(
  db: Queryable,
  userId: string
): Promise<number> {
  const result = await db.query<SuccessfulReturnRow>(
    `
      select count(*)::text as successful_return_count
      from realization_events re
      left join market_resolutions mr
        on mr.id = re.resolution_id
      ${INCIDENT_COMPENSATION_LATERAL_JOIN}
      where re.user_id = $1
        and ${EFFECTIVE_REALIZATION_TYPE_SQL} in ('sell', 'resolution_win')
        and ${EFFECTIVE_PROCEEDS_SQL} >= re.removed_cost_basis
    `,
    [userId]
  );

  return Math.max(0, Number(result.rows[0]?.successful_return_count ?? 0) || 0);
}

async function readPurchasedTiers(
  db: Queryable,
  userId: string
): Promise<PurchasedTierRow[]> {
  const result = await db.query<PurchasedTierRow>(
    `
      select tier, purchased_at
      from user_verification_tier_purchases
      where user_id = $1
      order by purchased_at asc
    `,
    [userId]
  );

  return result.rows.filter((row) => isVerificationTier(row.tier));
}

function readPreviousTierThreshold(tier: VerificationTier): number {
  const tierIndex = VERIFICATION_TIERS.findIndex((item) => item.tier === tier);
  if (tierIndex <= 0) return 0;
  return VERIFICATION_TIERS[tierIndex - 1]?.minSuccessfulReturns ?? 0;
}

export function buildVerificationTierSummary(
  successfulReturns: number,
  purchasedRows: PurchasedTierRow[]
): VerificationTierSummary {
  const purchasedTiers = [...new Set(purchasedRows.map((row) => row.tier))].sort(
    (left, right) => TIER_RANK[left] - TIER_RANK[right]
  );
  const currentTier = purchasedTiers[purchasedTiers.length - 1] ?? null;
  const nextTier = VERIFICATION_TIERS.find(
    (tier) => !purchasedTiers.includes(tier.tier)
  );
  const previousThreshold = nextTier ? readPreviousTierThreshold(nextTier.tier) : 0;
  const requiredSuccessfulReturns = nextTier
    ? Math.max(0, nextTier.minSuccessfulReturns - previousThreshold)
    : 0;
  const progressSuccessfulReturns = nextTier
    ? Math.min(
        requiredSuccessfulReturns,
        Math.max(0, successfulReturns - previousThreshold)
      )
    : 0;

  return {
    successfulReturns,
    currentTier,
    purchasedTiers,
    tiers: VERIFICATION_TIERS,
    nextPurchase: nextTier
      ? {
          tier: nextTier.tier,
          label: nextTier.label,
          price: nextTier.price,
          minSuccessfulReturns: nextTier.minSuccessfulReturns,
          progressSuccessfulReturns,
          requiredSuccessfulReturns,
          eligible: successfulReturns >= nextTier.minSuccessfulReturns,
          missingSuccessfulReturns: Math.max(
            0,
            requiredSuccessfulReturns - progressSuccessfulReturns
          )
        }
      : null
  };
}

export async function readVerificationTierSummary(
  db: Queryable,
  userId: string
): Promise<VerificationTierSummary> {
  const [successfulReturns, purchasedRows] = await Promise.all([
    readSuccessfulReturnCount(db, userId),
    readPurchasedTiers(db, userId)
  ]);

  return buildVerificationTierSummary(successfulReturns, purchasedRows);
}

async function readLockedUserCashAccount(
  client: PoolClient,
  userId: string
): Promise<UserCashAccountRow | null> {
  const result = await client.query<UserCashAccountRow>(
    `
      select id, type, status, balance_cached
      from accounts
      where type = 'user_cash'
        and owner_id = $1
      limit 1
      for update
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function insertVerificationPurchaseLedger(
  client: PoolClient,
  input: {
    actorId: string;
    tier: VerificationTier;
    price: string;
    userCashAccountId: string;
    platformTreasuryAccountId: string;
  }
): Promise<string> {
  const head = await readLockedLedgerHead(client);
  const nextSequenceNumber = head ? Number(head.sequence_number) + 1 : 1;
  const previousTransactionHash = head?.transaction_hash ?? "GENESIS";
  const ledgerTransactionId = `ledger_tx_verification_${randomUUID()}`;
  const entries = [
    {
      id: `ledger_entry_${randomUUID()}`,
      accountId: input.userCashAccountId,
      amount: quantizeMoney(toDecimal(input.price).negated()),
      entryRole: "debit_user_cash"
    },
    {
      id: `ledger_entry_${randomUUID()}`,
      accountId: input.platformTreasuryAccountId,
      amount: input.price,
      entryRole: "credit_platform_treasury"
    }
  ];
  const transactionHash = hashStablePayload({
    sequenceNumber: nextSequenceNumber,
    previousTransactionHash,
    type: "verification_tier_purchase",
    referenceType: "user_status",
    referenceId: `${input.actorId}:${input.tier}`,
    triggeredBy: "user",
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
        created_by,
        posted_at,
        triggered_by,
        triggered_by_id,
        previous_transaction_hash,
        transaction_hash
      )
      values (
        $1,
        $2,
        'verification_tier_purchase',
        'user_status',
        $3,
        $4,
        now(),
        'user',
        $4,
        $5,
        $6
      )
    `,
    [
      ledgerTransactionId,
      nextSequenceNumber,
      `${input.actorId}:${input.tier}`,
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
      [entry.id, ledgerTransactionId, entry.accountId, entry.amount, entry.entryRole]
    );
  }

  return ledgerTransactionId;
}

export async function purchaseVerificationTier(
  db: Pool,
  userId: string,
  body: unknown
): Promise<VerificationTierPurchaseResponse> {
  const requestedTier = readRequestedTier(body);

  return withTransaction(db, async (client) => {
    const successfulReturns = await readSuccessfulReturnCount(client, userId);
    const purchasedRows = await readPurchasedTiers(client, userId);
    const summary = buildVerificationTierSummary(successfulReturns, purchasedRows);
    const nextPurchase = summary.nextPurchase;

    if (!nextPurchase || nextPurchase.tier !== requestedTier) {
      throw new VerificationTierServiceError(
        409,
        "tier_not_next",
        "This verification tier is not the next available upgrade."
      );
    }

    if (!nextPurchase.eligible) {
      throw new VerificationTierServiceError(
        409,
        "tier_not_unlocked",
        "This verification tier is not unlocked yet."
      );
    }

    const tier = VERIFICATION_TIERS.find((item) => item.tier === requestedTier);

    if (!tier) {
      throw new VerificationTierServiceError(400, "invalid_tier", "Invalid verification tier.");
    }

    const userCash = await readLockedUserCashAccount(client, userId);
    const platformTreasury = await readLockedPlatformTreasury(client);

    if (!userCash || userCash.status !== "active") {
      throw new VerificationTierServiceError(
        404,
        "user_cash_not_found",
        "User cash account is unavailable."
      );
    }

    if (!platformTreasury || platformTreasury.status !== "active") {
      throw new VerificationTierServiceError(
        500,
        "platform_treasury_unavailable",
        "Platform treasury account is unavailable."
      );
    }

    const userCashBefore = toDecimal(userCash.balance_cached);

    if (userCashBefore.lt(toDecimal(tier.price))) {
      throw new VerificationTierServiceError(
        409,
        "insufficient_cash",
        "Not enough V₪ to buy this verification tier."
      );
    }

    const platformTreasuryBefore = toDecimal(platformTreasury.balance_cached);
    const userCashAfter = quantizeMoney(userCashBefore.minus(tier.price));
    const platformTreasuryAfter = quantizeMoney(platformTreasuryBefore.plus(tier.price));
    const ledgerTransactionId = await insertVerificationPurchaseLedger(client, {
      actorId: userId,
      tier: tier.tier,
      price: tier.price,
      userCashAccountId: userCash.id,
      platformTreasuryAccountId: platformTreasury.id
    });

    await Promise.all([
      updateAccountBalance(client, userCash.id, userCashAfter),
      updateAccountBalance(client, platformTreasury.id, platformTreasuryAfter)
    ]);

    await client.query(
      `
        insert into user_verification_tier_purchases (
          user_id,
          tier,
          price_amount,
          ledger_transaction_id,
          purchased_at
        )
        values ($1, $2, $3, $4, now())
      `,
      [userId, tier.tier, tier.price, ledgerTransactionId]
    );

    await insertAuditEvent(client, {
      actorId: userId,
      action: "user.verification_tier.purchase",
      entityType: "user",
      entityId: userId,
      payload: {
        tier: tier.tier,
        price: tier.price,
        successfulReturns,
        ledgerTransactionId,
        userCashBefore: quantizeMoney(userCashBefore),
        userCashAfter,
        platformTreasuryBefore: quantizeMoney(platformTreasuryBefore),
        platformTreasuryAfter
      }
    });

    return {
      purchased: {
        tier: tier.tier,
        label: tier.label,
        price: tier.price,
        ledgerTransactionId
      },
      summary: await readVerificationTierSummary(client, userId)
    };
  });
}
