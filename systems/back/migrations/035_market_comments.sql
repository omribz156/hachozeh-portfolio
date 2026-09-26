create table if not exists market_comments (
  id text primary key,
  market_id text not null,
  event_id text,
  parent_comment_id text,
  user_id text not null,
  body text not null,
  status text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_market_comments_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_market_comments_event
    foreign key (event_id) references events (id) on delete restrict,
  constraint fk_market_comments_parent
    foreign key (parent_comment_id) references market_comments (id) on delete cascade,
  constraint fk_market_comments_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_market_comments_status
    check (status in ('visible', 'hidden', 'deleted')),
  constraint chk_market_comments_body_length
    check (char_length(body) between 2 and 1200)
);

create index if not exists idx_market_comments_market_created
  on market_comments (market_id, created_at desc)
  where event_id is null and parent_comment_id is null and status = 'visible';

create index if not exists idx_market_comments_event_created
  on market_comments (event_id, created_at desc)
  where event_id is not null and parent_comment_id is null and status = 'visible';

create index if not exists idx_market_comments_parent_created
  on market_comments (parent_comment_id, created_at asc)
  where parent_comment_id is not null and status = 'visible';

create table if not exists market_comment_likes (
  comment_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  constraint pk_market_comment_likes primary key (comment_id, user_id),
  constraint fk_market_comment_likes_comment
    foreign key (comment_id) references market_comments (id) on delete cascade,
  constraint fk_market_comment_likes_user
    foreign key (user_id) references users (id) on delete restrict
);

create index if not exists idx_market_comment_likes_user_created
  on market_comment_likes (user_id, created_at desc);
