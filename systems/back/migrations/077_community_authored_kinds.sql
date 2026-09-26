-- 077_community_authored_kinds.sql — let an authored community post also be a
-- position / result / milestone (the composer's design modes), in addition to
-- take / share. The numbers are SERVER-DERIVED from the author's real
-- contract_positions / realization_events at create time and frozen into `meta`
-- (never client-typed). These coexist with the auto-derived feed items for now;
-- the auto-derived stream can be switched off later (COMMUNITY_FEED_AUTODERIVE).
-- See finish-community-integration.md.

alter table community_posts drop constraint if exists chk_community_posts_kind;
alter table community_posts
  add constraint chk_community_posts_kind
  check (kind in ('take', 'share', 'position', 'result', 'milestone'));

-- frozen derived fields for position/result/milestone posts:
--   position:  { side, amount, outcomeLabel }
--   result:    { resultKind, pnl, entry, outcomeLabel }
--   milestone: { badge, icon }
alter table community_posts add column if not exists meta jsonb;
