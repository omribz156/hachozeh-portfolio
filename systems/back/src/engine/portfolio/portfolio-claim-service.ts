import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { AppEnv } from "../../config/env";
import type { RequestActor } from "../../auth/actor-resolver";
import { withTransaction } from "../../db/tx/with-transaction";
import { quantizeMoney, quantizeShares, toDecimal } from "../../shared/decimals";
import { resolveCanonicalMarketKeyById, resolveOutcomeKey } from "../../shared/market-identity";
import { sanitizePublicAvatarUrl } from "../../shared/public-avatar-url";
import { resolvePublicDisplayName } from "../../shared/public-user-identity";
import { hashStablePayload } from "../../shared/stable-hash";
import { readLockedLedgerHead } from "../../shared/ledger-head";
import { resolvePortfolioActor, type PortfolioActorMode } from "./portfolio-actor";
import { PortfolioSnapshotServiceError } from "./portfolio-snapshot-service";

const CURRENT_RESOLUTION_WIN_SQL = `
        and exists (
          select 1
          from market_resolutions mr
          where mr.id = re.resolution_id
            and mr.winning_outcome_id = re.outcome_id
        )
`;

type ClaimRow = {
  id: string;
  created_at: Date;
  claimed_at: Date | null;
  claim_status: "pending" | "claimed" | "not_applicable";
  user_id: string;
  market_id: string;
  market_title: string;
  market_treasury_account_id: string | null;
  outcome_id: string;
  outcome_label: string;
  shares_closed: string;
  proceeds: string;
  removed_cost_basis: string;
  realized_pnl: string;
  resolution_id: string | null;
  user_cash_account_id?: string;
  user_cash_balance?: string;
  market_treasury_balance?: string;
};

export type PortfolioClaim = {
  claimId: string;
  status: "pending" | "claimed";
  happenedAt: string;
  claimedAt: string | null;
  marketKey: string;
  marketId: string;
  marketTitle: string;
  outcomeKey: string;
  outcomeId: string;
  outcomeLabel: string;
  sharesClosed: string;
  proceeds: string;
  removedCostBasis: string;
  realizedPnl: string;
  resolutionId: string | null;
};

export type PortfolioClaimsResponse = {
  actorMode: PortfolioActorMode;
  asOf: string;
  summary: {
    pendingClaimCount: number;
    totalClaimable: string;
  };
  claims: PortfolioClaim[];
};

export type PortfolioClaimResponse = {
  actorMode: PortfolioActorMode;
  asOf: string;
  claim: PortfolioClaim;
  summary: {
    creditedAmount: string;
  };
};

export type PortfolioClaimSweepResponse = {
  sweptCount: number;
  sweptAmount: string;
  claimIds: string[];
};

export class PortfolioClaimServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "PortfolioClaimServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function hashLedgerTransaction(payload: unknown): string {
  return hashStablePayload(payload);
}

function resolveActorOrThrow(
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">
): { actorId: string; mode: PortfolioActorMode } {
  try {
    return resolvePortfolioActor(env, actor);
  } catch {
    throw new PortfolioSnapshotServiceError(401, "unauthorized", "Demo actor mode is disabled.");
  }
}

function mapClaimRow(row: ClaimRow): PortfolioClaim {
  return {
    claimId: row.id,
    status: row.claim_status === "claimed" ? "claimed" : "pending",
    happenedAt: row.created_at.toISOString(),
    claimedAt: row.claimed_at?.toISOString() ?? null,
    marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
    marketId: row.market_id,
    marketTitle: row.market_title,
    outcomeKey: resolveOutcomeKey(row.outcome_id) ?? row.outcome_id,
    outcomeId: row.outcome_id,
    outcomeLabel: row.outcome_label,
    sharesClosed: quantizeShares(row.shares_closed),
    proceeds: quantizeMoney(row.proceeds),
    removedCostBasis: quantizeMoney(row.removed_cost_basis),
    realizedPnl: quantizeMoney(row.realized_pnl),
    resolutionId: row.resolution_id
  };
}

