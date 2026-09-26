alter table markets
  add column if not exists close_on_event_completion boolean not null default false,
  add column if not exists event_completion_close_requires_human_approval boolean not null default false;

alter table markets
  drop constraint if exists chk_markets_event_completion_close_policy;

alter table markets
  add constraint chk_markets_event_completion_close_policy
    check (
      close_on_event_completion
      or not event_completion_close_requires_human_approval
    );
