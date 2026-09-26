alter table markets
  add column if not exists market_family_key text;

create index if not exists idx_markets_family_published_close
  on markets (market_family_key, published_at, close_at)
  where market_family_key is not null;

update markets
set market_family_key = 'boi-rate-decision-v1'
where market_family_key is null
  and id like 'disc-cm-boi-rate-decision-%';

update markets
set market_family_key = 'fed-rate-decision-v1'
where market_family_key is null
  and id like 'disc-cm-fed-rate-decision-%';

update markets
set market_family_key = 'ecb-rate-decision-v1'
where market_family_key is null
  and id like 'disc-cm-ecb-rate-decision-%';
