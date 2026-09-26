-- 074_community_post_comments.sql — let community_comments attach to a feed POST
-- (authored take/share), not only a discussion. One comment targets exactly one
-- of {discussion_id, post_id}. Reuses the existing comment machinery (moderation,
-- GDPR erasure/export by user_id) rather than a parallel table. Post comments are
-- flat (no replies) for v1. See finish-community-integration.md.

alter table community_comments alter column discussion_id drop not null;
alter table community_comments add column if not exists post_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_community_comments_post'
  ) then
    alter table community_comments
      add constraint fk_community_comments_post
      foreign key (post_id) references community_posts (id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'chk_community_comments_target'
  ) then
    -- exactly one target: a discussion XOR a post
    alter table community_comments
      add constraint chk_community_comments_target
      check ((discussion_id is not null) <> (post_id is not null));
  end if;
end $$;

create index if not exists idx_community_comments_post
  on community_comments (post_id, created_at asc)
  where post_id is not null and parent_comment_id is null and status = 'visible';
