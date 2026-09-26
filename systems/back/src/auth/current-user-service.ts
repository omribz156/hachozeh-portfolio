import type { Queryable } from "../db/client/pool";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import { maskEmail } from "./email-identity";
import {
  readVerificationTierSummary,
  type VerificationTierSummary
} from "./user-verification-tier-service";

type UserStatus = "active" | "locked" | "archived";
type UserRole = "user" | "admin";
type TradeAccessStatus = "enabled" | "blocked";

type CurrentUserRow = {
  user_id: string;
  user_status: UserStatus;
  user_role: UserRole;
  trade_access_status: TradeAccessStatus;
  lock_reason_code: string | null;
  locked_at: Date | null;
  created_at: Date;
  last_login_at: Date | null;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  showcase_categories: string[];
  identity_type: "email" | "google" | null;
  identifier_display: string | null;
  verified_at: Date | null;
};

type CurrentUserSocialCountsRow = {
  follower_count: number | string;
  following_count: number | string;
};

export type CurrentUserResponse = {
  user: {
    userId: string;
    status: UserStatus;
    role: UserRole;
    tradeAccessStatus: TradeAccessStatus;
    lockReasonCode: string | null;
    lockedAt: string | null;
    createdAt: string;
    lastLoginAt: string | null;
    handle: string;
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    showcaseCategories: string[];
  };
  identity: {
    primary: {
      channel: "email" | "google";
      identifierHint: string;
      email: string | null;
      verifiedAt: string | null;
    } | null;
  };
  capabilities: {
    canTrade: boolean;
    canAccessAdmin: boolean;
  };
  reputation: {
    verification: VerificationTierSummary;
  };
  social: {
    followerCount: number;
    followingCount: number;
  };
};

async function readCurrentUserRow(
  db: Queryable,
  userId: string
): Promise<CurrentUserRow | null> {
  const result = await db.query<CurrentUserRow>(
    `
      select
        u.id as user_id,
        u.status as user_status,
        u.role as user_role,
        u.trade_access_status,
        u.lock_reason_code,
        u.locked_at,
        u.created_at,
        u.last_login_at,
        u.handle,
        u.display_name,
        u.bio,
        u.avatar_url,
        u.showcase_categories,
        identity.type as identity_type,
        identity.identifier_display,
        identity.verified_at
      from users u
      left join lateral (
        select
          ui.type,
          ui.identifier_display,
          ui.verified_at
        from user_identities ui
        where ui.user_id = u.id
          and ui.status = 'active'
        order by ui.verified_at desc nulls last, ui.created_at asc
        limit 1
      ) identity
        on true
      where u.id = $1
      limit 1
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function readCurrentUserSocialCounts(
  db: Queryable,
  userId: string
): Promise<CurrentUserSocialCountsRow> {
  const result = await db.query<CurrentUserSocialCountsRow>(
    `
      select
        (
          select count(*)::int
          from user_follows uf
          join users follower
            on follower.id = uf.follower_user_id
           and follower.status = 'active'
           and follower.privacy_erased_at is null
          where uf.followed_user_id = $1
        ) as follower_count,
        (
          select count(*)::int
          from user_follows uf
          join users followed
            on followed.id = uf.followed_user_id
           and followed.status = 'active'
           and followed.privacy_erased_at is null
          where uf.follower_user_id = $1
        ) as following_count
    `,
    [userId]
  );

  return result.rows[0] ?? { follower_count: 0, following_count: 0 };
}

export async function readCurrentUser(
  db: Queryable,
  userId: string
): Promise<CurrentUserResponse> {
  const [row, verification, socialCounts] = await Promise.all([
    readCurrentUserRow(db, userId),
    readVerificationTierSummary(db, userId),
    readCurrentUserSocialCounts(db, userId)
  ]);

  if (!row) {
    throw new Error(`Current user not found for actor ${userId}.`);
  }

  const canTrade = row.user_status === "active" && row.trade_access_status === "enabled";
  const canAccessAdmin = row.user_status === "active" && row.user_role === "admin";

  return {
    user: {
      userId: row.user_id,
      status: row.user_status,
      role: row.user_role,
      tradeAccessStatus: row.trade_access_status,
      lockReasonCode: row.lock_reason_code,
      lockedAt: row.locked_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
      handle: row.handle,
      displayName: resolvePublicDisplayName(row.user_id, row.display_name, row.handle),
      bio: row.bio,
      avatarUrl: row.avatar_url,
      showcaseCategories: row.showcase_categories ?? []
    },
    identity: {
      primary:
        (row.identity_type === "email" || row.identity_type === "google") && row.identifier_display
          ? {
              channel: row.identity_type,
              identifierHint: maskEmail(row.identifier_display),
              email: row.identifier_display,
              verifiedAt: row.verified_at?.toISOString() ?? null
            }
          : null
    },
    capabilities: {
      canTrade,
      canAccessAdmin
    },
    reputation: {
      verification
    },
    social: {
      followerCount: Number(socialCounts.follower_count) || 0,
      followingCount: Number(socialCounts.following_count) || 0
    }
  };
}
