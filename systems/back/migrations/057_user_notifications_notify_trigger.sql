-- Real-time bell: any INSERT into user_notifications — from ANY process (API,
-- oracle, oracle-worker, the notify:system CLI) — fires a Postgres NOTIFY that the
-- API process LISTENs for and relays down the user's /api/me/notifications/stream
-- SSE. Producers stay completely ignorant of the transport; the DB does the fan-out.
create or replace function notify_user_notification() returns trigger as $$
begin
  perform pg_notify('user_notification', new.user_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_notifications_notify on user_notifications;
create trigger trg_user_notifications_notify
  after insert on user_notifications
  for each row execute function notify_user_notification();