async function readClaimRows(
  client: PoolClient,
  actorId: string,
  limit = 25
): Promise<ClaimRow[]> {
  const result = await client.query<ClaimRow>(
    `
      select
        re.id,
        re.created_at,
        re.claimed_at,
        re.claim_status,
        re.user_id,
        re.market_id,
        m.title as market_title,
        m.market_treasury_account_id,
        re.outcome_id,
        o.label as outcome_label,
        re.shares_closed::text as shares_closed,
        re.proceeds::text as proceeds,
        re.removed_cost_basis::text as removed_cost_basis,
        re.realized_pnl::text as realized_pnl,
        re.resolution_id
      from realization_events re
      join markets m
        on m.id = re.market_id
      join market_outcomes o
        on o.market_id = re.market_id
       and o.id = re.outcome_id
      where re.user_id = $1
        and re.type = 'resolution_win'
        ${CURRENT_RESOLUTION_WIN_SQL}
        and re.claim_status in ('pending', 'claimed')
      order by
        case when re.claim_status = 'pending' then 0 else 1 end,
        re.created_at desc,
        re.id desc
      limit $2
    `,
    [actorId, limit]
  );

  return result.rows;
}

async function readLockedClaimRow(
  client: PoolClient,
  actorId: string,
  claimId: string
): Promise<ClaimRow | null> {
  const result = await client.query<ClaimRow>(
    `
      select
        re.id,
        re.created_at,
        re.claimed_at,
        re.claim_status,
        re.user_id,
        re.market_id,
        m.title as market_title,
        m.market_treasury_account_id,
        re.outcome_id,
        o.label as outcome_label,
        re.shares_closed::text as shares_closed,
        re.proceeds::text as proceeds,
        re.removed_cost_basis::text as removed_cost_basis,
        re.realized_pnl::text as realized_pnl,
        re.resolution_id,
        user_cash.id as user_cash_account_id,
        user_cash.balance_cached::text as user_cash_balance,
        market_treasury.balance_cached::text as market_treasury_balance
      from realization_events re
      join markets m
        on m.id = re.market_id
      join market_outcomes o
        on o.market_id = re.market_id
       and o.id = re.outcome_id
      join accounts user_cash
        on user_cash.owner_id = re.user_id
       and user_cash.type = 'user_cash'
      join accounts market_treasury
        on market_treasury.id = m.market_treasury_account_id
      where re.id = $1
        and re.user_id = $2
        and re.type = 'resolution_win'
        ${CURRENT_RESOLUTION_WIN_SQL}
      limit 1
      for update of re, user_cash, market_treasury
    `,
    [claimId, actorId]
  );

  return result.rows[0] ?? null;
}

async function readLockedClaimRowForSweep(
  client: PoolClient,
  claimId: string
): Promise<ClaimRow | null> {
  const result = await client.query<ClaimRow>(
    `
      select
        re.id,
        re.created_at,
        re.claimed_at,
        re.claim_status,
        re.user_id,
        re.market_id,
        m.title as market_title,
        m.market_treasury_account_id,
        re.outcome_id,
        o.label as outcome_label,
        re.shares_closed::text as shares_closed,
        re.proceeds::text as proceeds,
        re.removed_cost_basis::text as removed_cost_basis,
        re.realized_pnl::text as realized_pnl,
        re.resolution_id,
        user_cash.id as user_cash_account_id,
        user_cash.balance_cached::text as user_cash_balance,
        market_treasury.balance_cached::text as market_treasury_balance
      from realization_events re
      join markets m
        on m.id = re.market_id
      join market_outcomes o
        on o.market_id = re.market_id
       and o.id = re.outcome_id
      join accounts user_cash
        on user_cash.owner_id = re.user_id
       and user_cash.type = 'user_cash'
      join accounts market_treasury
        on market_treasury.id = m.market_treasury_account_id
      where re.id = $1
        and re.type = 'resolution_win'
        ${CURRENT_RESOLUTION_WIN_SQL}
      limit 1
      for update of re, user_cash, market_treasury
    `,
    [claimId]
  );

  return result.rows[0] ?? null;
}

async function readSweepableClaimIds(
  client: PoolClient,
  cutoff: Date,
  limit: number
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `
      select re.id
      from realization_events re
      where re.type = 'resolution_win'
        ${CURRENT_RESOLUTION_WIN_SQL}
        and re.claim_status = 'pending'
        and re.created_at < $1
      order by re.created_at asc, re.id asc
      limit $2
      for update skip locked
    `,
    [cutoff.toISOString(), limit]
  );

  return result.rows.map((row) => row.id);
}

