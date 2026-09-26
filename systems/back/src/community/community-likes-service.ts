// Real likes for the community surface — feed items, discussion opening posts,
// and comments, all keyed by their (globally unique) id. Mirrors the market
// comment-like toggle: a second tap removes it.
import type { Queryable } from "../db/client/pool";

export type LikeState = { count: number; liked: boolean };

// Toggle the viewer's like on a target. Returns the fresh count + state.
export async function toggleCommunityLike(
  db: Queryable,
  userId: string,
  targetId: string
): Promise<{ ok: true; targetId: string; likes: number; liked: boolean }> {
  const removed = await db.query<{ target_id: string }>(
    `delete from community_likes where target_id = $1 and user_id = $2 returning target_id`,
    [targetId, userId]
  );
  if (removed.rowCount === 0) {
    await db.query(
      `insert into community_likes (target_id, user_id, created_at) values ($1, $2, now())
       on conflict (target_id, user_id) do nothing`,
      [targetId, userId]
    );
  }
  const result = await db.query<{ likes: string; liked: boolean }>(
    `
      select
        count(*)::text as likes,
        exists (select 1 from community_likes where target_id = $1 and user_id = $2) as liked
      from community_likes where target_id = $1
    `,
    [targetId, userId]
  );
  const row = result.rows[0];
  return { ok: true, targetId, likes: Number.parseInt(row?.likes ?? "0", 10) || 0, liked: row?.liked ?? false };
}

// Batch like counts + viewer-liked flags for a set of targets (read paths).
export async function readLikeStates(
  db: Queryable,
  targetIds: string[],
  viewerUserId: string | null
): Promise<Map<string, LikeState>> {
  const map = new Map<string, LikeState>();
  if (targetIds.length === 0) return map;
  const counts = await db.query<{ target_id: string; n: string }>(
    `select target_id, count(*)::text as n from community_likes where target_id = any($1::text[]) group by target_id`,
    [targetIds]
  );
  for (const row of counts.rows) map.set(row.target_id, { count: Number.parseInt(row.n, 10) || 0, liked: false });

  if (viewerUserId) {
    const mine = await db.query<{ target_id: string }>(
      `select target_id from community_likes where user_id = $1 and target_id = any($2::text[])`,
      [viewerUserId, targetIds]
    );
    for (const row of mine.rows) {
      const cur = map.get(row.target_id) ?? { count: 0, liked: false };
      map.set(row.target_id, { count: cur.count, liked: true });
    }
  }
  return map;
}
