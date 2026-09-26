// Community "subject" = the thing a discussion/post is about: a CHILD market or
// a PARENT event, kept distinct. This module handles the composer picker search,
// resolving a picked subject to an id for storage, and reading event refs for
// display. Market refs live in community-service (readMarketRefs).
import type { Queryable } from "../db/client/pool";
import { resolveMarketId, readMarketKey } from "../markets/market-api/identity";
import { readMarketCategoryMeta } from "../shared/market-category";
import { topicForCategoryLabel } from "./community-shared";

export type CommunitySubject = {
  kind: "market" | "event";
  key: string; // marketKey (child) or event slug (parent)
  title: string;
  cat: string;
  href: string;
  prob: number | null;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Composer picker: markets (children) + events (parents) matching the query,
// events first + tagged. Both are chosen from one list (owner UX decision).
export async function searchCommunitySubjects(db: Queryable, q: string): Promise<CommunitySubject[]> {
  const query = (q || "").trim();
  if (query.length < 2) return [];
  const like = `%${escapeLike(query)}%`;

  const [eventsR, marketsR] = await Promise.all([
    db.query<{ slug: string; title: string; category_key: string | null }>(
      `select slug, title, category_key from events
       where status = 'active' and title ilike $1
       order by updated_at desc limit 4`,
      [like]
    ),
    db.query<{ id: string; title: string; category_key: string | null; top_price: string | null }>(
      `select m.id, m.title, m.category_key,
         (select max(last_price)::text from market_outcome_state os where os.market_id = m.id) as top_price
       from markets m
       where m.published_at is not null and m.title ilike $1
       order by m.updated_at desc limit 6`,
      [like]
    )
  ]);

  const events: CommunitySubject[] = eventsR.rows.map((e) => ({
    kind: "event",
    key: e.slug,
    title: e.title,
    cat: readMarketCategoryMeta(e.category_key)?.label ?? "אירוע",
    href: `/event/${encodeURIComponent(e.slug)}`,
    prob: null
  }));
  const markets: CommunitySubject[] = marketsR.rows.map((m) => {
    const key = readMarketKey(m.id);
    const p = Number(m.top_price);
    return {
      kind: "market",
      key,
      title: m.title,
      cat: readMarketCategoryMeta(m.category_key)?.label ?? "שוק",
      href: `/markets/${encodeURIComponent(key)}`,
      prob: Number.isFinite(p) ? Math.round(p * 100) : null
    };
  });

  return [...events, ...markets];
}

// Resolve a picked subject → the id to store + the coarse topic. Returns null if
// the subject doesn't exist / isn't postable.
export async function resolveCommunitySubject(
  db: Queryable,
  kind: string,
  key: string
): Promise<{ marketId: string | null; eventId: string | null; topic: string | null } | null> {
  if (kind === "event") {
    const r = await db.query<{ id: string; category_key: string | null }>(
      `select id, category_key from events where slug = $1 and status = 'active' limit 1`,
      [key]
    );
    const e = r.rows[0];
    if (!e) return null;
    return { marketId: null, eventId: e.id, topic: topicForCategoryLabel(readMarketCategoryMeta(e.category_key)?.label ?? null) };
  }
  const marketId = resolveMarketId(key);
  const r = await db.query<{ id: string; category_key: string | null }>(
    `select id, category_key from markets where id = $1 and published_at is not null limit 1`,
    [marketId]
  );
  const m = r.rows[0];
  if (!m) return null;
  return { marketId: m.id, eventId: null, topic: topicForCategoryLabel(readMarketCategoryMeta(m.category_key)?.label ?? null) };
}

export type EventRef = {
  slug: string;
  title: string;
  categoryLabel: string;
  prob: number | null; // leading child probability
  candidates: number;
};

// Batch event display refs (for discussions/posts/feed items whose subject is an
// event): title, category, leading-child probability, and child count.
export async function readEventRefs(db: Queryable, eventIds: string[]): Promise<Map<string, EventRef>> {
  const map = new Map<string, EventRef>();
  if (eventIds.length === 0) return map;
  const r = await db.query<{
    id: string;
    slug: string;
    title: string;
    category_key: string | null;
    lead_price: string | null;
    candidates: string;
  }>(
    `
      select e.id, e.slug, e.title, e.category_key,
        agg.lead_price::text as lead_price,
        coalesce(agg.candidates, 0)::text as candidates
      from events e
      left join lateral (
        select
          count(distinct m.id) as candidates,
          max((select max(last_price) from market_outcome_state os where os.market_id = m.id)) as lead_price
        from markets m
        where m.event_id = e.id and m.published_at is not null
      ) agg on true
      where e.id = any($1::text[])
    `,
    [eventIds]
  );
  for (const row of r.rows) {
    const p = Number(row.lead_price);
    map.set(row.id, {
      slug: row.slug,
      title: row.title,
      categoryLabel: readMarketCategoryMeta(row.category_key)?.label ?? "אירוע",
      prob: Number.isFinite(p) ? Math.round(p * 100) : null,
      candidates: Number.parseInt(row.candidates, 10) || 0
    });
  }
  return map;
}
