-- 076_community_event_subjects.sql — a community discussion/post can be ABOUT a
-- child market (market_id) OR a parent event (event_id), never both. Markets and
-- events are distinct subjects. See finish-community-integration.md.

-- discussions: subject is required and is exactly one of {market, event}
alter table community_discussions alter column market_id drop not null;
alter table community_discussions add column if not exists event_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_community_discussions_event') then
    alter table community_discussions
      add constraint fk_community_discussions_event
      foreign key (event_id) references events (id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_cd_subject') then
    alter table community_discussions
      add constraint chk_cd_subject
      check ((market_id is not null) <> (event_id is not null));
  end if;
end $$;

create index if not exists idx_community_discussions_event
  on community_discussions (event_id, created_at desc)
  where event_id is not null and status = 'visible';

-- posts: subject is OPTIONAL (a take can reference nothing), but at most one kind
alter table community_posts add column if not exists event_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_community_posts_event') then
    alter table community_posts
      add constraint fk_community_posts_event
      foreign key (event_id) references events (id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_cp_subject') then
    alter table community_posts
      add constraint chk_cp_subject
      check (not (market_id is not null and event_id is not null));
  end if;
end $$;
