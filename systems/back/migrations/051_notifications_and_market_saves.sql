create table if not exists user_market_saves (
  user_id text not null,
  market_id text not null,
  created_at timestamptz not null default now(),
  constraint pk_user_market_saves primary key (user_id, market_id),
  constraint fk_user_market_saves_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint fk_user_market_saves_market
    foreign key (market_id) references markets (id) on delete restrict
);

create index if not exists idx_user_market_saves_user_created
  on user_market_saves (user_id, created_at desc);

create index if not exists idx_user_market_saves_market_created
  on user_market_saves (market_id, created_at desc);

create table if not exists user_notifications (
  id text primary key,
  user_id text not null,
  type text not null,
  producer_type text not null,
  producer_id text not null,
  market_id text,
  realization_event_id text,
  html text not null,
  amount text,
  amount_tone text,
  claim text,
  claimed boolean not null default false,
  thumb_glyph text,
  thumb_accent text,
  read_at timestamptz,
  opened_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fk_user_notifications_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint fk_user_notifications_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_user_notifications_realization
    foreign key (realization_event_id) references realization_events (id) on delete restrict,
  constraint uq_user_notifications_producer unique (user_id, producer_type, producer_id),
  constraint chk_user_notifications_type
    check (type in ('win', 'loss', 'rise', 'fall', 'streak', 'rank', 'reply', 'close', 'system')),
  constraint chk_user_notifications_amount_tone
    check (amount_tone is null or amount_tone in ('pos', 'neg', 'rise', 'fall'))
);

create index if not exists idx_user_notifications_user_created
  on user_notifications (user_id, created_at desc, id desc);

create index if not exists idx_user_notifications_user_unread
  on user_notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists idx_user_notifications_market_created
  on user_notifications (market_id, created_at desc)
  where market_id is not null;

create table if not exists user_notification_events (
  id text primary key,
  notification_id text not null,
  user_id text not null,
  event_type text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint fk_user_notification_events_notification
    foreign key (notification_id) references user_notifications (id) on delete restrict,
  constraint fk_user_notification_events_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint uq_user_notification_events_type unique (notification_id, event_type),
  constraint chk_user_notification_events_type
    check (event_type in ('resolution_notified', 'result_opened'))
);

create index if not exists idx_user_notification_events_user_created
  on user_notification_events (user_id, created_at desc);
