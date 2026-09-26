alter table users
  add column if not exists showcase_categories text[] not null default '{}'::text[];

alter table users
  drop constraint if exists users_showcase_categories_limit_check;

alter table users
  add constraint users_showcase_categories_limit_check
  check (
    array_position(showcase_categories, null) is null
    and coalesce(array_length(showcase_categories, 1), 0) <= 4
  );
