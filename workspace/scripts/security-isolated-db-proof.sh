#!/usr/bin/env bash
# Synthetic only; no TCP listener, live credentials, mail, containers or startup jobs.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
pg="${PG_BINDIR:-$(pg_config --bindir)}"
tmp="$(mktemp -d /tmp/hachozeh-security.XXXXXX)"
cleanup() {
  "$pg/pg_ctl" -D "$tmp/data" -m fast -w stop >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
chmod 700 "$tmp"
"$pg/initdb" -D "$tmp/data" --no-locale -E UTF8 -A trust -U proof_admin >/dev/null
"$pg/pg_ctl" -D "$tmp/data" -l "$tmp/postgres.log" -o "-c listen_addresses='' -k $tmp" -w start >/dev/null
"$pg/psql" -h "$tmp" -U proof_admin -d postgres -v ON_ERROR_STOP=1 -c 'create role proof_owner login createdb createrole' >/dev/null
export DB_HOST="$tmp" DB_PORT=5432 DB_USER=proof_owner DB_PASSWORD=synthetic DB_NAME=navi_security_test
export NAVI_ENV_FILE=/dev/null NODE_ENV=test DEPLOY_ENV=development DB_TLS_MODE=disable
export RESEND_API_KEY='' GOOGLE_OAUTH_CLIENT_ID='' GOOGLE_OAUTH_CLIENT_SECRET='' GOOGLE_OAUTH_STATE_SECRET=''
export R2_ACCESS_KEY_ID='' R2_SECRET_ACCESS_KEY='' PLATFORM_ALERT_TELEGRAM_BOT_TOKEN='' ORACLE_TELEGRAM_BOT_TOKEN=''
export AUTH_EMAIL_ENABLED=true TURNSTILE_SECRET_KEY=''
cd "$root"
npm --prefix systems/back run test:integration -- "$@"

"$pg/psql" -h "$tmp" -U proof_admin -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
create role hachozeh_migration nologin;
create role hachozeh_app nologin;
create role hachozeh_backup nologin;
SQL
"$pg/psql" -h "$tmp" -U proof_admin -d "$DB_NAME" -v existing_owner=proof_owner -f workspace/deploy/postgres-role-split.sql >/dev/null
"$pg/psql" -h "$tmp" -U proof_admin -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
set role hachozeh_migration;
create table public.security_future_grant_probe (id integer);
reset role;
set role hachozeh_app;
begin;
insert into public.security_future_grant_probe values (1);
update public.security_future_grant_probe set id = 2;
delete from public.security_future_grant_probe;
do $$
begin
  begin
    create table public.security_forbidden_probe(id integer);
    raise exception 'runtime unexpectedly created a table';
  exception when insufficient_privilege then null; end;
  begin
    truncate public.security_future_grant_probe;
    raise exception 'runtime unexpectedly truncated a table';
  exception when insufficient_privilege then null; end;
  begin
    update schema_migrations set name = name;
    raise exception 'runtime unexpectedly changed migration history';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from pg_roles where rolname = current_user and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'runtime has administrative role capabilities';
  end if;
end $$;
rollback;
reset role;
set role hachozeh_backup;
select count(*) >= 0 as backup_read_ok from public.users;
do $$
begin
  begin
    delete from public.security_future_grant_probe;
    raise exception 'backup unexpectedly wrote a table';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: runtime denies DDL/TRUNCATE/migration writes, backup read-only, future grants work' as security_role_proof;
SQL
