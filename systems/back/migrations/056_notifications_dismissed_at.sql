alter table user_notifications
  add column if not exists dismissed_at timestamptz;

create index if not exists idx_user_notifications_user_visible_created
  on user_notifications (user_id, created_at desc, id desc)
  where dismissed_at is null;

create index if not exists idx_user_notifications_user_visible_unread
  on user_notifications (user_id, created_at desc)
  where read_at is null and dismissed_at is null;
