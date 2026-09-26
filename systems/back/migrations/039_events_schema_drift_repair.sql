-- Repair databases where 028_events.sql is marked applied but the events
-- columns added during rollout are missing (observed after restored dumps).
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
