-- 073_community.sql — Community surface: discussions, their comment tree, and
-- authored feed posts. OWN tables, deliberately decoupled from market_comments
-- (owner decision 2026-07-16: "this surface is on its own"). They share only
-- code-level conventions (status enum, GDPR erasure/export wiring); the product
-- char caps (MAX_POST=280, MAX_COMMENT=1200) are enforced in the service layer —
-- these CHECKs are generous sanity backstops only. See
-- workspace/tasks/queued/finish-community-integration.md (BUILD 2026-07-16).

-- ── discussions: the titled opening post, market-scoped ──────────────────────
create table if not exists community_discussions (
  id text primary key,
  market_id text not null,
  topic text,
  title text not null,
  body text not null,
  user_id text not null,
  status text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- bumped on every new comment so the "active" sort is a cheap column read,
  -- not a max(comment.created_at) subquery.
  last_activity_at timestamptz not null default now(),
  constraint fk_community_discussions_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_community_discussions_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_community_discussions_status
    check (status in ('visible', 'hidden', 'deleted')),
  constraint chk_community_discussions_title_length
    check (char_length(title) between 2 and 200),
  constraint chk_community_discussions_body_length
    check (char_length(body) between 2 and 2000)
);

-- home list: filter by topic, order by recent activity (the "active" sort)
create index if not exists idx_community_discussions_topic_active
  on community_discussions (topic, last_activity_at desc)
  where status = 'visible';
-- home list: newest sort + per-market discussion lookups
create index if not exists idx_community_discussions_created
  on community_discussions (created_at desc)
  where status = 'visible';
create index if not exists idx_community_discussions_market
  on community_discussions (market_id, created_at desc)
  where status = 'visible';
-- author fan-out (GDPR erasure/export, profile)
create index if not exists idx_community_discussions_user
  on community_discussions (user_id, created_at desc);

-- ── comment tree under a discussion (one level of replies) ───────────────────
create table if not exists community_comments (
  id text primary key,
  discussion_id text not null,
  parent_comment_id text,
  user_id text not null,
  body text not null,
  status text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_community_comments_discussion
    foreign key (discussion_id) references community_discussions (id) on delete cascade,
  constraint fk_community_comments_parent
    foreign key (parent_comment_id) references community_comments (id) on delete cascade,
  constraint fk_community_comments_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_community_comments_status
    check (status in ('visible', 'hidden', 'deleted')),
  constraint chk_community_comments_body_length
    check (char_length(body) between 2 and 1200)
);

-- top-level comments of a discussion, oldest-first (thread reading order)
create index if not exists idx_community_comments_discussion
  on community_comments (discussion_id, created_at asc)
  where parent_comment_id is null and status = 'visible';
-- replies under a parent, oldest-first
create index if not exists idx_community_comments_parent
  on community_comments (parent_comment_id, created_at asc)
  where parent_comment_id is not null and status = 'visible';
create index if not exists idx_community_comments_user
  on community_comments (user_id, created_at desc);

-- ── authored feed posts (take / share) ───────────────────────────────────────
-- The live feed is a read-time projection; only user-AUTHORED items are stored.
-- position/result/milestone items are derived from trades/realization_events/
-- streaks at read time, never persisted here.
create table if not exists community_posts (
  id text primary key,
  kind text not null,
  user_id text not null,
  market_id text,
  body text not null,
  status text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_community_posts_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint fk_community_posts_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint chk_community_posts_kind
    check (kind in ('take', 'share')),
  constraint chk_community_posts_status
    check (status in ('visible', 'hidden', 'deleted')),
  constraint chk_community_posts_body_length
    check (char_length(body) between 2 and 2000)
);

-- feed projection reads authored posts newest-first
create index if not exists idx_community_posts_created
  on community_posts (created_at desc)
  where status = 'visible';
create index if not exists idx_community_posts_user
  on community_posts (user_id, created_at desc);
create index if not exists idx_community_posts_market
  on community_posts (market_id, created_at desc)
  where market_id is not null and status = 'visible';
