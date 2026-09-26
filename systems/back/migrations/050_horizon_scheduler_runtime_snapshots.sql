alter table oracle_runtime_snapshots
  drop constraint if exists oracle_runtime_snapshots_runtime_type_check;

alter table oracle_runtime_snapshots
  add constraint oracle_runtime_snapshots_runtime_type_check
  check (
    runtime_type in (
      'heartbeat',
      'alerts',
      'lifecycle-heartbeat',
      'horizon-scheduler'
    )
  );
