-- Events entity — the middle tier between series (market_family_key) and
-- market (child). See spec: workspace/docs/superpowers/specs/2026-06-02-events-entity-model-design.md
--
-- Three-tier model:
--   series (markets.market_family_key, unchanged)  ->  event (this table)  ->  market (child, markets.event_id)
--
-- Universal container: every market belongs to exactly one event. A standalone
-- market is an event with one child; a multi-date event (e.g. "US-Iran deal by
-- DATE?") is one event with N child markets shown together. Render mode is a
-- function of child count, decided downstream — not stored here.
--
-- Aggregate volume is intentionally NOT stored on the event: it is derivable by
-- summing children at read time, and storing it would create a maintenance
-- burden (drift on every child trade). The read model computes it. The event
-- owns identity + lifecycle status only. Event status is synchronized by a
-- small trigger below; close/settlement stays per-market.
--
-- Resolution policy is intentionally narrow:
-- - independent_children: default; each child market resolves on its own.
-- - exclusive_first_hit: mutually-exclusive binary stack; once a human-approved
--   YES child wins, unresolved siblings should resolve NO through a later
--   human-gated cascade executor. This is not a void policy.

create table if not exists events (
  id text primary key,
  slug text,
  title text not null,
  description text,
  icon text,
  category_key text,
  -- Series link (orthogonal to event grouping). Mirrors markets.market_family_key
  -- so an event knows which recurring series it belongs to, if any. The series
  -- navigator (date-rail) still reads markets.market_family_key; this is the
  -- denormalized convenience copy at the event tier.
  market_family_key text,
  resolution_policy text not null default 'independent_children',
  sibling_resolution_requires_human_approval boolean not null default true,
  -- Event-completion status (Phase 2.5 semantics): an event is 'completed' when
  -- all of its child markets have reached a terminal state (resolved/voided);
  -- 'active' while any child is still open/closed-pending.
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_events_status check (status in ('active', 'completed')),
  constraint chk_events_resolution_policy check (
    resolution_policy in ('independent_children', 'exclusive_first_hit')
  )
);

alter table events
  add column if not exists resolution_policy text not null default 'independent_children',
  add column if not exists sibling_resolution_requires_human_approval boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_events_resolution_policy'
  ) then
    alter table events
      add constraint chk_events_resolution_policy
      check (resolution_policy in ('independent_children', 'exclusive_first_hit'));
  end if;
end;
$$;

-- Child -> event link. Single FK (not many-to-many) per the spec's pragmatic
-- subset; widen to a join table only if a market ever needs multiple events.
-- Nullable during rollout: markets created before the creation path assigns
-- event_id (Phase 1.5) would otherwise violate a NOT NULL. Tighten to NOT NULL
-- in a later migration once creation always assigns it.
alter table markets
  add column if not exists event_id text references events (id);

-- Mirrors the family index shape (idx_markets_family_published_close) so
-- event-scoped child queries (list the children of an event, ordered) are fast.
create index if not exists idx_markets_event_published_close
  on markets (event_id, published_at, close_at)
  where event_id is not null;

-- Backfill: every existing market becomes its own single-child event. This is
-- the universal-container invariant applied retroactively. No current market is
-- multi-child, so one-event-per-market is exactly right today. The single-market
-- page must render unchanged afterward (childCount = 1 -> today's layout), which
-- is the transparency guard the frontend relies on.
insert into events (
  id,
  slug,
  title,
  description,
  icon,
  category_key,
  market_family_key,
  resolution_policy,
  sibling_resolution_requires_human_approval,
  status,
  created_at,
  updated_at
)
select
  'evt_' || m.id,
  m.id,
  m.title,
  m.description,
  null,
  m.category_key,
  m.market_family_key,
  'independent_children',
  true,
  case when m.status in ('resolved', 'voided') then 'completed' else 'active' end,
  m.created_at,
  now()
from markets m
where m.event_id is null
  and not exists (select 1 from events e where e.id = 'evt_' || m.id);

update markets m
set event_id = 'evt_' || m.id
where m.event_id is null;

create or replace function refresh_market_event_status(target_event_id text)
returns void
language plpgsql
as $$
begin
  if target_event_id is null then
    return;
  end if;

  update events e
  set
    status = case
      when exists (
        select 1
        from markets m
        where m.event_id = target_event_id
          and m.status not in ('resolved', 'voided')
      ) then 'active'
      when exists (
        select 1
        from markets m
        where m.event_id = target_event_id
      ) then 'completed'
      else 'active'
    end,
    updated_at = now()
  where e.id = target_event_id;
end;
$$;

create or replace function refresh_market_event_status_from_market()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform refresh_market_event_status(old.event_id);
    return old;
  end if;

  perform refresh_market_event_status(new.event_id);

  if tg_op = 'UPDATE' and old.event_id is distinct from new.event_id then
    perform refresh_market_event_status(old.event_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_markets_refresh_event_status on markets;
create trigger trg_markets_refresh_event_status
after insert or delete or update of status, event_id on markets
for each row execute function refresh_market_event_status_from_market();

-- Ensure the backfilled events reflect current child state immediately.
update events e
set
  status = case
    when exists (
      select 1
      from markets m
      where m.event_id = e.id
        and m.status not in ('resolved', 'voided')
    ) then 'active'
    when exists (
      select 1
      from markets m
      where m.event_id = e.id
    ) then 'completed'
    else 'active'
  end,
  updated_at = now();
