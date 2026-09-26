import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../db/tx/with-transaction";
import { withSavepoint } from "../shared/transaction-savepoint";
import { createStreakMilestoneNotification } from "../notifications/notification-feed-service";
import { insertAuditEvent } from "../shared/audit-events";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import {
  DAILY_LOGIN_BASELINE_REWARD,
  DAILY_LOGIN_GRACE_HOUR,
  DAILY_LOGIN_STREAK_REWARDS,
  ECONOMY_TIME_ZONE,
  EMERGENCY_GRANT_AMOUNT,
  EMERGENCY_GRANT_COOLDOWN_HOURS,
  type FaucetType,
  readDailyStreakReward,
  readNextDailyStreakDay
} from "./economy-config";
import {
  EconomyLedgerError,
  transferPlatformTreasuryToUser
} from "./economy-ledger";

type FaucetStateRow = {
  user_id: string;
  faucet_type: FaucetType;
  current_streak_day: number;
  last_claimed_at: Date | null;
  last_claimed_local_date: Date | string | null;
};

type FaucetClaimRow = {
  id: string;
  faucet_type: FaucetType;
  reward_amount: string;
  streak_day_awarded: number | null;
  claim_window_key: string;
  claim_local_date: Date | string | null;
  eligibility_reason: FaucetClaimEligibilityReason;
  ledger_transaction_id: string;
  created_at: Date;
};

type UserWalletRow = {
  account_id: string;
  balance_cached: string;
};

type UserCreationRow = {
  created_local_date: string | null;
};

type LocalTimeSnapshot = {
  localDate: string;
  localHour: number;
};

type FaucetClaimEligibilityReason =
  | "active_position_streak"
  | "no_active_position_baseline"
  | "bankruptcy_emergency";

export type FaucetStatus = {
  type: FaucetType;
  canClaim: boolean;
  currentStreakDay: number;
  nextStreakDay: number | null;
  rewardAmount: string | null;
  claimWindowKey: string;
  lastClaimedAt: string | null;
  lastClaimedLocalDate: string | null;
  requiresActivePosition: boolean;
  hasActivePosition: boolean;
  reason: string;
};

export type WalletFaucetsResponse = {
  userId: string;
  asOf: string;
  timeZone: string;
  liquidBalance: string;
  hasActivePosition: boolean;
  faucets: {
    dailyLogin: FaucetStatus;
    emergency: FaucetStatus;
  };
};

export type FaucetClaimResponse = {
  userId: string;
  faucetType: FaucetType;
  claimed: boolean;
  alreadyClaimed: boolean;
  rewardAmount: string;
  streakDayAwarded: number | null;
  currentStreakDay: number;
  nextClaimAt: string | null;
  claimWindowKey: string;
  eligibilityReason: FaucetClaimEligibilityReason;
  ledgerTransactionId: string;
  auditEventId: string | null;
  claimedAt: string;
};

export class FaucetServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "FaucetServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function formatLocalDate(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function readLocalTimeSnapshot(now: Date): LocalTimeSnapshot {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECONOMY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    localDate: `${byType["year"]}-${byType["month"]}-${byType["day"]}`,
    localHour: Number(byType["hour"] ?? "0")
  };
}

function diffLocalCalendarDays(left: string, right: string): number {
  const leftMs = Date.UTC(
    Number(left.slice(0, 4)),
    Number(left.slice(5, 7)) - 1,
    Number(left.slice(8, 10))
  );
  const rightMs = Date.UTC(
    Number(right.slice(0, 4)),
    Number(right.slice(5, 7)) - 1,
    Number(right.slice(8, 10))
  );

  return Math.round((rightMs - leftMs) / 86_400_000);
}

function computeNextEligibleStreakDay(
  state: FaucetStateRow,
  localTime: LocalTimeSnapshot
): number {
  const lastLocalDate = formatLocalDate(state.last_claimed_local_date);
  if (!lastLocalDate || state.current_streak_day <= 0) {
    return 1;
  }

  const gapDays = diffLocalCalendarDays(lastLocalDate, localTime.localDate);
  const keepsStreak =
    gapDays === 1 || (gapDays === 2 && localTime.localHour < DAILY_LOGIN_GRACE_HOUR);

  return keepsStreak ? readNextDailyStreakDay(state.current_streak_day) : 1;
}

function readTimeZoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECONOMY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localAsUtcMs = Date.UTC(
    Number(byType["year"]),
    Number(byType["month"]) - 1,
    Number(byType["day"]),
    Number(byType["hour"]),
    Number(byType["minute"]),
    Number(byType["second"])
  );

  return localAsUtcMs - instant.getTime();
}

function buildNextLocalMidnightIso(localDate: string): string {
  const localMidnightAsUtcMs = Date.UTC(
    Number(localDate.slice(0, 4)),
    Number(localDate.slice(5, 7)) - 1,
    Number(localDate.slice(8, 10)) + 1
  );
  const firstPass = new Date(localMidnightAsUtcMs - readTimeZoneOffsetMs(new Date(localMidnightAsUtcMs)));
  const offsetAtMidnight = readTimeZoneOffsetMs(firstPass);

  return new Date(localMidnightAsUtcMs - offsetAtMidnight).toISOString();
}

async function ensureLockedFaucetState(
  client: PoolClient,
  userId: string,
  faucetType: FaucetType
): Promise<FaucetStateRow> {
  await client.query(
    `
      insert into user_faucet_state (user_id, faucet_type)
      values ($1, $2)
      on conflict (user_id, faucet_type) do nothing
    `,
    [userId, faucetType]
  );

  const result = await client.query<FaucetStateRow>(
    `
      select
        user_id,
        faucet_type,
        current_streak_day,
        last_claimed_at,
        last_claimed_local_date::text as last_claimed_local_date
      from user_faucet_state
      where user_id = $1
        and faucet_type = $2
      limit 1
      for update
    `,
    [userId, faucetType]
  );

  if (!result.rows[0]) {
    throw new FaucetServiceError(500, "faucet_state_unavailable", "Faucet state is unavailable.");
  }

  return result.rows[0];
}

async function readUserWallet(client: PoolClient, userId: string): Promise<UserWalletRow> {
  const result = await client.query<UserWalletRow>(
    `
      select id as account_id, balance_cached::text as balance_cached
      from accounts
      where owner_id = $1
        and type = 'user_cash'
        and status = 'active'
      limit 1
    `,
    [userId]
  );

  if (!result.rows[0]) {
    throw new FaucetServiceError(409, "user_cash_unavailable", "User cash account is unavailable.");
  }

  return result.rows[0];
}

async function readUserCreatedLocalDate(client: PoolClient, userId: string): Promise<string> {
  const result = await client.query<UserCreationRow>(
    `
      select to_char(created_at at time zone $2, 'YYYY-MM-DD') as created_local_date
      from users
      where id = $1
      limit 1
    `,
    [userId, ECONOMY_TIME_ZONE]
  );

  const createdLocalDate = result.rows[0]?.created_local_date;
  if (!createdLocalDate) {
    throw new FaucetServiceError(409, "user_unavailable", "User is unavailable.");
  }

  return createdLocalDate;
}

async function readHasActivePosition(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query<{ has_active_position: boolean }>(
    `
      select exists (
        select 1
        from positions p
        join markets m
          on m.id = p.market_id
        where p.user_id = $1
          and p.shares > 0
          and m.status = 'open'
        limit 1
      ) as has_active_position
    `,
    [userId]
  );

  return Boolean(result.rows[0]?.has_active_position);
}

async function readExistingClaim(
  client: PoolClient,
  userId: string,
  faucetType: FaucetType,
  claimWindowKey: string
): Promise<FaucetClaimRow | null> {
  const result = await client.query<FaucetClaimRow>(
    `
      select
        id,
        faucet_type,
        reward_amount::text as reward_amount,
        streak_day_awarded,
        claim_window_key,
        claim_local_date::text as claim_local_date,
        eligibility_reason,
        ledger_transaction_id,
        created_at
      from faucet_claims
      where user_id = $1
        and faucet_type = $2
        and claim_window_key = $3
      limit 1
    `,
    [userId, faucetType, claimWindowKey]
  );

  return result.rows[0] ?? null;
}