async function insertClaimLedgerTransaction(
  client: PoolClient,
  input: {
    actorId: string;
    claimId: string;
    marketId: string;
    outcomeId: string;
    resolutionId: string | null;
    sharesSettled: string;
    marketTreasuryAccountId: string;
    userCashAccountId: string;
    amount: string;
    triggeredBy: "user_claim" | "claim_sweep";
  }
): Promise<string> {
  const head = await readLockedLedgerHead(client);
  const nextSequenceNumber = head ? Number(head.sequence_number) + 1 : 1;
  const previousTransactionHash = head?.transaction_hash ?? "GENESIS";
  const transactionId = `ledger_tx_${randomUUID()}`;
  const entries = [
    {
      accountId: input.marketTreasuryAccountId,
      amount: quantizeMoney(toDecimal(input.amount).negated()),
      entryRole: "debit_market_treasury_claim"
    },
    {
      accountId: input.userCashAccountId,
      amount: input.amount,
      entryRole: "credit_user_cash_claim"
    }
  ];
  const transactionHash = hashLedgerTransaction({
    sequenceNumber: nextSequenceNumber,
    previousTransactionHash,
    type: "claim_payout",
    referenceType: "realization",
    referenceId: input.claimId,
    idempotencyKey: `portfolio_claim:${input.claimId}`,
    marketId: input.marketId,
    outcomeId: input.outcomeId,
    resolutionId: input.resolutionId,
    sharesSettled: input.sharesSettled,
    settlementPrice: "1.00000000",
    triggeredBy: input.triggeredBy,
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
        outcome_id,
        resolution_id,
        shares_settled,
        settlement_price,
        triggered_by,
        triggered_by_id,
        previous_transaction_hash,
        transaction_hash
      )
      values ($1, $2, 'claim_payout', 'realization', $3, $4, $5, now(), $6, $7, $8, $9, '1.00000000', $10, $5, $11, $12)
    `,
    [
      transactionId,
      nextSequenceNumber,
      input.claimId,
      `portfolio_claim:${input.claimId}`,
      input.actorId,
      input.marketId,
      input.outcomeId,
      input.resolutionId,
      input.sharesSettled,
      input.triggeredBy,
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
      [`ledger_entry_${randomUUID()}`, transactionId, entry.accountId, entry.amount, entry.entryRole]
    );
  }

  return transactionId;
}

async function claimLockedRow(
  client: PoolClient,
  row: ClaimRow,
  input: {
    actorId: string;
    triggeredBy: "user_claim" | "claim_sweep";
  }
): Promise<{
  claim: PortfolioClaim;
  creditedAmount: string;
}> {
  if (row.claim_status === "claimed") {
    throw new PortfolioClaimServiceError(409, "claim_already_claimed", "Claim was already collected.");
  }

  if (row.claim_status !== "pending") {
    throw new PortfolioClaimServiceError(409, "claim_not_available", "Claim is not available.");
  }

  if (!row.market_treasury_account_id || !row.user_cash_account_id) {
    throw new PortfolioClaimServiceError(409, "claim_not_available", "Claim accounts are unavailable.");
  }

  const proceeds = toDecimal(row.proceeds);
  if (proceeds.lte(0)) {
    throw new PortfolioClaimServiceError(409, "claim_not_available", "Claim amount is zero.");
  }

  const marketTreasuryBalance = toDecimal(row.market_treasury_balance ?? "0");
  if (marketTreasuryBalance.lessThan(proceeds)) {
    throw new PortfolioClaimServiceError(409, "claim_not_available", "Market treasury cannot cover this claim.");
  }

  const userCashBalance = toDecimal(row.user_cash_balance ?? "0");
  const ledgerTransactionId = await insertClaimLedgerTransaction(client, {
    actorId: input.actorId,
    claimId: row.id,
    marketId: row.market_id,
    outcomeId: row.outcome_id,
    resolutionId: row.resolution_id,
    sharesSettled: quantizeShares(row.shares_closed),
    marketTreasuryAccountId: row.market_treasury_account_id,
    userCashAccountId: row.user_cash_account_id,
    amount: quantizeMoney(proceeds),
    triggeredBy: input.triggeredBy
  });

  await client.query(
    `
      update accounts
      set balance_cached = $2,
          updated_at = now()
      where id = $1
    `,
    [row.market_treasury_account_id, quantizeMoney(marketTreasuryBalance.minus(proceeds))]
  );
  await client.query(
    `
      update accounts
      set balance_cached = $2,
          updated_at = now()
      where id = $1
    `,
    [row.user_cash_account_id, quantizeMoney(userCashBalance.plus(proceeds))]
  );
  await client.query(
    `
      update realization_events
      set claim_status = 'claimed',
          claimed_at = now(),
          claim_ledger_transaction_id = $2
      where id = $1
    `,
    [row.id, ledgerTransactionId]
  );
  await client.query(
    `
      update user_notifications
      set claimed = true
      where user_id = $1
        and realization_event_id = $2
        and type = 'win'
    `,
    [row.user_id, row.id]
  );

  return {
    claim: {
      ...mapClaimRow({
        ...row,
        claim_status: "claimed",
        claimed_at: new Date()
      }),
      status: "claimed"
    },
    creditedAmount: quantizeMoney(proceeds)
  };
}

export async function readPortfolioClaims(
  db: Pool,
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">
): Promise<PortfolioClaimsResponse> {
  const resolvedActor = resolveActorOrThrow(env, actor);
  const client = await db.connect();

  try {
    const rows = await readClaimRows(client, resolvedActor.actorId);
    const claims = rows.map(mapClaimRow);
    const totalClaimable = claims
      .filter((claim) => claim.status === "pending")
      .reduce((sum, claim) => sum.plus(claim.proceeds), toDecimal(0));

    return {
      actorMode: resolvedActor.mode,
      asOf: new Date().toISOString(),
      summary: {
        pendingClaimCount: claims.filter((claim) => claim.status === "pending").length,
        totalClaimable: quantizeMoney(totalClaimable)
      },
      claims
    };
  } finally {
    client.release();
  }
}

export async function claimPortfolioRealization(
  db: Pool,
  env: AppEnv,
  claimId: string,
  actor?: Pick<RequestActor, "actorId" | "mode">
): Promise<PortfolioClaimResponse> {
  const resolvedActor = resolveActorOrThrow(env, actor);

  return withTransaction(db, async (client) => {
    const row = await readLockedClaimRow(client, resolvedActor.actorId, claimId);

    if (!row) {
      throw new PortfolioClaimServiceError(404, "claim_not_found", "Claim was not found.");
    }

    const claimed = await claimLockedRow(client, row, {
      actorId: resolvedActor.actorId,
      triggeredBy: "user_claim"
    });

    return {
      actorMode: resolvedActor.mode,
      asOf: new Date().toISOString(),
      claim: claimed.claim,
      summary: {
        creditedAmount: claimed.creditedAmount
      }
    };
  });
}

export type PublicClaimShare = {
  claimId: string;
  marketKey: string;
  marketTitle: string;
  outcomeLabel: string;
  proceeds: string;
  entryPricePct: number | null;
  resolvedAt: string;
  sharedAt: string;
  user: {
    handle: string | null;
    displayName: string;
    avatarUrl: string | null;
  };
};

type PublicClaimShareRow = {
  id: string;
  created_at: Date;
  share_consented_at: Date;
  shares_closed: string;
  removed_cost_basis: string;
  proceeds: string;
  market_id: string;
  market_title: string;
  outcome_label: string;
  user_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

// Public snapshot of a shared win. Readable by anyone, but only AFTER the
// owner consented by taking a share action (share_consented_at stamp).
export async function readPublicClaimShare(
  db: Pool,
  claimId: string
): Promise<PublicClaimShare | null> {
  const result = await db.query<PublicClaimShareRow>(
    `
      select
        re.id,
        re.created_at,
        re.share_consented_at,
        re.shares_closed::text as shares_closed,
        re.removed_cost_basis::text as removed_cost_basis,
        re.proceeds::text as proceeds,
        re.market_id,
        m.title as market_title,
        o.label as outcome_label,
        u.id as user_id,
        u.handle,
        u.display_name,
        u.avatar_url
      from realization_events re
      join markets m
        on m.id = re.market_id
      join market_outcomes o
        on o.market_id = re.market_id
       and o.id = re.outcome_id
      join users u
        on u.id = re.user_id
      where re.id = $1
        and re.type = 'resolution_win'
        ${CURRENT_RESOLUTION_WIN_SQL}
        and re.share_consented_at is not null
      limit 1
    `,
    [claimId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const shares = toDecimal(row.shares_closed);
  const cost = toDecimal(row.removed_cost_basis);
  // Average entry price per share (winning shares settle at 1.00), as a percent:
  // the "called it at 12%" number. Null when it can't be derived honestly.
  const entryPricePct = shares.greaterThan(0) && cost.greaterThan(0)
    ? Math.min(99, Math.max(1, Math.round(cost.dividedBy(shares).times(100).toNumber())))
    : null;

  return {
    claimId: row.id,
    marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
    marketTitle: row.market_title,
    outcomeLabel: row.outcome_label,
    proceeds: quantizeMoney(row.proceeds),
    entryPricePct,
    resolvedAt: row.created_at.toISOString(),
    sharedAt: row.share_consented_at.toISOString(),
    user: {
      handle: row.handle ?? null,
      displayName: resolvePublicDisplayName(row.user_id, row.display_name, row.handle),
      avatarUrl: sanitizePublicAvatarUrl(row.avatar_url)
    }
  };
}

// Owner action: stamp share consent (idempotent, one-way) and return the
// public payload the share surfaces will render.
export async function consentPortfolioClaimShare(
  db: Pool,
  env: AppEnv,
  claimId: string,
  actor?: Pick<RequestActor, "actorId" | "mode">
): Promise<PublicClaimShare> {
  const resolvedActor = resolveActorOrThrow(env, actor);
  const updated = await db.query<{ id: string }>(
    `
      update realization_events
      set share_consented_at = coalesce(share_consented_at, now())
      where id = $1
        and user_id = $2
        and type = 'resolution_win'
        and exists (
          select 1
          from market_resolutions mr
          where mr.id = realization_events.resolution_id
            and mr.winning_outcome_id = realization_events.outcome_id
        )
      returning id
    `,
    [claimId, resolvedActor.actorId]
  );

  if (!updated.rows[0]) {
    throw new PortfolioClaimServiceError(404, "claim_not_found", "Claim was not found.");
  }

  const share = await readPublicClaimShare(db, claimId);
  if (!share) {
    throw new PortfolioClaimServiceError(404, "claim_not_found", "Claim was not found.");
  }

  return share;
}

export async function sweepPendingPortfolioClaims(
  db: Pool,
  input: {
    olderThanDays: number;
    limit: number;
    actorId: string;
  }
): Promise<PortfolioClaimSweepResponse> {
  const olderThanDays = Math.floor(input.olderThanDays);
  const limit = Math.floor(input.limit);
  const actorId = input.actorId.trim();

  if (!actorId) {
    throw new PortfolioClaimServiceError(400, "invalid_request", "actorId is required.");
  }

  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
    throw new PortfolioClaimServiceError(400, "invalid_request", "olderThanDays must be at least 1.");
  }

  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    throw new PortfolioClaimServiceError(400, "invalid_request", "limit must be between 1 and 500.");
  }

  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  return withTransaction(db, async (client) => {
    const claimIds = await readSweepableClaimIds(client, cutoff, limit);
    let sweptAmount = toDecimal(0);
    const sweptClaimIds: string[] = [];

    for (const claimId of claimIds) {
      const row = await readLockedClaimRowForSweep(client, claimId);

      if (!row || row.claim_status !== "pending") {
        continue;
      }

      const claimed = await claimLockedRow(client, row, {
        actorId,
        triggeredBy: "claim_sweep"
      });
      sweptAmount = sweptAmount.plus(claimed.creditedAmount);
      sweptClaimIds.push(claimId);
    }

    return {
      sweptCount: sweptClaimIds.length,
      sweptAmount: quantizeMoney(sweptAmount),
      claimIds: sweptClaimIds
    };
  });
}
