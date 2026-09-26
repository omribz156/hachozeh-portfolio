-- Beta concept retired (2026-06-10, owner decision: fully open launch).
-- Precondition verified before authoring: all otp_challenges rows with a
-- non-null beta_invite_id were status 'consumed' (6 rows), beta_invites had
-- 7 rows, none load-bearing. Recovery path: the nightly pg_dump taken
-- 2026-06-10 22:05 contains the dropped data.

alter table otp_challenges drop constraint if exists fk_otp_challenges_beta_invite;
alter table otp_challenges drop column if exists beta_invite_id;
drop table if exists beta_invites;
