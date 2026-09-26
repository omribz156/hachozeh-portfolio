alter table markets
  drop constraint if exists chk_markets_status;

alter table markets
  add constraint chk_markets_status
  check (status in ('draft', 'open', 'closed', 'resolved', 'voided'));

alter table oracle_cases
  drop constraint if exists chk_oracle_cases_market_status;

alter table oracle_cases
  add constraint chk_oracle_cases_market_status
  check (market_status in ('draft', 'open', 'closed', 'resolved', 'voided'));
