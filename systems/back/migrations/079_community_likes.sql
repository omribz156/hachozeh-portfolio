-- 079_community_likes.sql — real likes for the community surface. Targets are
-- heterogeneous (a feed item id = post/trade/realization id, a discussion id, a
-- comment id — all globally unique strings), so target_id is a soft reference
-- with no single FK, keyed uniquely per (target, user). Mirrors market_comment_likes.
create table if not exists community_likes (
  target_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  constraint pk_community_likes primary key (target_id, user_id),
  constraint fk_community_likes_user foreign key (user_id) references users (id) on delete restrict
);
create index if not exists idx_community_likes_target on community_likes (target_id);
create index if not exists idx_community_likes_user_created on community_likes (user_id, created_at desc);
