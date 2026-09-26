-- Allow comment reports to land in the existing feedback inbox as type 'report'.
-- Part of the UGC notice-and-action lever: a signed-in user reporting a comment creates a
-- feedback row of type 'report' that the operator sees alongside other feedback.

alter table feedback drop constraint if exists chk_feedback_type;

alter table feedback
  add constraint chk_feedback_type
  check (type in ('idea', 'bug', 'feedback', 'report'));
