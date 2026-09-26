alter table markets
  add column if not exists market_environment text not null default 'prod';

alter table markets
  drop constraint if exists chk_markets_environment;

alter table markets
  add constraint chk_markets_environment
    check (market_environment in ('prod', 'test'));

create index if not exists idx_markets_environment_status_published
  on markets (market_environment, status, published_at desc);
