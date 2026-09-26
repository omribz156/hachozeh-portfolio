-- 078_community_posts_body_floor.sql — allow a 1-char body on community_posts.
-- position/result/milestone (and share) carry an OPTIONAL note; when empty the
-- service stores a "·" sentinel (1 char) that the feed never displays. The old
-- `between 2 and 2000` floor rejected it. The real product minimum for a `take`
-- is still enforced at the service layer (>= 2), not here.
alter table community_posts drop constraint if exists chk_community_posts_body_length;
alter table community_posts
  add constraint chk_community_posts_body_length
  check (char_length(body) between 1 and 2000);
