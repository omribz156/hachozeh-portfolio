import { describe, expect, it, vi } from "vitest";

import {
  broadcastSystemNotification,
  createReplyNotification,
  createResolutionNotifications,
  createStreakMilestoneNotification,
  dismissClosingSoonNotificationsForClosedMarkets,
  dismissAllNotifications,
  dismissNotification,
  emitClosingSoonNotifications,
  markAllNotificationsRead,
  markAllNotificationsUnread,
  readNotificationFeed
} from "../../src/notifications/notification-feed-service";

describe("notification feed service", () => {
  it("maps feed rows to bell notification items", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from user_notifications") && sql.includes("order by nu.created_at")) {
          expect(sql).toContain("nu.dismissed_at is null");
          return {
            rows: [
              {
                id: "notif_1",
                type: "win",
                market_id: "market_seed_next_prime_minister",
                html: '<b>הוכרע</b>: <span class="hz-notif__q">מי יהיה ראש הממשלה הבא?</span>',
                amount: "+V₪ 120",
                amount_tone: "pos",
                claim: null,
                claimed: false,
                thumb_glyph: "emoji_events",
                thumb_accent: "var(--hz-action-buy-strong)",
                market_contract: {
                  objectType: "market_contract_v1",
                  image: {
                    src: "/assets/images/markets/next-prime-minister.svg",
                    alt: "תמונת שוק",
                    rights: {
                      publicUse: "allowed",
                      status: "hachozeh-owned"
                    }
                  }
                },
                market_category_key: "politics",
                market_title: "מי יהיה ראש הממשלה הבא?",
                metadata: {
                  marketTitle: "מי יהיה ראש הממשלה הבא?",
                  accFrom: 50,
                  accTo: 67,
                  streak: 2
                },
                read_at: null,
                created_at: new Date()
              }
            ]
          };
        }

        if (sql.includes("count(*)")) {
          expect(sql).toContain("dismissed_at is null");
          return { rows: [{ count: "1" }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const payload = await readNotificationFeed(db as never, "user_1");

    expect(payload.unreadCount).toBe(1);
    expect(payload.items[0]).toMatchObject({
      id: "notif_1",
      type: "win",
      bucket: "today",
      unread: true,
      market: true,
      marketKey: "next-prime-minister",
      marketTitle: "מי יהיה ראש הממשלה הבא?",
      amount: "+V₪ 120",
      amountTone: "pos",
      accFrom: 50,
      accTo: 67,
      streak: 2,
      thumb: {
        image: "/assets/images/markets/next-prime-minister.svg",
        accent: "var(--hz-action-buy-strong)"
      }
    });
  });

  it("marks every unread notification read with one batched event insert", async () => {
    const insertedEvents: Array<unknown[]> = [];
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("update user_notifications")) {
          expect(sql).toContain("read_at = coalesce(read_at, now())");
          expect(sql).toContain("read_at is null");
          expect(sql).toContain("dismissed_at is null");
          expect(values).toEqual(["user_1"]);
          return { rows: [{ id: "notif_1" }, { id: "notif_2" }, { id: "notif_3" }] };
        }

        if (sql.includes("insert into user_notification_events")) {
          // re-run safety: conflict target must mirror uq_user_notification_events_type
          expect(sql).toContain("on conflict (notification_id, event_type) do nothing");
          expect(sql).toContain("'result_opened'");
          insertedEvents.push(values ?? []);
          const ids = values?.[0] as string[];
          return { rows: [], rowCount: ids.length };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await markAllNotificationsRead(db as never, "user_1");

    expect(result).toEqual({
      markedReadCount: 3,
      unreadCount: 0
    });
    // QUERY-COUNT GUARD (perf audit F4): the whole mark-all-read is 2
    // statements — the bulk UPDATE ... RETURNING plus ONE batched event
    // insert — never one awaited INSERT per notification.
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(insertedEvents).toHaveLength(1);
    const arrays = insertedEvents[0] as unknown[][];
    expect(arrays[0]).toHaveLength(3);
    (arrays[0] as string[]).forEach((id) => expect(id).toMatch(/^notification_event_/));
    expect(arrays[1]).toEqual(["notif_1", "notif_2", "notif_3"]);
    expect(arrays[2]).toEqual(["user_1", "user_1", "user_1"]);
  });

  it("marking all read is a no-op query-count-wise when nothing is unread", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("update user_notifications")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await markAllNotificationsRead(db as never, "user_1");

    expect(result).toEqual({ markedReadCount: 0, unreadCount: 0 });
    // no event insert when nothing was marked read
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("marks all read notifications unread", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("update user_notifications")) {
          expect(sql).toContain("dismissed_at is null");
          expect(values).toEqual(["user_1"]);
          return { rows: [{ id: "notif_1" }, { id: "notif_2" }] };
        }

        if (sql.includes("count(*)")) {
          expect(sql).toContain("dismissed_at is null");
          expect(values).toEqual(["user_1"]);
          return { rows: [{ count: "2" }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await markAllNotificationsUnread(db as never, "user_1");

    expect(result).toEqual({
      markedUnreadCount: 2,
      unreadCount: 2
    });
  });

  it("soft-dismisses every owned notification and zeroes the unread count", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("update user_notifications")) {
          expect(sql).toContain("dismissed_at = now()");
          expect(sql).toContain("dismissed_at is null");
          expect(values).toEqual(["user_1"]);
          return { rows: [{ id: "notif_1" }, { id: "notif_2" }, { id: "notif_3" }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await dismissAllNotifications(db as never, "user_1");

    expect(result).toEqual({
      dismissedCount: 3,
      unreadCount: 0
    });
  });

  it("soft-dismisses one owned notification and hides it from unread count", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("update user_notifications")) {
          expect(sql).toContain("dismissed_at = now()");
          expect(sql).toContain("dismissed_at is null");
          expect(values).toEqual(["notif_1", "user_1"]);
          return { rows: [{ id: "notif_1" }] };
        }

        if (sql.includes("count(*)")) {
          expect(sql).toContain("dismissed_at is null");
          expect(values).toEqual(["user_1"]);
          return { rows: [{ count: "0" }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await dismissNotification(db as never, "user_1", "notif_1");

    expect(result).toEqual({
      id: "notif_1",
      dismissed: true,
      unreadCount: 0
    });
  });

  it("creates idempotent resolution notifications and honors app preference opt-out", async () => {
    const insertedNotifications: Array<unknown[]> = [];
    const insertedEvents: Array<unknown[]> = [];
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("from realization_events re") && sql.includes("join markets m")) {
          expect(values).toEqual(["resolution_1"]);
          return {
            rows: [
              {
                user_id: "winner",
                market_id: "market_a",
                market_title: "שוק עם <טקסט>",
                resolution_id: "resolution_1",
                realization_event_id: "realization_win_1",
                has_win: true,
                proceeds: "120.000000",
                removed_cost_basis: "40.000000",
                realized_pnl: "80.000000",
                channel_app: true
              },
              {
                user_id: "muted",
                market_id: "market_a",
                market_title: "שוק מושתק",
                resolution_id: "resolution_1",
                realization_event_id: "realization_loss_1",
                has_win: false,
                proceeds: "0.000000",
                removed_cost_basis: "40.000000",
                realized_pnl: "-40.000000",
                channel_app: false
              }
            ]
          };
        }

        // batched summary read: one statement for ALL eligible users (opted-out
        // "muted" must NOT appear in the user array)
        if (sql.includes("before_resolved_count")) {
          expect(values).toEqual([["winner"], "resolution_1"]);
          return {
            rows: [
              {
                user_id: "winner",
                before_resolved_count: 2,
                before_win_count: 1,
                current_resolved_count: 1,
                current_win_count: 1
              }
            ]
          };
        }

        // batched timeline read: per-user window capped at 500, same order as
        // the old per-user query (created_at desc, id desc)
        if (sql.includes("rn <= 500")) {
          expect(sql).toContain("row_number() over");
          expect(sql).toContain("order by re.created_at desc, re.id desc");
          expect(values).toEqual([["winner"], "resolution_1"]);
          return {
            rows: [
              { user_id: "winner", type: "resolution_win" },
              { user_id: "winner", type: "resolution_loss" },
              { user_id: "winner", type: "resolution_win" }
            ]
          };
        }

        if (sql.includes("insert into user_notifications")) {
          // re-run safety: conflict target must mirror uq_user_notifications_producer
          expect(sql).toContain("on conflict (user_id, producer_type, producer_id) do nothing");
          insertedNotifications.push(values ?? []);
          const htmls = values?.[6] as string[];
          expect(htmls[0]).toContain("&lt;טקסט&gt;");
          const ids = values?.[0] as string[];
          const userIds = values?.[1] as string[];
          return { rows: ids.map((id, i) => ({ id, user_id: userIds[i] })), rowCount: ids.length };
        }

        if (sql.includes("insert into user_notification_events")) {
          expect(sql).toContain("'resolution_notified'");
          expect(sql).toContain("on conflict (notification_id, event_type) do nothing");
          insertedEvents.push(values ?? []);
          return { rows: [] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await createResolutionNotifications(db as never, "resolution_1");

    expect(result.insertedCount).toBe(1);
    // QUERY-COUNT GUARD (perf audit T1.2): the statement count must stay
    // CONSTANT — candidates + summary + timeline + notification insert +
    // event insert = 5, regardless of how many users resolved. If this count
    // regresses, check for a reintroduced per-row query loop.
    expect(db.query).toHaveBeenCalledTimes(5);
    expect(insertedNotifications).toHaveLength(1);
    const arrays = insertedNotifications[0] as unknown[][];
    // one row: the muted user was filtered before the insert
    expect(arrays[1]).toEqual(["winner"]);
    expect(arrays[2]).toEqual(["win"]);
    expect(arrays[3]).toEqual(["resolution_1"]);
    expect(arrays[8]).toEqual(["pos"]);
    expect(JSON.parse(String(arrays[11]?.[0]))).toMatchObject({
      resolutionId: "resolution_1",
      realizedPnl: "80.000000",
      marketTitle: "שוק עם <טקסט>",
      accFrom: 50,
      accTo: 67,
      streak: 1
    });
    expect(insertedEvents).toHaveLength(1);
    const eventArrays = insertedEvents[0] as unknown[][];
    expect(String(eventArrays[0]?.[0])).toMatch(/^notification_event_/);
    expect(eventArrays[1]).toEqual([arrays[0]?.[0]]);
    expect(eventArrays[2]).toEqual(["winner"]);
  });

  it("re-running a resolution sweep inserts nothing and skips the event write", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from realization_events re") && sql.includes("join markets m")) {
          return {
            rows: [
              {
                user_id: "winner",
                market_id: "market_a",
                market_title: "שוק",
                resolution_id: "resolution_1",
                realization_event_id: "realization_win_1",
                has_win: true,
                proceeds: "120.000000",
                removed_cost_basis: "40.000000",
                realized_pnl: "80.000000",
                channel_app: true
              }
            ]
          };
        }
        if (sql.includes("before_resolved_count")) {
          return { rows: [] };
        }
        if (sql.includes("rn <= 500")) {
          return { rows: [] };
        }
        if (sql.includes("insert into user_notifications")) {
          // every row hit the dedup constraint → nothing returned
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await createResolutionNotifications(db as never, "resolution_1");

    expect(result.insertedCount).toBe(0);
    // no event insert when nothing was inserted → 4 statements, still constant
    expect(db.query).toHaveBeenCalledTimes(4);
  });

  it("creates a reply notification, skipping self-replies and 'comments' opt-outs", async () => {
    const inserts: Array<unknown[]> = [];
    const makeDb = (channelApp: boolean | null) => ({
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("from notification_preferences")) {
          expect(values).toEqual(["recipient", "comments"]);
          return { rows: channelApp === undefined ? [] : [{ channel_app: channelApp }] };
        }
        if (sql.includes("insert into user_notifications")) {
          inserts.push(values ?? []);
          return { rows: [{ id: values?.[0] }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    });

    // self-reply → no insert, no preference lookup
    const selfDb = makeDb(true);
    expect(
      await createReplyNotification(selfDb as never, {
        replyCommentId: "comment_2",
        recipientUserId: "author",
        actorUserId: "author",
        marketId: "market_a",
        marketTitle: "שוק"
      })
    ).toBeNull();
    expect(selfDb.query).not.toHaveBeenCalled();

    // opted out of comments → no insert
    const offDb = makeDb(false);
    expect(
      await createReplyNotification(offDb as never, {
        replyCommentId: "comment_2",
        recipientUserId: "recipient",
        actorUserId: "replier",
        marketId: "market_a",
        marketTitle: "שוק"
      })
    ).toBeNull();

    // default (no pref row) → inserts a 'reply' row keyed on the reply id
    const onDb = makeDb(undefined as never);
    const id = await createReplyNotification(onDb as never, {
      replyCommentId: "comment_2",
      recipientUserId: "recipient",
      actorUserId: "replier",
      marketId: "market_a",
      marketTitle: "שוק"
    });
    expect(id).toMatch(/^notification_/); // a fresh notification id was generated + returned
    // type column = 'reply', producer dedup = (recipient, market_comment_reply, comment_2)
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[2]).toBe("reply");
    expect(inserts[0]?.[3]).toBe("market_comment_reply");
    expect(inserts[0]?.[4]).toBe("comment_2");
  });

  it("creates a weekly streak milestone notification deduped by local date", async () => {
    const inserts: Array<unknown[]> = [];
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("insert into user_notifications")) {
          inserts.push(values ?? []);
          return { rows: [{ id: values?.[0] }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    await createStreakMilestoneNotification(db as never, {
      userId: "user_1",
      streakDay: 7,
      rewardAmount: "400.000000",
      localDate: "2026-06-27"
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[2]).toBe("streak");
    expect(inserts[0]?.[3]).toBe("faucet_streak");
    expect(inserts[0]?.[4]).toBe("daily_login:2026-06-27");
    expect(inserts[0]?.[7]).toBe("+V₪ 400"); // amount column, formatted
    expect(inserts[0]?.[8]).toBe("pos");
  });

  it("emits closing-soon notifications to every holder, deduped per market+hour", async () => {
    const inserts: Array<unknown[]> = [];
    const closeAt = new Date("2026-06-27T18:00:00.000Z");
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets") && sql.includes("status = 'open'")) {
          return { rows: [{ id: "market_a", title: "שוק", close_at: closeAt }] };
        }
        if (sql.includes("insert into user_notifications")) {
          // one INSERT ... SELECT over the market's open holders — the holders
          // subquery lives inside the insert, and the dedup target mirrors
          // uq_user_notifications_producer exactly
          expect(sql).toContain("from contract_positions");
          expect(sql).toContain("settled_at is null");
          expect(sql).toContain("on conflict (user_id, producer_type, producer_id) do nothing");
          inserts.push(values ?? []);
          return { rows: [{ id: "n1" }, { id: "n2" }], rowCount: 2 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await emitClosingSoonNotifications(db as never, {
      evaluatedAt: new Date("2026-06-27T17:00:00.000Z"),
      windowMs: 2 * 60 * 60 * 1000
    });

    expect(result).toEqual({ marketsScanned: 1, notificationsInserted: 2 });
    // QUERY-COUNT GUARD (perf audit T1.2): 1 market-window scan + 1 batched
    // insert per market = 2 statements for a single closing market — never
    // one insert per holder. If this count regresses, check for a
    // reintroduced per-row query loop.
    expect(db.query).toHaveBeenCalledTimes(2);
    const epochHour = Math.floor(closeAt.getTime() / 3_600_000);
    expect(inserts).toHaveLength(1);
    // params: [marketId, producerId, html, metadata]
    expect(inserts[0]?.[0]).toBe("market_a");
    expect(inserts[0]?.[1]).toBe(`market_a:close:${epochHour}`);
    expect(String(inserts[0]?.[2])).toContain("נסגר בקרוב");
    expect(String(inserts[0]?.[2])).toContain("שוק");
    expect(JSON.parse(String(inserts[0]?.[3]))).toEqual({ closeAt: closeAt.toISOString() });
  });

  it("re-running the closing-soon sweep counts zero when every holder is already notified", async () => {
    const closeAt = new Date("2026-06-27T18:00:00.000Z");
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from markets") && sql.includes("status = 'open'")) {
          return { rows: [{ id: "market_a", title: "שוק", close_at: closeAt }] };
        }
        if (sql.includes("insert into user_notifications")) {
          // dedup constraint swallowed every row
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await emitClosingSoonNotifications(db as never, {
      evaluatedAt: new Date("2026-06-27T17:00:00.000Z"),
      windowMs: 2 * 60 * 60 * 1000
    });

    expect(result).toEqual({ marketsScanned: 1, notificationsInserted: 0 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("soft-dismisses closing-soon notifications after the market closes", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("update user_notifications nu");
        expect(sql).toContain("nu.producer_type = 'market_close_soon'");
        expect(sql).toContain("nu.dismissed_at is null");
        expect(sql).toContain("nu.market_id = m.id");
        expect(sql).toContain("m.status <> 'open'");
        expect(sql).toContain("m.close_at <= $1::timestamptz");
        expect(values).toEqual(["2026-06-27T18:00:00.000Z"]);
        return { rows: [{ id: "notif_1" }, { id: "notif_2" }] };
      })
    };

    const result = await dismissClosingSoonNotificationsForClosedMarkets(db as never, {
      evaluatedAt: new Date("2026-06-27T18:00:00.000Z")
    });

    expect(result).toEqual({ dismissedCount: 2 });
  });

  it("broadcasts a system notification to every user under one dedup key", async () => {
    const inserts: Array<unknown[]> = [];
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("insert into user_notifications")) {
          // one INSERT ... SELECT over users; both counts come back from the
          // same statement, and the dedup target mirrors
          // uq_user_notifications_producer exactly
          expect(sql).toContain("select id from users");
          expect(sql).toContain("'system_announcement'");
          expect(sql).toContain("on conflict (user_id, producer_type, producer_id) do nothing");
          inserts.push(values ?? []);
          return { rows: [{ recipients: "3", inserted: "2" }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    const result = await broadcastSystemNotification(db as never, {
      html: "<b>הודעה</b> לכולם",
      key: "launch"
    });

    // inserted < recipients = one user already had the dedup key (re-run safe)
    expect(result).toEqual({ recipients: 3, inserted: 2 });
    // QUERY-COUNT GUARD (perf audit T1.2): the whole broadcast is ONE
    // statement, never a per-user insert loop.
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    // params: [producerId, html, thumbGlyph]
    expect(inserts[0]?.[0]).toBe("system:launch");
    expect(inserts[0]?.[1]).toBe("<b>הודעה</b> לכולם");
    expect(inserts[0]?.[2]).toBe("campaign");
  });
});
