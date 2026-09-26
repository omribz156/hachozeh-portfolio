create table if not exists user_follows (
  follower_user_id text not null,
  followed_user_id text not null,
  created_at timestamptz not null default now(),
  constraint pk_user_follows primary key (follower_user_id, followed_user_id),
  constraint fk_user_follows_follower
    foreign key (follower_user_id) references users (id) on delete restrict,
  constraint fk_user_follows_followed
    foreign key (followed_user_id) references users (id) on delete restrict,
  constraint chk_user_follows_not_self
    check (follower_user_id <> followed_user_id)
);

create index if not exists idx_user_follows_followed_created
  on user_follows (followed_user_id, created_at desc);

create index if not exists idx_user_follows_follower_created
  on user_follows (follower_user_id, created_at desc);

create table if not exists user_profile_views_daily (
  profile_user_id text not null,
  viewer_user_id text not null,
  viewed_on date not null default current_date,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  view_count integer not null default 1,
  constraint pk_user_profile_views_daily primary key (profile_user_id, viewer_user_id, viewed_on),
  constraint fk_user_profile_views_profile
    foreign key (profile_user_id) references users (id) on delete restrict,
  constraint fk_user_profile_views_viewer
    foreign key (viewer_user_id) references users (id) on delete restrict,
  constraint chk_user_profile_views_not_self
    check (profile_user_id <> viewer_user_id),
  constraint chk_user_profile_views_count_positive
    check (view_count > 0)
);

create index if not exists idx_user_profile_views_profile_day
  on user_profile_views_daily (profile_user_id, viewed_on desc);
