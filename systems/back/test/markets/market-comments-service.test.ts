import { describe, expect, it } from "vitest";

import {
  createMarketComment,
  likeMarketComment,
  MarketCommentsServiceError,
  readMarketComments
} from "../../src/markets/market-comments-service";
import type { Queryable } from "../../src/db/client/pool";

function createDb(queryImpl: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>): Queryable {
  return {
    query: queryImpl
  } as unknown as Queryable;
}

describe("market comments service", () => {
  it("reads comments with replies and viewer like state without exposing position hints", async () => {
    const db = createDb(async (sql, values) => {
      if (sql.includes("select id as market_id, event_id")) {
        expect(values).toEqual(["market_seed_next_prime_minister"]);
        return {
          rows: [{ market_id: "market_seed_next_prime_minister", event_id: null }]
        };
      }

      if (sql.includes("with target as")) {
        expect(sql).not.toContain("user_identities");
        expect(sql).not.toContain("identifier_display");
        expect(sql).not.toContain("contract_positions");
        expect(sql).not.toContain("position_hint");
        expect(sql).toContain("u.status = 'active'");
        expect(sql).toContain("u.privacy_erased_at is null");
        expect(values).toEqual([
          "market_seed_next_prime_minister",
          null,
          30,
          null,
          "user_viewer"
        ]);
        return {
          rows: [
            {
              id: "comment_1",
              market_id: "market_seed_next_prime_minister",
              event_id: null,
              parent_comment_id: null,
              user_id: "user_holder",
              handle: "holder",
              identifier_display: "holder@navi.local",
              avatar_url: "javascript:alert(1)",
              body: "מחזיק כן.",
              created_at: new Date("2026-06-14T10:00:00.000Z"),
              like_count: "2",
              viewer_liked: true,
              has_open_position: true,
              position_label: "yes · מועמד א'"
            },
            {
              id: "comment_2",
              market_id: "market_seed_next_prime_minister",
              event_id: null,
              parent_comment_id: "comment_1",
              user_id: "user_observer",
              handle: "observer",
              identifier_display: "observer@navi.local",
              avatar_url: "/api/uploads/avatars/avatar-observer.webp",
              body: "תגובה.",
              created_at: new Date("2026-06-14T10:01:00.000Z"),
              like_count: "0",
              viewer_liked: false,
              has_open_position: false,
              position_label: null
            },
            {
              id: "comment_3",
              market_id: "market_seed_next_prime_minister",
              event_id: null,
              parent_comment_id: null,
              user_id: "user_observer",
              handle: "observer",
              identifier_display: "observer@navi.local",
              avatar_url: "https://evil.example/observer.webp",
              body: "בלי פוזיציה.",
              created_at: new Date("2026-06-14T09:00:00.000Z"),
              like_count: "1",
              viewer_liked: false,
              has_open_position: false,
              position_label: null
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const payload = await readMarketComments(db, "next-prime-minister", {
      viewerUserId: "user_viewer"
    });

    expect(payload).toMatchObject({
      marketKey: "next-prime-minister",
      marketId: "market_seed_next_prime_minister",
      counts: {
        total: 2,
        replies: 1
      },
      comments: [
        {
          id: "comment_1",
          authorHandle: "holder",
          author: expect.stringMatching(/^חזאי [0-9A-F]{8}$/),
          avatarLabel: "ח",
          avatarUrl: null,
          body: "מחזיק כן.",
          likes: 2,
          likedByViewer: true,
          replies: [
            {
              id: "comment_2",
              authorHandle: "observer",
              author: expect.stringMatching(/^חזאי [0-9A-F]{8}$/),
              avatarUrl: "/api/uploads/avatars/avatar-observer.webp"
            }
          ]
        },
        {
          id: "comment_3",
          authorHandle: "observer",
          author: expect.stringMatching(/^חזאי [0-9A-F]{8}$/),
          avatarUrl: null
        }
      ]
    });
    expect(payload.comments[0]).not.toHaveProperty("authorId");
    expect(payload.comments[0]).not.toHaveProperty("hasOpenPosition");
    expect(payload.comments[0]).not.toHaveProperty("positionLabel");
    expect(payload.comments[0]?.replies[0]).not.toHaveProperty("authorId");
    expect(payload.comments[0]?.replies[0]).not.toHaveProperty("hasOpenPosition");
    expect(payload.comments[0]?.replies[0]).not.toHaveProperty("positionLabel");
  });

  it("creates an event-level reply only when the parent belongs to the same thread", async () => {
    const db = createDb(async (sql, values) => {
      if (sql.includes("select id as market_id, event_id")) {
        return {
          rows: [{ market_id: "market_child_1", event_id: "evt_market_child_1" }]
        };
      }

      if (sql.includes("from market_comments") && sql.includes("parent_comment_id is null")) {
        expect(values).toEqual(["comment_parent", "market_child_1", "evt_market_child_1"]);
        return { rows: [{ id: "comment_parent" }] };
      }

      if (sql.includes("insert into market_comments")) {
        expect(values?.slice(1)).toEqual([
          "market_child_1",
          "evt_market_child_1",
          "comment_parent",
          "user_1",
          "מסכים עם זה"
        ]);
        return {
          rows: [
            {
              id: "comment_new",
              market_id: "market_child_1",
              event_id: "evt_market_child_1",
              parent_comment_id: "comment_parent",
              body: "מסכים עם זה",
              created_at: new Date("2026-06-14T11:00:00.000Z")
            }
          ]
        };
      }

      if (sql.includes("from market_comments c") && sql.includes("where c.id = $1")) {
        expect(values).toEqual(["comment_new", "user_1"]);
        return {
          rows: [
            {
              id: "comment_new",
              market_id: "market_child_1",
              event_id: "evt_market_child_1",
              parent_comment_id: "comment_parent",
              user_id: "user_1",
              handle: "naviuser",
              display_name: null,
              avatar_url: null,
              body: "מסכים עם זה",
              created_at: new Date("2026-06-14T11:00:00.000Z"),
              like_count: "0",
              viewer_liked: false
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const payload = await createMarketComment(
      db,
      "market_child_1",
      "user_1",
      { body: "מסכים עם זה", eventId: "evt_market_child_1" },
      { parentCommentId: "comment_parent" }
    );

    expect(payload).toMatchObject({
      ok: true,
      comment: {
        id: "comment_new",
        eventId: "evt_market_child_1",
        parentCommentId: "comment_parent",
        body: "מסכים עם זה"
      }
    });
  });

  it("rejects comments that target a different event", async () => {
    const db = createDb(async () => ({
      rows: [{ market_id: "market_child_1", event_id: "evt_real" }]
    }));

    await expect(
      createMarketComment(db, "market_child_1", "user_1", {
        body: "בדיקה",
        eventId: "evt_other"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    } satisfies Partial<MarketCommentsServiceError>);
  });

  it("likes a comment when not yet liked (toggle on)", async () => {
    let inserted = false;
    const db = createDb(async (sql, values) => {
      if (sql.includes("select id as market_id, event_id")) {
        return { rows: [{ market_id: "market_seed_next_prime_minister", event_id: null }] };
      }
      if (sql.includes("from market_comments") && sql.includes("limit 1")) {
        expect(values).toEqual(["comment_1", "market_seed_next_prime_minister", null]);
        return { rows: [{ id: "comment_1" }] };
      }
      if (sql.includes("delete from market_comment_likes")) {
        expect(values).toEqual(["comment_1", "user_1"]);
        return { rows: [], rowCount: 0 }; // nothing removed → this tap is a like
      }
      if (sql.includes("insert into market_comment_likes")) {
        inserted = true;
        expect(values).toEqual(["comment_1", "user_1"]);
        return { rows: [] };
      }
      if (sql.includes("count(*)::text as like_count")) {
        return { rows: [{ like_count: "3", viewer_liked: true }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      likeMarketComment(db, "next-prime-minister", "user_1", "comment_1")
    ).resolves.toEqual({ ok: true, commentId: "comment_1", likes: 3, likedByViewer: true });
    expect(inserted).toBe(true);
  });

  it("unlikes a comment when already liked (toggle off)", async () => {
    let inserted = false;
    const db = createDb(async (sql, values) => {
      if (sql.includes("select id as market_id, event_id")) {
        return { rows: [{ market_id: "market_seed_next_prime_minister", event_id: null }] };
      }
      if (sql.includes("from market_comments") && sql.includes("limit 1")) {
        return { rows: [{ id: "comment_1" }] };
      }
      if (sql.includes("delete from market_comment_likes")) {
        return { rows: [{ comment_id: "comment_1" }], rowCount: 1 }; // removed → unlike
      }
      if (sql.includes("insert into market_comment_likes")) {
        inserted = true;
        return { rows: [] };
      }
      if (sql.includes("count(*)::text as like_count")) {
        return { rows: [{ like_count: "2", viewer_liked: false }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      likeMarketComment(db, "next-prime-minister", "user_1", "comment_1")
    ).resolves.toEqual({ ok: true, commentId: "comment_1", likes: 2, likedByViewer: false });
    expect(inserted).toBe(false); // toggle-off must NOT re-insert
  });
});
