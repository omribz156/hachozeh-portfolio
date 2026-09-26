-- Real-time market lifecycle: when a market transitions to 'closed' or 'resolved' —
-- from ANY process (the oracle lifecycle-heartbeat worker auto-close/auto-resolve, the
-- back admin routes, the CLI) — fire a Postgres NOTIFY the API process LISTENs for. The
-- listener flips the market detail page live (chrome + price snapshot) and, on resolution,
-- pushes every settled holder's portfolio invalidation. Same fan-out-via-DB design as the
-- bell trigger (057): producers stay completely ignorant of the transport.
--
-- The status-changed guard means exactly one NOTIFY per real transition. Resolution updates
-- markets twice in one txn (status->resolved, then settlement_status->completed), but only
-- the first changes `status`, so it fires once. Postgres holds the NOTIFY until COMMIT, so by
-- the time the listener queries, positions are settled and realization_events are visible.
create or replace function notify_market_lifecycle() returns trigger as $$
begin
  if new.status is distinct from old.status and new.status in ('closed', 'resolved') then
    perform pg_notify(
      'market_lifecycle',
      json_build_object('marketId', new.id, 'status', new.status)::text
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_markets_lifecycle_notify on markets;
create trigger trg_markets_lifecycle_notify
  after update on markets
  for each row execute function notify_market_lifecycle();
