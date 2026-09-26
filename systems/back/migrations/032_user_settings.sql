alter table users
  add column if not exists display_name text,
  add column if not exists bio text,
  add column if not exists avatar_url text;

alter table users
  drop constraint if exists chk_users_bio_length;

alter table users
  add constraint chk_users_bio_length
    check (bio is null or char_length(bio) <= 100);

create table if not exists notification_preferences (
  user_id text not null,
  notification_type text not null,
  channel_app boolean not null default true,
  channel_external boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint pk_notification_preferences primary key (user_id, notification_type),
  constraint fk_notification_preferences_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_notification_preferences_type
    check (notification_type in ('moves', 'resolve', 'comments'))
);

create index if not exists idx_notification_preferences_user_updated
  on notification_preferences (user_id, updated_at desc);
