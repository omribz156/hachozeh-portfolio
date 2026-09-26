import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { Queryable } from "../db/client/pool";
import { buildFallbackImage } from "../discovery/feed/image";
import { resolveCanonicalMarketKeyById } from "../shared/market-identity";

const FEED_LIMIT = 50;

type NotificationType =
  | "win"
  | "loss"
  | "rise"
  | "fall"
  | "streak"
  | "rank"
  | "reply"
  | "close"
  | "system";

type AmountTone = "pos" | "neg" | "rise" | "fall";

type NotificationRow = {
  id: string;
  type: NotificationType;
  market_id: string | null;
  html: string;
  amount: string | null;
  amount_tone: AmountTone | null;
  claim: string | null;
  claimed: boolean;
  thumb_glyph: string | null;
  thumb_accent: string | null;
  market_contract: unknown | null;
  market_category_key: string | null;
  market_title: string | null;
  metadata: unknown;
  read_at: Date | null;
  created_at: Date;
};

type ResolutionNotificationCandidate = {
  user_id: string;
  market_id: string;
  market_title: string;
  resolution_id: string;
  realization_event_id: string;
  has_win: boolean;
  winning_outcome_label: string | null;
  proceeds: string;
  removed_cost_basis: string;
  realized_pnl: string;
  channel_app: boolean | null;
};

type ResolutionTrackRecordDelta = {
  accFrom: number;
  accTo: number;
  streak: number;
};

type ResolutionTrackRecordSummaryRow = {
  user_id: string;
  before_resolved_count: number | string;
  before_win_count: number | string;
  current_resolved_count: number | string;
  current_win_count: number | string;
};

type ResolutionTrackRecordEventRow = {
  user_id: string;
  type: "resolution_win" | "resolution_loss";
};

type NotificationFeedItem = {
  id: string;
  type: NotificationType;
  bucket: "today" | "week" | "earlier";
  html: string;
  time: string;
  unread: boolean;
  market?: boolean;
  marketKey?: string;
  marketTitle?: string;
  amount?: string;
  amountTone?: AmountTone;
  accFrom?: number;
  accTo?: number;
  streak?: number;
  outcomeLabel?: string;
  claim?: string;
  claimed?: boolean;
  // client-side intent: the bell's activate() dispatches on this (e.g. "how-it-works"
  // opens the walkthrough). Sourced from metadata.action.
  action?: string;
  thumb?: {
    image?: string;
    glyph?: string;
    accent?: string;
  };
};

export type NotificationFeedResponse = {
  items: NotificationFeedItem[];
  unreadCount: number;
};

export type NotificationMarkReadResponse = {
  id: string;
  unread: false;
  unreadCount: number;
};

export type NotificationMarkAllReadResponse = {
  markedReadCount: number;
  unreadCount: 0;
};

export type NotificationMarkAllUnreadResponse = {
  markedUnreadCount: number;
  unreadCount: number;
};

export type NotificationDismissResponse = {
  id: string;
  dismissed: true;
  unreadCount: number;
};

export type NotificationDismissAllResponse = {
  dismissedCount: number;
  unreadCount: 0;
};

export type ClosingSoonDismissResponse = {
  dismissedCount: number;
};

export class NotificationFeedServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "NotificationFeedServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAmount(value: string, options?: { negative?: boolean }): string {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return options?.negative ? "-V₪ 0" : "+V₪ 0";
  }

  const formatted = new Intl.NumberFormat("he-IL", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(Math.abs(numeric));

  return `${options?.negative ? "-" : "+"}V₪ ${formatted}`;
}

function buildBucket(createdAt: Date, now = new Date()): NotificationFeedItem["bucket"] {
  const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
  if (ageMs < 24 * 60 * 60 * 1000) return "today";
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return "week";
  return "earlier";
}

function buildTimeLabel(createdAt: Date, now = new Date()): string {
  const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} ד׳`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} ש׳`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `לפני ${days} ימים`;

  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "short"
  }).format(createdAt);
}

function readMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetadataInteger(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

function mapNotificationRow(row: NotificationRow): NotificationFeedItem {
  const metadata = readMetadataObject(row.metadata);
  const marketKey = row.market_id
    ? resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id
    : undefined;
  const fallbackImage =
    row.market_id && row.market_title
      ? buildFallbackImage(
          row.market_contract,
          row.market_category_key,
          row.market_title,
          null
        )
      : null;
  const item: NotificationFeedItem = {
    id: row.id,
    type: row.type,
    bucket: buildBucket(row.created_at),
    html: row.html,
    time: buildTimeLabel(row.created_at),
    unread: row.read_at === null
  };

  if (row.market_id) {
    item.market = true;
    item.marketKey = marketKey;
  }
  const marketTitle = readMetadataString(metadata, "marketTitle") ?? row.market_title?.trim();
  if (marketTitle) item.marketTitle = marketTitle;
  const accFrom = readMetadataInteger(metadata, "accFrom");
  const accTo = readMetadataInteger(metadata, "accTo");
  const streak = readMetadataInteger(metadata, "streak");
  if (accFrom !== null) item.accFrom = accFrom;
  if (accTo !== null) item.accTo = accTo;
  if (streak !== null) item.streak = streak;
  const outcomeLabel = readMetadataString(metadata, "outcomeLabel");
  if (outcomeLabel) item.outcomeLabel = outcomeLabel;
  const action = readMetadataString(metadata, "action");
  if (action) item.action = action;
  if (row.amount) item.amount = row.amount;
  if (row.amount_tone) item.amountTone = row.amount_tone;
  if (row.claim) item.claim = row.claim;
  if (row.claimed) item.claimed = true;
  if (fallbackImage?.src) {
    item.thumb = {
      image: fallbackImage.src,
      ...(row.thumb_accent ? { accent: row.thumb_accent } : {})
    };
  } else if (row.thumb_glyph || row.thumb_accent) {
    item.thumb = {
      glyph: row.thumb_glyph ?? "bar_chart",
      accent: row.thumb_accent ?? "var(--hz-brand)"
    };
  }

  return item;
}

async function readUnreadCount(db: Queryable, userId: string): Promise<number> {
  const result = await db.query<{ count: string | number }>(
    `
      select count(*) as count
      from user_notifications
      where user_id = $1
        and read_at is null
        and dismissed_at is null
    `,
    [userId]
  );

  return Number(result.rows[0]?.count ?? 0) || 0;
}

export async function readNotificationFeed(
  db: Pool,
  userId: string
): Promise<NotificationFeedResponse> {
  const result = await db.query<NotificationRow>(
    `
      select
        nu.id,
        nu.type,
        nu.market_id,
        nu.html,
        nu.amount,
        nu.amount_tone,
        nu.claim,
        (nu.claimed or re.claim_status = 'claimed') as claimed,
        nu.thumb_glyph,
        nu.thumb_accent,
        m.market_contract,
        m.category_key as market_category_key,
        m.title as market_title,
        nu.metadata,
        nu.read_at,
        nu.created_at
      from user_notifications nu
      left join markets m
        on m.id = nu.market_id
      left join realization_events re
        on re.id = nu.realization_event_id
      where nu.user_id = $1
        and nu.dismissed_at is null
      order by nu.created_at desc, nu.id desc
      limit $2
    `,
    [userId, FEED_LIMIT]
  );

  return {
    items: result.rows.map(mapNotificationRow),
    unreadCount: await readUnreadCount(db, userId)
  };
}

export async function markNotificationRead(
  db: Pool,
  userId: string,
  notificationId: string
): Promise<NotificationMarkReadResponse> {
  const result = await db.query<{ id: string }>(
    `
      update user_notifications
      set read_at = coalesce(read_at, now()),
          opened_at = coalesce(opened_at, now())
      where id = $1
        and user_id = $2
      returning id
    `,
    [notificationId, userId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new NotificationFeedServiceError(404, "notification_not_found", "Notification was not found.");
  }

  await insertNotificationEvent(db, {
    notificationId,
    userId,
    eventType: "result_opened"
  });

  return {
    id: row.id,
    unread: false,
    unreadCount: await readUnreadCount(db, userId)
  };
}

export async function dismissNotification(
  db: Pool,
  userId: string,
  notificationId: string
): Promise<NotificationDismissResponse> {
  const result = await db.query<{ id: string }>(
    `
      update user_notifications
      set dismissed_at = now()
      where id = $1
        and user_id = $2
        and dismissed_at is null
      returning id
    `,
    [notificationId, userId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new NotificationFeedServiceError(404, "notification_not_found", "Notification was not found.");
  }

  return {
    id: row.id,
    dismissed: true,
    unreadCount: await readUnreadCount(db, userId)
  };
}

export async function markAllNotificationsRead(
  db: Pool,
  userId: string
): Promise<NotificationMarkAllReadResponse> {
  const result = await db.query<{ id: string }>(
    `
      update user_notifications
      set read_at = coalesce(read_at, now()),
          opened_at = coalesce(opened_at, now())
      where user_id = $1
        and read_at is null
        and dismissed_at is null
      returning id
    `,
    [userId]
  );

  // Batched event write (perf audit F4, same shape as createResolutionNotifications
  // / emitClosingSoonNotifications): one multi-row INSERT ... SELECT keyed off the
  // RETURNING set instead of one awaited INSERT per notification. Conflict target
  // (notification_id, event_type) mirrors uq_user_notification_events_type exactly.
  if (result.rows.length > 0) {
    await db.query(
      `
        insert into user_notification_events (id, notification_id, user_id, event_type, created_at)
        select t.id, t.notification_id, t.user_id, 'result_opened', now()
        from unnest($1::text[], $2::text[], $3::text[]) as t(id, notification_id, user_id)
        on conflict (notification_id, event_type) do nothing
      `,
      [
        result.rows.map(() => `notification_event_${randomUUID()}`),
        result.rows.map((row) => row.id),
        result.rows.map(() => userId)
      ]
    );
  }

  return {
    markedReadCount: result.rows.length,
    unreadCount: 0
  };
}

export async function markAllNotificationsUnread(
  db: Pool,
  userId: string
): Promise<NotificationMarkAllUnreadResponse> {
  const result = await db.query<{ id: string }>(
    `
      update user_notifications
      set read_at = null
      where user_id = $1
        and read_at is not null
        and dismissed_at is null
      returning id
    `,
    [userId]
  );

  return {
    markedUnreadCount: result.rows.length,
    unreadCount: await readUnreadCount(db, userId)
  };
}

export async function dismissAllNotifications(
  db: Pool,
  userId: string
): Promise<NotificationDismissAllResponse> {
  const result = await db.query<{ id: string }>(
    `
      update user_notifications
      set dismissed_at = now()
      where user_id = $1
        and dismissed_at is null
      returning id
    `,
    [userId]
  );

  return {
    dismissedCount: result.rows.length,
    unreadCount: 0
  };
}

export async function dismissClosingSoonNotificationsForClosedMarkets(
  db: Pool,
  options: { evaluatedAt: Date }
): Promise<ClosingSoonDismissResponse> {
  const result = await db.query<{ id: string }>(
    `
      update user_notifications nu
      set dismissed_at = now()
      from markets m
      where nu.market_id = m.id
        and nu.producer_type = 'market_close_soon'
        and nu.dismissed_at is null
        and (
          m.status <> 'open'
          or m.close_at <= $1::timestamptz
        )
      returning nu.id
    `,
    [options.evaluatedAt.toISOString()]
  );

  return {
    dismissedCount: result.rows.length
  };
}

async function insertNotificationEvent(
  db: Queryable,
  input: {
    notificationId: string;
    userId: string;
    eventType: "resolution_notified" | "result_opened";
  }
): Promise<void> {
  await db.query(
    `
      insert into user_notification_events (id, notification_id, user_id, event_type, created_at)
      values ($1, $2, $3, $4, now())
      on conflict (notification_id, event_type) do nothing
    `,
    [`notification_event_${randomUUID()}`, input.notificationId, input.userId, input.eventType]
  );
}

function calculateAccuracyPercent(winCount: number, resolvedCount: number): number {
  if (resolvedCount <= 0) return 0;
  return Math.round((winCount / resolvedCount) * 100);
}

function readCount(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function calculateCurrentWinStreak(rows: ResolutionTrackRecordEventRow[]): number {
  let streak = 0;
  for (const row of rows) {
    if (row.type !== "resolution_win") break;
    streak += 1;
  }
  return streak;
}

// Batched track-record delta: two set-wise reads (one summary aggregate, one
// windowed timeline) covering every affected user at once, then the SAME JS
// delta math as the old per-user path (calculateAccuracyPercent /
// calculateCurrentWinStreak) applied per user. The delta numbers must stay
// bit-identical to the per-user queries this replaced — the SQL is the old
// per-user SQL re-scoped from `user_id = $1` to `user_id = any($1)` with a
// per-user group/partition, nothing else.
async function readResolutionTrackRecordDeltas(
  db: Queryable,
  userIds: string[],
  resolutionId: string
): Promise<Map<string, ResolutionTrackRecordDelta>> {
  const summaryResult = await db.query<ResolutionTrackRecordSummaryRow>(
    `
      with current_resolution as (
        select user_id, min(created_at) as first_created_at
        from realization_events
        where user_id = any($1::text[])
          and resolution_id = $2
          and type in ('resolution_win', 'resolution_loss')
        group by user_id
      )
      select
        re.user_id,
        count(*) filter (
          where re.resolution_id is distinct from $2
        )::int as before_resolved_count,
        count(*) filter (
          where re.resolution_id is distinct from $2
            and re.type = 'resolution_win'
        )::int as before_win_count,
        count(*) filter (
          where re.resolution_id = $2
        )::int as current_resolved_count,
        count(*) filter (
          where re.resolution_id = $2
            and re.type = 'resolution_win'
        )::int as current_win_count
      from realization_events re
      join current_resolution cr
        on cr.user_id = re.user_id
      where re.user_id = any($1::text[])
        and re.type in ('resolution_win', 'resolution_loss')
        and (
          re.resolution_id = $2
          or re.created_at < cr.first_created_at
        )
      group by re.user_id
    `,
    [userIds, resolutionId]
  );

  const timelineResult = await db.query<ResolutionTrackRecordEventRow>(
    `
      with current_resolution as (
        select user_id, min(created_at) as first_created_at
        from realization_events
        where user_id = any($1::text[])
          and resolution_id = $2
          and type in ('resolution_win', 'resolution_loss')
        group by user_id
      ),
      timeline as (
        select
          re.user_id,
          re.type,
          row_number() over (
            partition by re.user_id
            order by re.created_at desc, re.id desc
          ) as rn
        from realization_events re
        join current_resolution cr
          on cr.user_id = re.user_id
        where re.user_id = any($1::text[])
          and re.type in ('resolution_win', 'resolution_loss')
          and (
            re.resolution_id = $2
            or re.created_at < cr.first_created_at
          )
      )
      select user_id, type
      from timeline
      where rn <= 500
      order by user_id, rn
    `,
    [userIds, resolutionId]
  );

  const summaryByUser = new Map<string, ResolutionTrackRecordSummaryRow>();
  for (const row of summaryResult.rows) {
    summaryByUser.set(row.user_id, row);
  }
  const timelineByUser = new Map<string, ResolutionTrackRecordEventRow[]>();
  for (const row of timelineResult.rows) {
    const rows = timelineByUser.get(row.user_id);
    if (rows) {
      rows.push(row);
    } else {
      timelineByUser.set(row.user_id, [row]);
    }
  }

  const deltas = new Map<string, ResolutionTrackRecordDelta>();
  for (const userId of userIds) {
    const summary = summaryByUser.get(userId);
    const beforeResolved = readCount(summary?.before_resolved_count);
    const beforeWins = readCount(summary?.before_win_count);
    const currentResolved = readCount(summary?.current_resolved_count);
    const currentWins = readCount(summary?.current_win_count);
    deltas.set(userId, {
      accFrom: calculateAccuracyPercent(beforeWins, beforeResolved),
      accTo: calculateAccuracyPercent(beforeWins + currentWins, beforeResolved + currentResolved),
      streak: calculateCurrentWinStreak(timelineByUser.get(userId) ?? [])
    });
  }
  return deltas;
}

export async function createResolutionNotifications(
  db: Queryable,
  resolutionId: string
): Promise<{ insertedCount: number }> {
  const result = await db.query<ResolutionNotificationCandidate>(
    `
      select
        re.user_id,
        re.market_id,
        m.title as market_title,
        re.resolution_id,
        min(re.id) as realization_event_id,
        bool_or(re.type = 'resolution_win') as has_win,
        -- The winning outcome = the side the win-holder held (their resolution_win
        -- row's outcome). Null for loss-only holders; only surfaced on wins.
        max(o.label) filter (where re.type = 'resolution_win') as winning_outcome_label,
        coalesce(sum(re.proceeds), 0)::text as proceeds,
        coalesce(sum(re.removed_cost_basis), 0)::text as removed_cost_basis,
        coalesce(sum(re.realized_pnl), 0)::text as realized_pnl,
        np.channel_app
      from realization_events re
      join markets m
        on m.id = re.market_id
      left join market_outcomes o
        on o.market_id = re.market_id
       and o.id = re.outcome_id
      left join notification_preferences np
        on np.user_id = re.user_id
       and np.notification_type = 'resolve'
      where re.resolution_id = $1
        and re.type in ('resolution_win', 'resolution_loss')
      group by re.user_id, re.market_id, m.title, re.resolution_id, np.channel_app
    `,
    [resolutionId]
  );
  // Set-based shape (perf audit T1.2): the old path ran up to 4 sequential
  // queries per resolved-position user. Now: one batched delta read pass
  // (2 statements, see readResolutionTrackRecordDeltas) + one multi-row
  // insert + one multi-row event insert — constant statement count no matter
  // how many holders resolved. Row content (html/amount/metadata) is still
  // built per candidate in JS, byte-identical to the per-row path.
  const candidates = result.rows.filter((row) => row.channel_app !== false);
  if (candidates.length === 0) {
    return { insertedCount: 0 };
  }

  const deltas = await readResolutionTrackRecordDeltas(
    db,
    candidates.map((row) => row.user_id),
    resolutionId
  );

  const values = candidates.map((row) => {
    const type: NotificationType = row.has_win ? "win" : "loss";
    const title = escapeHtml(row.market_title);
    const html = row.has_win
      ? `<b>הוכרע</b>: הפוזיציה שלך ב־<span class="hz-notif__q">${title}</span> נסגרה ברווח.`
      : `<b>הוכרע</b>: הפוזיציה שלך ב־<span class="hz-notif__q">${title}</span> נסגרה בהפסד.`;
    const amount = row.has_win
      ? formatAmount(row.proceeds)
      : formatAmount(row.removed_cost_basis, { negative: true });
    const trackRecordDelta = deltas.get(row.user_id) ?? { accFrom: 0, accTo: 0, streak: 0 };
    return {
      id: `notification_${randomUUID()}`,
      userId: row.user_id,
      type,
      producerId: row.resolution_id,
      marketId: row.market_id,
      realizationEventId: row.realization_event_id,
      html,
      amount,
      amountTone: row.has_win ? "pos" : "neg",
      thumbGlyph: row.has_win ? "emoji_events" : "do_not_disturb_on",
      thumbAccent: row.has_win ? "var(--hz-action-buy-strong)" : "var(--hz-action-sell-strong)",
      metadata: JSON.stringify({
        resolutionId: row.resolution_id,
        realizedPnl: row.realized_pnl,
        marketTitle: row.market_title,
        accFrom: trackRecordDelta.accFrom,
        accTo: trackRecordDelta.accTo,
        streak: trackRecordDelta.streak,
        // Winning outcome (wins only) so the result overlay paints the side that
        // won together with the card — no post-open claim fetch needed.
        ...(row.has_win && row.winning_outcome_label
          ? { outcomeLabel: row.winning_outcome_label }
          : {})
      })
    };
  });

  const inserted = await db.query<{ id: string; user_id: string }>(
    `
      insert into user_notifications (
        id,
        user_id,
        type,
        producer_type,
        producer_id,
        market_id,
        realization_event_id,
        html,
        amount,
        amount_tone,
        thumb_glyph,
        thumb_accent,
        metadata,
        created_at
      )
      select
        t.id,
        t.user_id,
        t.type,
        'market_resolution',
        t.producer_id,
        t.market_id,
        t.realization_event_id,
        t.html,
        t.amount,
        t.amount_tone,
        t.thumb_glyph,
        t.thumb_accent,
        t.metadata::jsonb,
        now()
      from unnest(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
        $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[]
      ) as t(
        id, user_id, type, producer_id, market_id, realization_event_id,
        html, amount, amount_tone, thumb_glyph, thumb_accent, metadata
      )
      on conflict (user_id, producer_type, producer_id) do nothing
      returning id, user_id
    `,
    [
      values.map((v) => v.id),
      values.map((v) => v.userId),
      values.map((v) => v.type),
      values.map((v) => v.producerId),
      values.map((v) => v.marketId),
      values.map((v) => v.realizationEventId),
      values.map((v) => v.html),
      values.map((v) => v.amount),
      values.map((v) => v.amountTone),
      values.map((v) => v.thumbGlyph),
      values.map((v) => v.thumbAccent),
      values.map((v) => v.metadata)
    ]
  );

  if (inserted.rows.length > 0) {
    await db.query(
      `
        insert into user_notification_events (id, notification_id, user_id, event_type, created_at)
        select t.id, t.notification_id, t.user_id, 'resolution_notified', now()
        from unnest($1::text[], $2::text[], $3::text[]) as t(id, notification_id, user_id)
        on conflict (notification_id, event_type) do nothing
      `,
      [
        inserted.rows.map(() => `notification_event_${randomUUID()}`),
        inserted.rows.map((row) => row.id),
        inserted.rows.map((row) => row.user_id)
      ]
    );
  }

  return { insertedCount: inserted.rows.length };
}

// ── generic producer helper ─────────────────────────────────────────────────
// Single-recipient notification kinds (reply/streak/referral/welcome) funnel
// through this insert so the dedup contract (uq_user_notifications_producer)
// and column shape stay in one place. Fan-out producers (resolution /
// closing-soon / system broadcast) use set-based INSERT ... SELECT statements
// against the SAME (user_id, producer_type, producer_id) conflict target —
// see perf audit T1.2. Returns the new id, or null when the dedup key already
// exists — callers count non-null returns to know what actually fired.
type CreateNotificationInput = {
  id?: string;
  userId: string;
  type: NotificationType;
  producerType: string;
  producerId: string;
  html: string;
  marketId?: string | null;
  amount?: string | null;
  amountTone?: AmountTone | null;
  thumbGlyph?: string | null;
  thumbAccent?: string | null;
  metadata?: Record<string, unknown>;
};

async function insertUserNotification(
  db: Queryable,
  input: CreateNotificationInput
): Promise<string | null> {
  const id = input.id ?? `notification_${randomUUID()}`;
  const result = await db.query<{ id: string }>(
    `
      insert into user_notifications (
        id, user_id, type, producer_type, producer_id, market_id,
        html, amount, amount_tone, thumb_glyph, thumb_accent, metadata, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
      on conflict (user_id, producer_type, producer_id) do nothing
      returning id
    `,
    [
      id,
      input.userId,
      input.type,
      input.producerType,
      input.producerId,
      input.marketId ?? null,
      input.html,
      input.amount ?? null,
      input.amountTone ?? null,
      input.thumbGlyph ?? null,
      input.thumbAccent ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return result.rows[0]?.id ?? null;
}

// In-app channel opt-out check. notification_preferences only models three
// categories ('moves' | 'resolve' | 'comments'); a missing row means "send"
// (only an explicit channel_app = false suppresses), mirroring the resolution
// producer's left-join behaviour.
async function isAppChannelEnabled(
  db: Queryable,
  userId: string,
  category: "moves" | "resolve" | "comments"
): Promise<boolean> {
  const result = await db.query<{ channel_app: boolean | null }>(
    `
      select channel_app
      from notification_preferences
      where user_id = $1 and notification_type = $2
      limit 1
    `,
    [userId, category]
  );
  return result.rows[0]?.channel_app !== false;
}

// ── reply ───────────────────────────────────────────────────────────────────
// Someone replied to your top-level comment. Honors the 'comments' preference;
// never notifies a self-reply. Dedup key = the reply comment id (one per reply).
export async function createReplyNotification(
  db: Queryable,
  input: {
    replyCommentId: string;
    recipientUserId: string;
    actorUserId: string;
    marketId: string;
    marketTitle: string | null;
  }
): Promise<string | null> {
  if (!input.recipientUserId || input.recipientUserId === input.actorUserId) {
    return null;
  }
  if (!(await isAppChannelEnabled(db, input.recipientUserId, "comments"))) {
    return null;
  }
  const where = input.marketTitle
    ? `<span class="hz-notif__q">${escapeHtml(input.marketTitle)}</span>`
    : "הדיון";
  return insertUserNotification(db, {
    userId: input.recipientUserId,
    type: "reply",
    producerType: "market_comment_reply",
    producerId: input.replyCommentId,
    marketId: input.marketId,
    html: `<b>תגובה חדשה</b> על התגובה שלך ב־${where}.`,
    thumbGlyph: "forum",
    thumbAccent: "var(--hz-brand)",
    metadata: { commentId: input.replyCommentId }
  });
}

// ── streak ──────────────────────────────────────────────────────────────────
// Daily-login streak hit the weekly peak (day 7). Dedup key = the claim local
// date, so it fires at most once per day even if the claim is retried.
export async function createStreakMilestoneNotification(
  db: Queryable,
  input: {
    userId: string;
    streakDay: number;
    rewardAmount: string;
    localDate: string;
  }
): Promise<string | null> {
  return insertUserNotification(db, {
    userId: input.userId,
    type: "streak",
    producerType: "faucet_streak",
    producerId: `daily_login:${input.localDate}`,
    html: `<b>שבוע מלא של רצף!</b> השלמת ${input.streakDay} ימי כניסה ברציפות.`,
    amount: formatAmount(input.rewardAmount),
    amountTone: "pos",
    thumbGlyph: "local_fire_department",
    thumbAccent: "var(--hz-brand)",
    metadata: { streakDay: input.streakDay, rewardAmount: input.rewardAmount }
  });
}

// ── close ───────────────────────────────────────────────────────────────────
// "Closing soon" — every holder of an open position in a market whose close_at
// falls inside the window gets one notification. Dedup key = market id + the
// close hour, so the scheduler can re-run every tick without spamming (and a
// rescheduled close re-fires, which is the desired behaviour).
export async function emitClosingSoonNotifications(
  db: Pool,
  options: { evaluatedAt: Date; windowMs: number }
): Promise<{ marketsScanned: number; notificationsInserted: number }> {
  const windowEnd = new Date(options.evaluatedAt.getTime() + options.windowMs);
  const markets = await db.query<{ id: string; title: string; close_at: Date }>(
    `
      select id, title, close_at
      from markets
      where status = 'open'
        and close_at > $1::timestamptz
        and close_at <= $2::timestamptz
      order by close_at asc
    `,
    [options.evaluatedAt.toISOString(), windowEnd.toISOString()]
  );

  // One INSERT ... SELECT per market (not one INSERT per holder): the holders
  // subquery mirrors idx_contract_positions_market_open (migration 068) — same
  // (market_id, settled_at is null) shape, so the planner can use it — and the
  // notification content is constant per market, so it's inlined as literal
  // SELECT-list expressions rather than templated per row in JS. Content and
  // dedup key (producer_type/producer_id) are unchanged from the per-row path.
  let notificationsInserted = 0;
  for (const market of markets.rows) {
    const closeAt = new Date(market.close_at);
    const epochHour = Math.floor(closeAt.getTime() / 3_600_000);
    const html = `<b>נסגר בקרוב</b>: <span class="hz-notif__q">${escapeHtml(
      market.title
    )}</span> ננעל למסחר בקרוב — זו ההזדמנות האחרונה לעדכן פוזיציה.`;
    const metadata = JSON.stringify({ closeAt: closeAt.toISOString() });
    const producerId = `${market.id}:close:${epochHour}`;

    const inserted = await db.query<{ id: string }>(
      `
        insert into user_notifications (
          id, user_id, type, producer_type, producer_id, market_id,
          html, amount, amount_tone, thumb_glyph, thumb_accent, metadata, created_at
        )
        select
          'notification_' || gen_random_uuid()::text,
          cp.user_id,
          'close',
          'market_close_soon',
          $2::text,
          $1::text,
          $3::text,
          null,
          null,
          'schedule',
          'var(--hz-signal-falling)',
          $4::jsonb,
          now()
        from (
          select distinct user_id
          from contract_positions
          where market_id = $1 and settled_at is null
        ) cp
        on conflict (user_id, producer_type, producer_id) do nothing
        returning id
      `,
      [market.id, producerId, html, metadata]
    );
    notificationsInserted += inserted.rowCount ?? inserted.rows.length;
  }

  return { marketsScanned: markets.rows.length, notificationsInserted };
}

// ── system ──────────────────────────────────────────────────────────────────
// Platform announcement. No automatic trigger — driven by an operator via the
// notify:system script. `html` is trusted markup (operator-authored).
// Fan a single announcement out to every user. `key` is the shared dedup token
// (so the same announcement is never double-sent). One INSERT ... SELECT over
// users instead of a per-user insert loop; both counts come back from the same
// statement (recipients = users scanned, inserted = rows that survived the
// dedup conflict).
export async function broadcastSystemNotification(
  db: Pool,
  input: { html: string; key: string; thumbGlyph?: string }
): Promise<{ recipients: number; inserted: number }> {
  const result = await db.query<{ recipients: number | string; inserted: number | string }>(
    `
      with recipients as (
        select id from users
      ),
      ins as (
        insert into user_notifications (
          id, user_id, type, producer_type, producer_id, market_id,
          html, amount, amount_tone, thumb_glyph, thumb_accent, metadata, created_at
        )
        select
          'notification_' || gen_random_uuid()::text,
          r.id,
          'system',
          'system_announcement',
          $1::text,
          null,
          $2::text,
          null,
          null,
          $3::text,
          'var(--hz-brand)',
          '{}'::jsonb,
          now()
        from recipients r
        on conflict (user_id, producer_type, producer_id) do nothing
        returning id
      )
      select
        (select count(*) from recipients)::int as recipients,
        (select count(*) from ins)::int as inserted
    `,
    [`system:${input.key}`, input.html, input.thumbGlyph ?? "campaign"]
  );
  const row = result.rows[0];
  return {
    recipients: readCount(row?.recipients),
    inserted: readCount(row?.inserted)
  };
}

// ── referral ─────────────────────────────────────────────────────────────────
// The social reward for sharing: fired when a signup attributed to a user's
// shared win link lands (referral grant already credited). Dedup per new user.
export async function createReferralRewardNotification(
  db: Queryable,
  userId: string,
  input: { newUserId: string; amount: string }
): Promise<string | null> {
  return insertUserNotification(db, {
    userId,
    type: "system",
    producerType: "referral_reward",
    producerId: `referral_reward:${input.newUserId}`,
    html: `השיתוף שלך עבד: חוזה חדש הצטרף דרך הקריאה ששיתפת.`,
    amount: input.amount,
    amountTone: "pos",
    thumbGlyph: "campaign",
    thumbAccent: "var(--hz-brand)",
    metadata: { newUserId: input.newUserId }
  });
}

// ── welcome ───────────────────────────────────────────────────────────────
// Fired once at signup. Clicking it opens the "how it works" walkthrough —
// metadata.action = "how-it-works" → the bell's activate() calls
// window.NaviHowItWorks.open(). Dedup key is per-user so it's one-and-done.
export async function createWelcomeNotification(
  db: Queryable,
  userId: string
): Promise<string | null> {
  return insertUserNotification(db, {
    userId,
    type: "system",
    producerType: "welcome",
    producerId: `welcome:${userId}`,
    html: "<b>ברוך הבא לחוזה !</b> בוא נראה לך איך זה קורה",
    thumbGlyph: "auto_awesome",
    thumbAccent: "var(--hz-brand)",
    metadata: { action: "how-it-works" }
  });
}
