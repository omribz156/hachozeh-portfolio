alter table users
  add column if not exists handle text;

with handle_candidates as (
  select
    id,
    case
      when char_length(base_handle) between 3 and 24
        and base_handle not in (
          'about',
          'admin',
          'admin-market-management',
          'api',
          'auth',
          'breaking',
          'breaking-markets',
          'cookies',
          'deposit',
          'explore',
          'fallback',
          'feeds',
          'graphs-and-accuracy',
          'help',
          'leaderboard',
          'login',
          'logout',
          'market-detail',
          'markets',
          'me',
          'new',
          'new-markets',
          'notifications',
          'portfolio',
          'privacy',
          'profile',
          'qanda',
          'register',
          'robots',
          'search',
          'settings',
          'share',
          'signup',
          'sitemap',
          'terms',
          'topics',
          'trending',
          'u',
          'wallet'
        )
        then base_handle
      else 'user_' || left(md5(id), 8)
    end as base_handle
  from (
    select
      id,
      btrim(
        regexp_replace(
          lower(coalesce(display_name, '')),
          '[^a-z0-9_]+',
          '_',
          'g'
        ),
        '_'
      ) as base_handle
    from users
    where handle is null
  ) normalized
),
deduped_handles as (
  select
    id,
    base_handle,
    row_number() over (partition by base_handle order by id asc) as duplicate_rank
  from handle_candidates
)
update users u
set handle = case
  when d.duplicate_rank = 1 then d.base_handle
  else left(d.base_handle, 20) || '_' || d.duplicate_rank::text
end
from deduped_handles d
where u.id = d.id
  and u.handle is null;

alter table users
  alter column handle set not null;

alter table users
  drop constraint if exists chk_users_handle_public_shape;

alter table users
  add constraint chk_users_handle_public_shape
    check (
      handle = lower(handle)
      and char_length(handle) between 3 and 24
      and handle ~ '^[a-z0-9][a-z0-9_.]*[a-z0-9]$'
    );

create unique index if not exists uq_users_handle
  on users (handle);

create index if not exists idx_users_handle_active_lookup
  on users (handle)
  where status = 'active'
    and privacy_erased_at is null;
