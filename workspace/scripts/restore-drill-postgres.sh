#!/usr/bin/env bash
# Restore the latest Postgres dump into a temporary database and write a receipt.
#
# Default mode uses the repo docker-compose Postgres service. For a VPS or
# managed Postgres rehearsal, set RESTORE_DRILL_MODE=direct and provide DB_* env.
#
# Usage:
#   workspace/scripts/restore-drill-postgres.sh
#   workspace/scripts/restore-drill-postgres.sh --backup workspace/backups/navi-YYYY-MM-DD-HHMM.dump
#   RESTORE_DRILL_MODE=direct workspace/scripts/restore-drill-postgres.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BACKUP_DIR="${NAVI_BACKUP_DIR:-${REPO_ROOT}/workspace/backups}"
RECEIPT_DIR="${RESTORE_DRILL_RECEIPT_DIR:-${REPO_ROOT}/workspace/test/reports}"
MODE="${RESTORE_DRILL_MODE:-docker}"
COMPOSE_FILE="${RESTORE_DRILL_COMPOSE_FILE:-${REPO_ROOT}/compose.yml}"
KEEP_DB="${RESTORE_DRILL_KEEP_DB:-false}"
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup)
      BACKUP_FILE="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --receipt-dir)
      RECEIPT_DIR="${2:-}"
      shift 2
      ;;
    --keep-db)
      KEEP_DB=true
      shift
      ;;
    -h|--help)
      sed -n '1,18p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

find_latest_backup() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    return 1
  fi

  local newest=""
  local newest_mtime=0
  local file=""
  local mtime=0

  while IFS= read -r -d '' file; do
    if mtime="$(stat -f %m "$file" 2>/dev/null)"; then
      :
    else
      mtime="$(stat -c %Y "$file")"
    fi

    if [[ "$mtime" -gt "$newest_mtime" ]]; then
      newest="$file"
      newest_mtime="$mtime"
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -name "navi-*.dump" -type f -print0)

  [[ -n "$newest" ]] && printf '%s\n' "$newest"
}

if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE="$(find_latest_backup || true)"
fi

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "ERROR: no backup dump found. Set --backup or NAVI_BACKUP_DIR." >&2
  exit 1
fi

if [[ "$BACKUP_FILE" != /* ]]; then
  BACKUP_FILE="${REPO_ROOT}/${BACKUP_FILE}"
fi

STAMP="$(date -u "+%Y%m%dT%H%M%SZ")"
RESTORE_DB="${RESTORE_DRILL_DB_NAME:-hachozeh_restore_drill_${STAMP}}"
RECEIPT_FILE="${RECEIPT_DIR}/postgres-restore-drill-${STAMP}.md"
SANITY_SQL="
select 'schema_migrations' as table_name, count(*)::text as row_count from schema_migrations
union all select 'users', count(*)::text from users
union all select 'accounts', count(*)::text from accounts
union all select 'markets', count(*)::text from markets
union all select 'market_outcomes', count(*)::text from market_outcomes
union all select 'trades', count(*)::text from trades
union all select 'contract_positions', count(*)::text from contract_positions
union all select 'ledger_entries', count(*)::text from ledger_entries
order by table_name;
"

cleanup() {
  if [[ "$KEEP_DB" = "true" ]]; then
    echo "[restore-drill] keeping temporary database ${RESTORE_DB}"
    return
  fi

  if [[ "${RESTORE_DRILL_CREATED:-false}" != "true" ]]; then
    return
  fi

  echo "[restore-drill] dropping temporary database ${RESTORE_DB}"
  if [[ "$MODE" = "docker" ]]; then
    docker compose -f "$COMPOSE_FILE" exec -T postgres dropdb -U "${POSTGRES_USER:-navi}" --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  elif [[ "$MODE" = "direct" ]]; then
    dropdb -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-navi}" --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mkdir -p "$RECEIPT_DIR"

echo "[restore-drill] backup: ${BACKUP_FILE}"
echo "[restore-drill] mode: ${MODE}"
echo "[restore-drill] temporary database: ${RESTORE_DB}"

if [[ "$MODE" = "docker" ]]; then
  if ! docker compose -f "$COMPOSE_FILE" ps --services --filter status=running 2>/dev/null | grep -q "^postgres$"; then
    echo "ERROR: postgres container is not running for ${COMPOSE_FILE}" >&2
    exit 1
  fi

  docker compose -f "$COMPOSE_FILE" exec -T postgres createdb -U "${POSTGRES_USER:-navi}" "$RESTORE_DB"
  RESTORE_DRILL_CREATED=true
  docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore \
    -U "${POSTGRES_USER:-navi}" \
    -d "$RESTORE_DB" \
    --no-owner \
    --no-acl \
    --exit-on-error \
    < "$BACKUP_FILE"
  SANITY_ROWS="$(docker compose -f "$COMPOSE_FILE" exec -T postgres psql \
    -v ON_ERROR_STOP=1 \
    -U "${POSTGRES_USER:-navi}" \
    -d "$RESTORE_DB" \
    -At \
    -F '|' \
    -c "$SANITY_SQL")"
elif [[ "$MODE" = "direct" ]]; then
  for command in createdb pg_restore psql dropdb; do
    if ! command -v "$command" >/dev/null 2>&1; then
      echo "ERROR: RESTORE_DRILL_MODE=direct requires ${command} on PATH." >&2
      exit 1
    fi
  done

  export PGPASSWORD="${DB_PASSWORD:-}"
  createdb -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-navi}" "$RESTORE_DB"
  RESTORE_DRILL_CREATED=true
  pg_restore \
    -h "${DB_HOST:-127.0.0.1}" \
    -p "${DB_PORT:-5432}" \
    -U "${DB_USER:-navi}" \
    -d "$RESTORE_DB" \
    --no-owner \
    --no-acl \
    --exit-on-error \
    "$BACKUP_FILE"
  SANITY_ROWS="$(psql \
    -h "${DB_HOST:-127.0.0.1}" \
    -p "${DB_PORT:-5432}" \
    -U "${DB_USER:-navi}" \
    -d "$RESTORE_DB" \
    -v ON_ERROR_STOP=1 \
    -At \
    -F '|' \
    -c "$SANITY_SQL")"
else
  echo "ERROR: RESTORE_DRILL_MODE must be docker or direct." >&2
  exit 2
fi

{
  echo "# Postgres Restore Drill Receipt"
  echo
  echo "Date: $(date -u "+%Y-%m-%dT%H:%M:%SZ")"
  echo "Status: PASS"
  echo "Mode: ${MODE}"
  echo "Backup: $(basename "$BACKUP_FILE")"
  echo "Temporary database: ${RESTORE_DB}"
  echo "Release id: ${NAVI_RELEASE_ID:-local-drill}"
  echo
  echo "## Sanity Counts"
  echo
  echo "| Table | Rows |"
  echo "|---|---:|"
  while IFS='|' read -r table_name row_count; do
    [[ -z "${table_name:-}" ]] && continue
    echo "| ${table_name} | ${row_count} |"
  done <<< "$SANITY_ROWS"
  echo
  echo "Result: restore_drill=pass"
} > "$RECEIPT_FILE"

echo "[restore-drill] wrote receipt: ${RECEIPT_FILE}"
echo "[restore-drill] PASS"
