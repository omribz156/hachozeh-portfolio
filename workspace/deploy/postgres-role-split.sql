-- Hachozeh Postgres role split template.
--
-- Purpose:
-- - move production away from one all-powerful app/runtime DB user
-- - keep migrations/schema ownership separate from app reads/writes
-- - give backups read-only access without app or schema-owner privileges
--
-- Run only on a rehearsal/target database after a fresh backup and restore drill.
-- The database is the current connection (works for local and managed names).
-- Roles are:
-- - hachozeh_migration: schema owner / migration role
-- - hachozeh_app: runtime app role
-- - hachozeh_backup: pg_dump role
--
-- Create the LOGIN roles and passwords out-of-band first, for example:
--   create role hachozeh_migration login password '<secret>';
--   create role hachozeh_app login password '<secret>';
--   create role hachozeh_backup login password '<secret>';
--
-- If an existing owner owns current objects, run psql with:
--   psql "$DATABASE_URL" -v existing_owner=<old-owner> -f workspace/deploy/postgres-role-split.sql

\set ON_ERROR_STOP on

begin;
select current_database() as target_database \gset

alter role hachozeh_app nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role hachozeh_backup nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

revoke all on database :"target_database" from public;

grant connect on database :"target_database" to hachozeh_migration;
grant connect on database :"target_database" to hachozeh_app;
grant connect on database :"target_database" to hachozeh_backup;

-- Optional handoff from the old single-user owner to the migration owner.
-- Pass -v existing_owner=<old-owner> to activate this block.
\if :{?existing_owner}
  reassign owned by :"existing_owner" to hachozeh_migration;
\else
  \echo 'existing_owner not set; skipping REASSIGN OWNED'
\endif

alter schema public owner to hachozeh_migration;
revoke create on schema public from public;
revoke create on schema public from hachozeh_app;
revoke create on schema public from hachozeh_backup;

grant usage on schema public to hachozeh_app;
grant usage on schema public to hachozeh_backup;

grant select, insert, update, delete on all tables in schema public to hachozeh_app;
grant usage, select, update on all sequences in schema public to hachozeh_app;
grant execute on all functions in schema public to hachozeh_app;

-- Runtime reads may inspect migration state but cannot rewrite migration history.
revoke insert, update, delete on schema_migrations from hachozeh_app;

grant select on all tables in schema public to hachozeh_backup;
grant select on all sequences in schema public to hachozeh_backup;

alter default privileges for role hachozeh_migration in schema public
  grant select, insert, update, delete on tables to hachozeh_app;
alter default privileges for role hachozeh_migration in schema public
  grant usage, select, update on sequences to hachozeh_app;
alter default privileges for role hachozeh_migration in schema public
  grant execute on functions to hachozeh_app;

alter default privileges for role hachozeh_migration in schema public
  grant select on tables to hachozeh_backup;
alter default privileges for role hachozeh_migration in schema public
  grant select on sequences to hachozeh_backup;

commit;
