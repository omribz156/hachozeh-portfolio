-- Extend the market lifecycle NOTIFY (060) to also fire on void — the third terminal
-- transition. Void runs out-of-process on the path operators are told to use (the resolve
-- inbox suggests `npm run oracle -- void-market`, a separate container), and it settles
-- holders by REFUNDING cost basis straight to user cash — so it moves both the portfolio
-- (positions deleted) and the wallet (balance credited immediately). Without this, the CLI
-- void path is blind to live viewers, the same gap 060 closed for resolve.
--
-- `create or replace function` updates the body in place; the trg_markets_lifecycle_notify
-- trigger from 060 already points at it, so no trigger DDL is needed.
create or replace function notify_market_lifecycle() returns trigger as $$
begin
  if new.status is distinct from old.status and new.status in ('closed', 'resolved', 'voided') then
    perform pg_notify(
      'market_lifecycle',
      json_build_object('marketId', new.id, 'status', new.status)::text
    );
  end if;
  return new;
end;
$$ language plpgsql;