async function insertFaucetClaim(
  client: PoolClient,
  input: {
    userId: string;
    faucetType: FaucetType;
    rewardAmount: string;
    streakDayAwarded: number | null;
    claimWindowKey: string;
    claimLocalDate: string | null;
    eligibilityReason: FaucetClaimEligibilityReason;
    ledgerTransactionId: string;
  }
): Promise<string> {
  const claimId = `faucet_claim_${randomUUID()}`;

  await client.query(
    `
      insert into faucet_claims (
        id,
        user_id,
        faucet_type,
        reward_amount,
        streak_day_awarded,
        claim_window_key,
        claim_local_date,
        eligibility_reason,
        ledger_transaction_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      claimId,
      input.userId,
      input.faucetType,
      input.rewardAmount,
      input.streakDayAwarded,
      input.claimWindowKey,
      input.claimLocalDate,
      input.eligibilityReason,
      input.ledgerTransactionId
    ]
  );

  return claimId;
}

async function updateFaucetStateAfterClaim(
  client: PoolClient,
  input: {
    userId: string;
    faucetType: FaucetType;
    currentStreakDay: number;
    lastClaimedAt: Date;
    lastClaimedLocalDate: string | null;
  }
): Promise<void> {
  await client.query(
    `
      update user_faucet_state
      set current_streak_day = $3,
          last_claimed_at = $4,
          last_claimed_local_date = $5,
          updated_at = now()
      where user_id = $1
        and faucet_type = $2
    `,
    [
      input.userId,
      input.faucetType,
      input.currentStreakDay,
      input.lastClaimedAt.toISOString(),
      input.lastClaimedLocalDate
    ]
  );
}

function mapClaimResponse(input: {
  userId: string;
  faucetType: FaucetType;
  row: FaucetClaimRow;
  currentStreakDay: number;
  alreadyClaimed: boolean;
  auditEventId: string | null;
}): FaucetClaimResponse {
  return {
    userId: input.userId,
    faucetType: input.faucetType,
    claimed: !input.alreadyClaimed,
    alreadyClaimed: input.alreadyClaimed,
    rewardAmount: quantizeMoney(input.row.reward_amount),
    streakDayAwarded: input.row.streak_day_awarded,
    currentStreakDay: input.currentStreakDay,
    nextClaimAt:
      input.faucetType === "daily_login" && input.row.claim_local_date
        ? buildNextLocalMidnightIso(formatLocalDate(input.row.claim_local_date) ?? "")
        : null,
    claimWindowKey: input.row.claim_window_key,
    eligibilityReason: input.row.eligibility_reason,
    ledgerTransactionId: input.row.ledger_transaction_id,
    auditEventId: input.auditEventId,
    claimedAt: input.row.created_at.toISOString()
  };
}

function mapLedgerError(error: unknown): never {
  if (error instanceof EconomyLedgerError) {
    throw new FaucetServiceError(
      error.code === "source_insufficient_funds" ? 409 : 500,
      error.code,
      error.message
    );
  }

  throw error;
}

export async function readWalletFaucets(
  db: Pool,
  userId: string,
  now = new Date()
): Promise<WalletFaucetsResponse> {
  const client = await db.connect();

  try {
    const localTime = readLocalTimeSnapshot(now);
    const dailyState = await ensureLockedFaucetState(client, userId, "daily_login");
    const emergencyState = await ensureLockedFaucetState(client, userId, "emergency_bankruptcy");
    const wallet = await readUserWallet(client, userId);
    const hasActivePosition = await readHasActivePosition(client, userId);
    const existingDaily = await readExistingClaim(
      client,
      userId,
      "daily_login",
      localTime.localDate
    );
    const userCreatedLocalDate = await readUserCreatedLocalDate(client, userId);
    const isSignupLocalDay = userCreatedLocalDate === localTime.localDate;
    const dailyCanClaim = !existingDaily && !isSignupLocalDay;
    const nextStreakDay = computeNextEligibleStreakDay(dailyState, localTime);
    const lastEmergencyAt = emergencyState.last_claimed_at;
    const emergencyCooldownUntil = lastEmergencyAt
      ? lastEmergencyAt.getTime() + EMERGENCY_GRANT_COOLDOWN_HOURS * 60 * 60 * 1000
      : 0;
    const liquidBalance = quantizeMoney(wallet.balance_cached);
    const emergencyEligible =
      toDecimal(liquidBalance).lte(0) && !hasActivePosition && emergencyCooldownUntil <= now.getTime();

    return {
      userId,
      asOf: now.toISOString(),
      timeZone: ECONOMY_TIME_ZONE,
      liquidBalance,
      hasActivePosition,
      faucets: {
        dailyLogin: {
          type: "daily_login",
          canClaim: dailyCanClaim,
          currentStreakDay: dailyState.current_streak_day,
          nextStreakDay: hasActivePosition ? nextStreakDay : null,
          rewardAmount: isSignupLocalDay
            ? null
            : hasActivePosition
              ? readDailyStreakReward(nextStreakDay)
              : DAILY_LOGIN_BASELINE_REWARD,
          claimWindowKey: localTime.localDate,
          lastClaimedAt: dailyState.last_claimed_at?.toISOString() ?? null,
          lastClaimedLocalDate: formatLocalDate(dailyState.last_claimed_local_date),
          requiresActivePosition: true,
          hasActivePosition,
          reason: existingDaily
            ? "already_claimed"
            : isSignupLocalDay
              ? "new_account_same_day"
            : hasActivePosition
              ? "active_position_streak"
              : "no_active_position_baseline"
        },
        emergency: {
          type: "emergency_bankruptcy",
          canClaim: emergencyEligible,
          currentStreakDay: 0,
          nextStreakDay: null,
          rewardAmount: emergencyEligible ? EMERGENCY_GRANT_AMOUNT : null,
          claimWindowKey: `emergency:${userId}:${now.toISOString()}`,
          lastClaimedAt: emergencyState.last_claimed_at?.toISOString() ?? null,
          lastClaimedLocalDate: null,
          requiresActivePosition: false,
          hasActivePosition,
          reason: emergencyEligible ? "bankruptcy_emergency" : "not_eligible"
        }
      }
    };
  } finally {
    client.release();
  }
}

export async function claimDailyLoginFaucet(
  db: Pool,
  userId: string,
  now = new Date()
): Promise<FaucetClaimResponse> {
  const localTime = readLocalTimeSnapshot(now);
  const claimWindowKey = localTime.localDate;

  return withTransaction(db, async (client) => {
    const state = await ensureLockedFaucetState(client, userId, "daily_login");
    const existingClaim = await readExistingClaim(client, userId, "daily_login", claimWindowKey);
    if (existingClaim) {
      return mapClaimResponse({
        userId,
        faucetType: "daily_login",
        row: existingClaim,
        currentStreakDay: state.current_streak_day,
        alreadyClaimed: true,
        auditEventId: null
      });
    }

    const userCreatedLocalDate = await readUserCreatedLocalDate(client, userId);
    if (userCreatedLocalDate === localTime.localDate) {
      throw new FaucetServiceError(
        409,
        "daily_login_new_account_same_day",
        "Daily login rewards start on the next local day after signup."
      );
    }

    const wallet = await readUserWallet(client, userId);
    const hasActivePosition = await readHasActivePosition(client, userId);
    const nextStreakDay = computeNextEligibleStreakDay(state, localTime);
    const rewardAmount = hasActivePosition
      ? readDailyStreakReward(nextStreakDay)
      : DAILY_LOGIN_BASELINE_REWARD;
    const streakDayAwarded = hasActivePosition ? nextStreakDay : null;
    const eligibilityReason: FaucetClaimEligibilityReason = hasActivePosition
      ? "active_position_streak"
      : "no_active_position_baseline";

    let transfer;
    try {
      transfer = await transferPlatformTreasuryToUser(client, {
        userId,
        userCashAccountId: wallet.account_id,
        amount: rewardAmount,
        referenceType: "faucet",
        referenceId: `daily_login:${userId}:${claimWindowKey}`,
        idempotencyKey: `daily_login:${userId}:${claimWindowKey}`,
        createdBy: "faucet_service",
        triggeredBy: "user_claim",
        sourceEntryRole: "debit_platform_treasury_faucet",
        targetEntryRole: "credit_user_cash_faucet"
      });
    } catch (error) {
      mapLedgerError(error);
    }

    const claimId = await insertFaucetClaim(client, {
      userId,
      faucetType: "daily_login",
      rewardAmount: transfer.amount,
      streakDayAwarded,
      claimWindowKey,
      claimLocalDate: localTime.localDate,
      eligibilityReason,
      ledgerTransactionId: transfer.ledgerTransactionId
    });

    const nextCurrentStreakDay = hasActivePosition ? nextStreakDay : state.current_streak_day;
    await updateFaucetStateAfterClaim(client, {
      userId,
      faucetType: "daily_login",
      currentStreakDay: nextCurrentStreakDay,
      lastClaimedAt: now,
      lastClaimedLocalDate: localTime.localDate
    });

    // Weekly streak milestone (day 7 of the repeating cycle). Best-effort — a
    // notification failure must not roll back the claim, so it is savepoint-guarded.
    if (hasActivePosition && nextStreakDay === 7) {
      await withSavepoint(client, "faucet_streak_milestone", () =>
        createStreakMilestoneNotification(client, {
          userId,
          streakDay: nextStreakDay,
          rewardAmount: transfer.amount,
          localDate: localTime.localDate
        })
      );
    }

    const auditEventId = await insertAuditEvent(client, {
      actorId: userId,
      action: "user.faucet.claim_daily_login",
      entityType: "faucet_claim",
      entityId: claimId,
      payload: {
        faucetType: "daily_login",
        rewardAmount: transfer.amount,
        streakDayAwarded,
        eligibilityReason,
        claimWindowKey,
        timeZone: ECONOMY_TIME_ZONE
      }
    });

    return {
      userId,
      faucetType: "daily_login",
      claimed: true,
      alreadyClaimed: false,
      rewardAmount: transfer.amount,
      streakDayAwarded,
      currentStreakDay: nextCurrentStreakDay,
      nextClaimAt: buildNextLocalMidnightIso(localTime.localDate),
      claimWindowKey,
      eligibilityReason,
      ledgerTransactionId: transfer.ledgerTransactionId,
      auditEventId,
      claimedAt: now.toISOString()
    };
  });
}

export async function claimEmergencyFaucet(
  db: Pool,
  userId: string,
  now = new Date()
): Promise<FaucetClaimResponse> {
  return withTransaction(db, async (client) => {
    const state = await ensureLockedFaucetState(client, userId, "emergency_bankruptcy");
    const lastClaimedAt = state.last_claimed_at;
    if (
      lastClaimedAt &&
      lastClaimedAt.getTime() + EMERGENCY_GRANT_COOLDOWN_HOURS * 60 * 60 * 1000 > now.getTime()
    ) {
      throw new FaucetServiceError(
        429,
        "emergency_faucet_cooldown",
        "Emergency faucet can only be claimed once per 24 hours."
      );
    }

    const wallet = await readUserWallet(client, userId);
    const hasActivePosition = await readHasActivePosition(client, userId);
    if (toDecimal(wallet.balance_cached).gt(0) || hasActivePosition) {
      throw new FaucetServiceError(
        409,
        "emergency_faucet_not_eligible",
        "Emergency faucet requires zero liquid balance and no active open positions."
      );
    }

    let transfer;
    try {
      transfer = await transferPlatformTreasuryToUser(client, {
        userId,
        userCashAccountId: wallet.account_id,
        amount: EMERGENCY_GRANT_AMOUNT,
        referenceType: "faucet",
        referenceId: `emergency_bankruptcy:${userId}:${now.toISOString()}`,
        idempotencyKey: `emergency_bankruptcy:${userId}:${now.toISOString()}`,
        createdBy: "faucet_service",
        triggeredBy: "user_claim",
        sourceEntryRole: "debit_platform_treasury_faucet",
        targetEntryRole: "credit_user_cash_faucet"
      });
    } catch (error) {
      mapLedgerError(error);
    }

    const claimWindowKey = `emergency:${userId}:${now.toISOString()}`;
    const claimId = await insertFaucetClaim(client, {
      userId,
      faucetType: "emergency_bankruptcy",
      rewardAmount: transfer.amount,
      streakDayAwarded: null,
      claimWindowKey,
      claimLocalDate: null,
      eligibilityReason: "bankruptcy_emergency",
      ledgerTransactionId: transfer.ledgerTransactionId
    });

    await updateFaucetStateAfterClaim(client, {
      userId,
      faucetType: "emergency_bankruptcy",
      currentStreakDay: 0,
      lastClaimedAt: now,
      lastClaimedLocalDate: null
    });

    const auditEventId = await insertAuditEvent(client, {
      actorId: userId,
      action: "user.faucet.claim_emergency",
      entityType: "faucet_claim",
      entityId: claimId,
      payload: {
        faucetType: "emergency_bankruptcy",
        rewardAmount: transfer.amount,
        eligibilityReason: "bankruptcy_emergency",
        cooldownHours: EMERGENCY_GRANT_COOLDOWN_HOURS
      }
    });

    return {
      userId,
      faucetType: "emergency_bankruptcy",
      claimed: true,
      alreadyClaimed: false,
      rewardAmount: transfer.amount,
      streakDayAwarded: null,
      currentStreakDay: 0,
      nextClaimAt: new Date(
        now.getTime() + EMERGENCY_GRANT_COOLDOWN_HOURS * 60 * 60 * 1000
      ).toISOString(),
      claimWindowKey,
      eligibilityReason: "bankruptcy_emergency",
      ledgerTransactionId: transfer.ledgerTransactionId,
      auditEventId,
      claimedAt: now.toISOString()
    };
  });
}
