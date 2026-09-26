import type { Queryable } from "../db/client/pool";
import { resolvePublicDisplayName } from "../shared/public-user-identity";

type ExportUserRow = {
  id: string;
  handle: string;
  status: string;
  role: string;
  trade_access_status: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
};

type ExportIdentityRow = {
  type: string;
  identifier_display: string;
  status: string;
  verified_at: Date | null;
  created_at: Date;
};

type ExportSocialLinkRow = {
  platform: string;
  handle: string | null;
  url: string;
  verified_at: Date | null;
  updated_at: Date;
};

type ExportAccountRow = {
  id: string;
  type: string;
  status: string;
  balance_cached: string;
  created_at: Date;
  updated_at: Date;
};

type ExportPositionRow = {
  market_id: string;
  market_title: string | null;
  outcome_id: string;
  outcome_label: string | null;
  shares: string;
  cost_basis: string;
  realized_pnl: string;
  last_trade_at: Date | null;
  settled_at: Date | null;
  updated_at: Date;
};

type ExportContractPositionRow = ExportPositionRow & {
  requested_outcome_id: string;
  requested_outcome_key: string;
  contract_side: string;
};

type ExportTradeRow = {
  id: string;
  market_id: string;
  market_title: string | null;
  outcome_id: string;
  outcome_label: string | null;
  requested_outcome_key: string | null;
  contract_side: string | null;
  side: string;
  cash_amount: string;
  share_amount: string;
  avg_price: string;
  price_before: string;
  price_after: string;
  created_at: Date;
};

type ExportConsentRow = {
  document: string;
  version: string;
  source: string;
  accepted_at: Date;
};

type ExportNotificationPrefRow = {
  notification_type: string;
  channel_app: boolean;
  channel_external: boolean;
  updated_at: Date;
};

type ExportCommentRow = {
  market_id: string;
  body: string;
  status: string;
  created_at: Date;
};

type ExportCommunityRow = {
  kind: string;
  ref_id: string | null;
  body: string;
  status: string;
  created_at: Date;
};

type ExportFeedbackRow = {
  type: string;
  title: string | null;
  message: string;
  reply_email: string | null;
  status: string;
  created_at: Date;
};

type ExportFollowRow = {
  followed_user_id: string;
  handle: string | null;
  created_at: Date;
};

type ExportCountRow = {
  count: string;
};

export type CurrentUserDataExportResponse = {
  schema: "hachozeh_user_data_export_v1";
  generatedAt: string;
  readable: {
    title: string;
    subtitle: string;
    summary: Array<{
      label: string;
      value: string;
    }>;
    sections: Array<{
      title: string;
      rows: Array<Record<string, string | null>>;
    }>;
  };
  user: {
    id: string;
    handle: string;
    status: string;
    role: string;
    tradeAccessStatus: string;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
  } | null;
  identities: Array<{
    type: string;
    identifier: string;
    status: string;
    verifiedAt: string | null;
    createdAt: string;
  }>;
  socialLinks: Array<{
    platform: string;
    handle: string | null;
    url: string;
    verifiedAt: string | null;
    updatedAt: string;
  }>;
  accounts: Array<{
    id: string;
    type: string;
    status: string;
    balance: string;
    createdAt: string;
    updatedAt: string;
  }>;
  positions: Array<{
    marketId: string;
    marketTitle: string | null;
    outcomeId: string;
    outcomeLabel: string | null;
    shares: string;
    costBasis: string;
    realizedPnl: string;
    lastTradeAt: string | null;
    settledAt: string | null;
    updatedAt: string;
  }>;
  contractPositions: Array<{
    marketId: string;
    marketTitle: string | null;
    outcomeId: string;
    outcomeLabel: string | null;
    requestedOutcomeId: string;
    requestedOutcomeKey: string;
    contractSide: string;
    shares: string;
    costBasis: string;
    realizedPnl: string;
    lastTradeAt: string | null;
    settledAt: string | null;
    updatedAt: string;
  }>;
  trades: Array<{
    id: string;
    marketId: string;
    marketTitle: string | null;
    outcomeId: string;
    outcomeLabel: string | null;
    requestedOutcomeKey: string | null;
    contractSide: string | null;
    side: string;
    cashAmount: string;
    shareAmount: string;
    avgPrice: string;
    priceBefore: string;
    priceAfter: string;
    createdAt: string;
  }>;
  consents: Array<{
    document: string;
    version: string;
    source: string;
    acceptedAt: string;
  }>;
  notificationPreferences: Array<{
    type: string;
    channelApp: boolean;
    channelExternal: boolean;
    updatedAt: string | null;
  }>;
  comments: Array<{
    marketId: string;
    body: string;
    status: string;
    createdAt: string;
  }>;
  community: Array<{
    kind: string;
    refId: string | null;
    body: string;
    status: string;
    createdAt: string;
  }>;
  feedback: Array<{
    type: string;
    title: string | null;
    message: string;
    replyEmail: string | null;
    status: string;
    createdAt: string;
  }>;
  // Social graph. We include the user's own outgoing follows in full (the user's data) and
  // expose incoming follows / profile views only as aggregate counts — listing the other users
  // who follow or viewed them would disclose third parties' personal data inside this export.
  social: {
    followingCount: number;
    followerCount: number;
    profileViewsReceived: number;
    profileViewsMade: number;
    following: Array<{
      userId: string;
      handle: string | null;
      since: string;
    }>;
  };
};

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function hebrewDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
}

