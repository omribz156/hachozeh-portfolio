import { randomUUID } from "node:crypto";

import type { Queryable } from "../../db/client/pool";
import { REFERRAL_DAILY_GRANT_CAP, REFERRAL_GRANT_AMOUNT } from "../../economy/economy-config";
import { transferPlatformTreasuryToUser } from "../../economy/economy-ledger";
import { createReferralRewardNotification } from "../../notifications/notification-feed-service";

// Attribution source values look like "share:win:realization_<uuid>" — the
// claim id identifies the sharer server-side (never trusted from the client
// beyond being a lookup key into consented, owned win claims).
export function parseReferralClaimId(source: string): string | null {
  const match = /^share:[\w.-]*:(realization_[\w-]{10,64})$/.exec(source);
  return match ? match[1] : null;
}

type SharerRow = {
  user_id: string;
  status: string;
  cash_account_id: string;
};

async function hasRecentOpenReferralFlag(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query<{ found: boolean }>(
    `
      select exists (
        select 1
        from user_abuse_flags
        where user_id = $1
          and flag_type = 'referral_velocity'
          and status = 'open'
          and created_at >= now() - interval '24 hours'
      ) as found
    `,
    [userId]
  );
  return result.rows[0]?.found === true;
}

// Credit the sharer when an attributed signup lands. Runs INSIDE the signup
// transaction, so the whole thing is savepoint-guarded: any failure here rolls
// back to the savepoint and signup proceeds untouched — the reward is
// best-effort by contract, the signup is not.
export async function grantReferralReward(
  db: Queryable,
  input: { newUserId: string; source: string }
): Promise<void> {
  const claimId = parseReferralClaimId(input.source);
  if (!claimId) return;

  try {
    await db.query("savepoint referral_grant");
  } catch {
    return;
  }

  try {
    // The sharer is the owner of the consented win claim the link pointed at.
    const sharerResult = await db.query<SharerRow>(
      `
        select re.user_id, u.status, acc.id as cash_account_id
        from realization_events re
        join users u
          on u.id = re.user_id
        join accounts acc
          on acc.owner_id = re.user_id
         and acc.type = 'user_cash'
        where re.id = $1
          and re.type = 'resolution_win'
          and exists (
            select 1
            from market_resolutions mr
            where mr.id = re.resolution_id
              and mr.winning_outcome_id = re.outcome_id
          )
          and re.share_consented_at is not null
        limit 1
      `,
      [claimId]
    );

    const sharer = sharerResult.rows[0];
    if (!sharer || sharer.user_id === input.newUserId || sharer.status !== "active") {
      await db.query("release savepoint referral_grant");
      return;
    }

    const capResult = await db.query<{ granted: string }>(
      `
        select count(*)::text as granted
        from referral_grants
        where sharer_user_id = $1
          and created_at >= now() - interval '24 hours'
      `,
      [sharer.user_id]
    );

    if (Number(capResult.rows[0]?.granted ?? "0") >= REFERRAL_DAILY_GRANT_CAP) {
      // Over the daily cap: no payout, one open flag per 24h for the risk inbox.
      if (!(await hasRecentOpenReferralFlag(db, sharer.user_id))) {
        await db.query(
          `
            insert into user_abuse_flags (id, user_id, flag_type, severity, evidence)
            values ($1, $2, 'referral_velocity', 'review', $3::jsonb)
          `,
          [
            `abuse_flag_${randomUUID()}`,
            sharer.user_id,
            JSON.stringify({
              reason: "referral_daily_cap_exceeded",
              cap: REFERRAL_DAILY_GRANT_CAP,
              claimId,
              newUserId: input.newUserId
            })
          ]
        );
      }
      await db.query("release savepoint referral_grant");
      return;
    }

    // One grant per new user, ever — the unique key makes replays no-ops.
    const inserted = await db.query<{ id: string }>(
      `
        insert into referral_grants (id, new_user_id, sharer_user_id, claim_id, amount)
        values ($1, $2, $3, $4, $5)
        on conflict (new_user_id) do nothing
        returning id
      `,
      [`referral_grant_${randomUUID()}`, input.newUserId, sharer.user_id, claimId, REFERRAL_GRANT_AMOUNT]
    );

    if (!inserted.rows[0]) {
      await db.query("release savepoint referral_grant");
      return;
    }

    await transferPlatformTreasuryToUser(db, {
      userId: sharer.user_id,
      userCashAccountId: sharer.cash_account_id,
      amount: REFERRAL_GRANT_AMOUNT,
      referenceType: "grant",
      referenceId: `referral_grant:${input.newUserId}`,
      createdBy: "auth_session_v1",
      triggeredBy: "system"
    });

    await createReferralRewardNotification(db, sharer.user_id, {
      newUserId: input.newUserId,
      amount: REFERRAL_GRANT_AMOUNT
    });

    await db.query("release savepoint referral_grant");
  } catch {
    try {
      await db.query("rollback to savepoint referral_grant");
    } catch {
      // enclosing transaction handles it from here
    }
  }
}
