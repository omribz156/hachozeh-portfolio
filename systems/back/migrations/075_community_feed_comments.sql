-- 075_community_feed_comments.sql — let a community comment target ANY feed item
-- (position/result/take/share), not only authored posts. Feed items span trades,
-- realization_events and community_posts, so `feed_ref` is a SOFT reference (the
-- opaque feed id) with no single FK. Supersedes 074's post_id. A comment targets
-- exactly one of {discussion_id, feed_ref}. See finish-community-integration.md.

alter table community_comments add column if not exists feed_ref text;

-- fold the 074 post_id target into the generic feed_ref, then retire post_id
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'community_comments' and column_name = 'post_id'
  ) then
    update community_comments set feed_ref = post_id where post_id is not null and feed_ref is null;
    alter table community_comments drop constraint if exists fk_community_comments_post;
    alter table community_comments drop column post_id;
  end if;
end $$;

drop index if exists idx_community_comments_post;

alter table community_comments drop constraint if exists chk_community_comments_target;
alter table community_comments
  add constraint chk_community_comments_target
  check ((discussion_id is not null) <> (feed_ref is not null));

create index if not exists idx_community_comments_feed
  on community_comments (feed_ref, created_at asc)
  where feed_ref is not null and parent_comment_id is null and status = 'visible';