function readableMoney(value: string): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return value;
  return `V₪ ${numberValue.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function readableNumber(value: string): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return value;
  return numberValue.toLocaleString("he-IL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  });
}

function mapUser(row: ExportUserRow | null): CurrentUserDataExportResponse["user"] {
  if (!row) return null;

  return {
    id: row.id,
    handle: row.handle,
    status: row.status,
    role: row.role,
    tradeAccessStatus: row.trade_access_status,
    displayName: resolvePublicDisplayName(row.id, row.display_name, row.handle),
    bio: row.bio,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastLoginAt: iso(row.last_login_at)
  };
}

function buildReadableExport(
  payload: Omit<CurrentUserDataExportResponse, "readable">
): CurrentUserDataExportResponse["readable"] {
  const displayName = payload.user?.displayName || payload.user?.handle || "משתמש";

  return {
    title: "ייצוא הנתונים שלי - החוזה",
    subtitle: `נוצר עבור ${displayName} בתאריך ${hebrewDateTime(payload.generatedAt) ?? payload.generatedAt}`,
    summary: [
      { label: "כתובת פרופיל", value: payload.user?.handle ? `/@${payload.user.handle}` : "" },
      { label: "שם לתצוגה", value: payload.user?.displayName ?? "" },
      { label: "סטטוס חשבון", value: payload.user?.status ?? "" },
      { label: "גישה למסחר", value: payload.user?.tradeAccessStatus ?? "" },
      { label: "זהויות כניסה", value: String(payload.identities.length) },
      { label: "חשבונות יתרה", value: String(payload.accounts.length) },
      { label: "פוזיציות", value: String(payload.positions.length + payload.contractPositions.length) },
      { label: "פעולות מסחר", value: String(payload.trades.length) }
    ],
    sections: [
      {
        title: "פרטי חשבון",
        rows: [
          {
            "שם לתצוגה": payload.user?.displayName ?? "",
            "אודות": payload.user?.bio ?? "",
            "נוצר": hebrewDateTime(payload.user?.createdAt ?? null),
            "עודכן": hebrewDateTime(payload.user?.updatedAt ?? null),
            "כניסה אחרונה": hebrewDateTime(payload.user?.lastLoginAt ?? null)
          }
        ]
      },
      {
        title: "זהויות כניסה",
        rows: payload.identities.map((identity) => ({
          "סוג": identity.type,
          "כתובת/מזהה": identity.identifier,
          "סטטוס": identity.status,
          "אומת": hebrewDateTime(identity.verifiedAt),
          "נוצר": hebrewDateTime(identity.createdAt)
        }))
      },
      {
        title: "יתרות",
        rows: payload.accounts.map((account) => ({
          "סוג חשבון": account.type,
          "סטטוס": account.status,
          "יתרה": readableMoney(account.balance),
          "עודכן": hebrewDateTime(account.updatedAt)
        }))
      },
      {
        title: "פוזיציות",
        rows: [
          ...payload.positions.map((position) => ({
            "שוק": position.marketTitle ?? position.marketId,
            "תוצאה": position.outcomeLabel ?? position.outcomeId,
            "כמות": readableNumber(position.shares),
            "עלות בסיס": readableMoney(position.costBasis),
            "רווח/הפסד ממומש": readableMoney(position.realizedPnl),
            "עודכן": hebrewDateTime(position.updatedAt)
          })),
          ...payload.contractPositions.map((position) => ({
            "שוק": position.marketTitle ?? position.marketId,
            "תוצאה": position.outcomeLabel ?? position.outcomeId,
            "צד חוזה": position.contractSide,
            "כמות": readableNumber(position.shares),
            "עלות בסיס": readableMoney(position.costBasis),
            "רווח/הפסד ממומש": readableMoney(position.realizedPnl),
            "עודכן": hebrewDateTime(position.updatedAt)
          }))
        ]
      },
      {
        title: "פעולות מסחר",
        rows: payload.trades.map((trade) => ({
          "זמן": hebrewDateTime(trade.createdAt),
          "שוק": trade.marketTitle ?? trade.marketId,
          "תוצאה": trade.outcomeLabel ?? trade.outcomeId,
          "פעולה": trade.side,
          "צד חוזה": trade.contractSide,
          "סכום": readableMoney(trade.cashAmount),
          "כמות": readableNumber(trade.shareAmount),
          "מחיר ממוצע": trade.avgPrice
        }))
      },
      {
        title: "הסכמות שנקלטו",
        rows: payload.consents.map((consent) => ({
          "מסמך": consent.document,
          "גרסה": consent.version,
          "אופן": consent.source,
          "מועד": hebrewDateTime(consent.acceptedAt)
        }))
      },
      {
        title: "העדפות התראות",
        rows: payload.notificationPreferences.map((pref) => ({
          "סוג": pref.type,
          "באפליקציה": pref.channelApp ? "כן" : "לא",
          "מחוץ לאפליקציה": pref.channelExternal ? "כן" : "לא",
          "עודכן": hebrewDateTime(pref.updatedAt)
        }))
      },
      {
        title: "תגובות בקהילה",
        rows: payload.comments.map((comment) => ({
          "זמן": hebrewDateTime(comment.createdAt),
          "שוק": comment.marketId,
          "תוכן": comment.body,
          "סטטוס": comment.status
        }))
      },
      {
        title: "פניות ומשוב",
        rows: payload.feedback.map((entry) => ({
          "זמן": hebrewDateTime(entry.createdAt),
          "סוג": entry.type,
          "כותרת": entry.title,
          "תוכן": entry.message,
          "דוא\"ל למענה": entry.replyEmail,
          "סטטוס": entry.status
        }))
      },
      {
        title: "רשת חברתית",
        rows: [
          {
            "עוקב אחרי": String(payload.social.followingCount),
            "עוקבים אחריי": String(payload.social.followerCount),
            "צפיות בפרופיל שלי": String(payload.social.profileViewsReceived),
            "צפיות שביצעתי בפרופילים": String(payload.social.profileViewsMade)
          },
          ...payload.social.following.map((follow) => ({
            "עוקב אחרי": follow.handle ? `/@${follow.handle}` : "פרופיל לא זמין",
            "מאז": hebrewDateTime(follow.since),
            "עוקבים אחריי": "",
            "צפיות בפרופיל שלי": "",
            "צפיות שביצעתי בפרופילים": ""
          }))
        ]
      }
    ]
  };
}

export async function readCurrentUserDataExport(
  db: Queryable,
  userId: string
): Promise<CurrentUserDataExportResponse> {
  const [
    userResult,
    identitiesResult,
    socialLinksResult,
    accountsResult,
    positionsResult,
    contractPositionsResult,
    tradesResult
  ] = await Promise.all([
    db.query<ExportUserRow>(
      `
        select
          id,
          handle,
          status,
          role,
          trade_access_status,
          display_name,
          bio,
          avatar_url,
          created_at,
          updated_at,
          last_login_at
        from users
        where id = $1
        limit 1
      `,
      [userId]
    ),
    db.query<ExportIdentityRow>(
      `
        select type, identifier_display, status, verified_at, created_at
        from user_identities
        where user_id = $1
        order by created_at asc
      `,
      [userId]
    ),
    db.query<ExportSocialLinkRow>(
      `
        select platform, handle, url, verified_at, updated_at
        from user_social_links
        where user_id = $1
        order by platform asc
      `,
      [userId]
    ),
    db.query<ExportAccountRow>(
      `
        select id, type, status, balance_cached::text, created_at, updated_at
        from accounts
        where owner_id = $1
        order by created_at asc
      `,
      [userId]
    ),
    db.query<ExportPositionRow>(
      `
        select
          p.market_id,
          m.title as market_title,
          p.outcome_id,
          mo.label as outcome_label,
          p.shares::text,
          p.cost_basis::text,
          p.realized_pnl::text,
          p.last_trade_at,
          p.settled_at,
          p.updated_at
        from positions p
        left join markets m on m.id = p.market_id
        left join market_outcomes mo on mo.market_id = p.market_id and mo.id = p.outcome_id
        where p.user_id = $1
        order by p.updated_at desc
      `,
      [userId]
    ),
    db.query<ExportContractPositionRow>(
      `
        select
          cp.market_id,
          m.title as market_title,
          cp.requested_outcome_id as outcome_id,
          mo.label as outcome_label,
          cp.requested_outcome_id,
          cp.requested_outcome_key,
          cp.contract_side,
          cp.shares::text,
          cp.cost_basis::text,
          cp.realized_pnl::text,
          cp.last_trade_at,
          cp.settled_at,
          cp.updated_at
        from contract_positions cp
        left join markets m on m.id = cp.market_id
        left join market_outcomes mo on mo.market_id = cp.market_id and mo.id = cp.requested_outcome_id
        where cp.user_id = $1
        order by cp.updated_at desc
      `,
      [userId]
    ),
    db.query<ExportTradeRow>(
      `
        select
          t.id,
          t.market_id,
          m.title as market_title,
          t.outcome_id,
          mo.label as outcome_label,
          t.requested_outcome_key,
          t.contract_side,
          t.side,
          t.cash_amount::text,
          t.share_amount::text,
          t.avg_price::text,
          t.price_before::text,
          t.price_after::text,
          t.created_at
        from trades t
        left join markets m on m.id = t.market_id
        left join market_outcomes mo on mo.market_id = t.market_id and mo.id = t.outcome_id
        where t.user_id = $1
        order by t.created_at desc
      `,
      [userId]
    )
  ]);

  const [
    consentsResult,
    notificationPrefsResult,
    commentsResult,
    communityResult,
    feedbackResult,
    followingResult,
    followerCountResult,
    profileViewsReceivedResult,
    profileViewsMadeResult
  ] = await Promise.all([
    db.query<ExportConsentRow>(
      `
        select document, version, source, accepted_at
        from user_consents
        where user_id = $1
        order by accepted_at asc
      `,
      [userId]
    ),
    db.query<ExportNotificationPrefRow>(
      `
        select notification_type, channel_app, channel_external, updated_at
        from notification_preferences
        where user_id = $1
        order by notification_type asc
      `,
      [userId]
    ),
    db.query<ExportCommentRow>(
      `
        select market_id, body, status, created_at
        from market_comments
        where user_id = $1
        order by created_at desc
      `,
      [userId]
    ),
    db.query<ExportCommunityRow>(
      `
        select 'discussion' as kind, market_id as ref_id, body, status, created_at
          from community_discussions where user_id = $1
        union all
        select 'comment' as kind, coalesce(discussion_id, feed_ref) as ref_id, body, status, created_at
          from community_comments where user_id = $1
        union all
        select 'post:' || kind as kind, market_id as ref_id, body, status, created_at
          from community_posts where user_id = $1
        order by created_at desc
      `,
      [userId]
    ),
    db.query<ExportFeedbackRow>(
      `
        select type, title, message, reply_email, status, created_at
        from feedback
        where user_id = $1
        order by created_at desc
      `,
      [userId]
    ),
    db.query<ExportFollowRow>(
      `
        select f.followed_user_id, u.handle, f.created_at
        from user_follows f
        left join users u on u.id = f.followed_user_id
        where f.follower_user_id = $1
        order by f.created_at desc
      `,
      [userId]
    ),
    db.query<ExportCountRow>(
      `select count(*)::text as count from user_follows where followed_user_id = $1`,
      [userId]
    ),
    db.query<ExportCountRow>(
      `select coalesce(sum(view_count), 0)::text as count from user_profile_views_daily where profile_user_id = $1`,
      [userId]
    ),
    db.query<ExportCountRow>(
      `select coalesce(sum(view_count), 0)::text as count from user_profile_views_daily where viewer_user_id = $1`,
      [userId]
    )
  ]);

  const payload: Omit<CurrentUserDataExportResponse, "readable"> = {
    schema: "hachozeh_user_data_export_v1",
    generatedAt: new Date().toISOString(),
    user: mapUser(userResult.rows[0] ?? null),
    identities: identitiesResult.rows.map((row) => ({
      type: row.type,
      identifier: row.identifier_display,
      status: row.status,
      verifiedAt: iso(row.verified_at),
      createdAt: row.created_at.toISOString()
    })),
    socialLinks: socialLinksResult.rows.map((row) => ({
      platform: row.platform,
      handle: row.handle,
      url: row.url,
      verifiedAt: iso(row.verified_at),
      updatedAt: row.updated_at.toISOString()
    })),
    accounts: accountsResult.rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      balance: row.balance_cached,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    })),
    positions: positionsResult.rows.map((row) => ({
      marketId: row.market_id,
      marketTitle: row.market_title,
      outcomeId: row.outcome_id,
      outcomeLabel: row.outcome_label,
      shares: row.shares,
      costBasis: row.cost_basis,
      realizedPnl: row.realized_pnl,
      lastTradeAt: iso(row.last_trade_at),
      settledAt: iso(row.settled_at),
      updatedAt: row.updated_at.toISOString()
    })),
    contractPositions: contractPositionsResult.rows.map((row) => ({
      marketId: row.market_id,
      marketTitle: row.market_title,
      outcomeId: row.outcome_id,
      outcomeLabel: row.outcome_label,
      requestedOutcomeId: row.requested_outcome_id,
      requestedOutcomeKey: row.requested_outcome_key,
      contractSide: row.contract_side,
      shares: row.shares,
      costBasis: row.cost_basis,
      realizedPnl: row.realized_pnl,
      lastTradeAt: iso(row.last_trade_at),
      settledAt: iso(row.settled_at),
      updatedAt: row.updated_at.toISOString()
    })),
    trades: tradesResult.rows.map((row) => ({
      id: row.id,
      marketId: row.market_id,
      marketTitle: row.market_title,
      outcomeId: row.outcome_id,
      outcomeLabel: row.outcome_label,
      requestedOutcomeKey: row.requested_outcome_key,
      contractSide: row.contract_side,
      side: row.side,
      cashAmount: row.cash_amount,
      shareAmount: row.share_amount,
      avgPrice: row.avg_price,
      priceBefore: row.price_before,
      priceAfter: row.price_after,
      createdAt: row.created_at.toISOString()
    })),
    consents: consentsResult.rows.map((row) => ({
      document: row.document,
      version: row.version,
      source: row.source,
      acceptedAt: row.accepted_at.toISOString()
    })),
    notificationPreferences: notificationPrefsResult.rows.map((row) => ({
      type: row.notification_type,
      channelApp: row.channel_app,
      channelExternal: row.channel_external,
      updatedAt: iso(row.updated_at)
    })),
    comments: commentsResult.rows.map((row) => ({
      marketId: row.market_id,
      body: row.body,
      status: row.status,
      createdAt: row.created_at.toISOString()
    })),
    community: communityResult.rows.map((row) => ({
      kind: row.kind,
      refId: row.ref_id,
      body: row.body,
      status: row.status,
      createdAt: row.created_at.toISOString()
    })),
    feedback: feedbackResult.rows.map((row) => ({
      type: row.type,
      title: row.title,
      message: row.message,
      replyEmail: row.reply_email,
      status: row.status,
      createdAt: row.created_at.toISOString()
    })),
    social: {
      followingCount: followingResult.rows.length,
      followerCount: Number(followerCountResult.rows[0]?.count ?? "0"),
      profileViewsReceived: Number(profileViewsReceivedResult.rows[0]?.count ?? "0"),
      profileViewsMade: Number(profileViewsMadeResult.rows[0]?.count ?? "0"),
      following: followingResult.rows.map((row) => ({
        userId: row.followed_user_id,
        handle: row.handle,
        since: row.created_at.toISOString()
      }))
    }
  };

  return {
    ...payload,
    readable: buildReadableExport(payload)
  };
}
