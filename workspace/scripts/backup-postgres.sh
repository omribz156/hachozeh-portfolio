#!/usr/bin/env bash
# Dump the navi Postgres database to workspace/backups/ using pg_dump -Fc.
#
# What it does:
#   - Resolves the repo root from its own location so it works from cron/launchd.
#   - Runs pg_dump -Fc via `docker compose exec -T postgres` from repo root by default.
#   - Or runs direct pg_dump with BACKUP_PG_DUMP_MODE=direct for VPS/managed Postgres.
#   - Writes to workspace/backups/navi-YYYY-MM-DD-HHMM.dump
#   - Prunes dump files older than 7 days (navi-*.dump pattern only).
#   - Fails loudly if the postgres container is not running.
#   - Optionally encrypts + uploads the dump to a remote provider (see below).
#
# Usage:
#   workspace/scripts/backup-postgres.sh
#
# To restore a dump:
#   pg_restore -h 127.0.0.1 -p 55432 -U navi -d navi --no-owner -Fc <file>
#   (or see the restore drill in workspace/reports/2026-06-10-backup-restore-drill.md)
#
# ---------------------------------------------------------------------------
# OFF-HOST BACKUP SEAM — env keys (none required; remote is opt-in)
# ---------------------------------------------------------------------------
#
#   BACKUP_REMOTE_ENABLED         Set to "true" to activate off-host upload.
#                                 Default: unset → skip silently with a log line.
#
#   BACKUP_AGE_RECIPIENT          age public key for the backup owner, e.g.:
#                                   age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
#                                 Required when BACKUP_REMOTE_ENABLED=true.
#                                 Encrypt: age -r "$BACKUP_AGE_RECIPIENT" -o <dump>.age <dump>
#                                 Decrypt: age -d -i ~/.age/key.txt <dump>.age > <dump>
#
#   BACKUP_REMOTE_UPLOAD_CMD      Provider-agnostic upload command template.
#                                 Placeholders: {file} = local .age path, {name} = filename.
#                                 Example (Cloudflare R2 via rclone):
#                                   rclone copyto {file} r2:hachozeh-backups/{name}
#                                 Required when BACKUP_REMOTE_ENABLED=true.
#                                 Configure rclone R2: https://rclone.org/s3/#cloudflare-r2
#
#   BACKUP_REMOTE_RETENTION_DAYS  How many days of remote dumps to keep (default: 30).
#                                 Used only if BACKUP_REMOTE_PRUNE_CMD is also set.
#
#   BACKUP_REMOTE_PRUNE_CMD       Optional command template to prune old remote dumps.
#                                 Placeholder: {cutoff_date} = ISO date string (YYYY-MM-DD)
#                                 of the oldest dump to KEEP (i.e. prune anything older).
#                                 Example (rclone + filter):
#                                   rclone delete r2:hachozeh-backups --min-age {cutoff_date}
#                                 If unset, remote retention is skipped with a log line.
#
# PROVIDER CHOICE: deferred to deploy stage.
#   Recommendation: Cloudflare R2 (~3¢/mo for this volume).
#   Encryption is MANDATORY — dumps contain user emails.
#   See workspace/deploy/alerting.md for the full provider decision note.
#
# DIRECT MODE ROLE SPLIT:
#   BACKUP_DB_HOST/PORT/NAME/USER/PASSWORD override DB_* when set.
#   Production should use a backup/read-only role here, not the app runtime role.
#
# NEVER echo the values of these keys. Log key NAMES only.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${NAVI_BACKUP_DIR:-${REPO_ROOT}/workspace/backups}"
STAMP="$(date "+%Y-%m-%d-%H%M")"
DUMP_FILE="${BACKUP_DIR}/navi-${STAMP}.dump"
ALERT_SCRIPT="${SCRIPT_DIR}/platform-alert.sh"

mkdir -p "$BACKUP_DIR"

echo "[backup-postgres] dumping to ${DUMP_FILE}"

BACKUP_PG_DUMP_MODE="${BACKUP_PG_DUMP_MODE:-docker}"

if [[ "$BACKUP_PG_DUMP_MODE" = "direct" ]]; then
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "ERROR: BACKUP_PG_DUMP_MODE=direct but pg_dump is not on PATH." >&2
    if [[ -x "$ALERT_SCRIPT" ]]; then
      "$ALERT_SCRIPT" send "[backup] FAILED: pg_dump binary missing on $(hostname -s)"
    fi
    exit 1
  fi

  PGHOST="${BACKUP_DB_HOST:-${DB_HOST:-127.0.0.1}}"
  PGPORT="${BACKUP_DB_PORT:-${DB_PORT:-5432}}"
  PGDATABASE="${BACKUP_DB_NAME:-${DB_NAME:-navi}}"
  PGUSER="${BACKUP_DB_USER:-${DB_USER:-navi}}"
  PGPASSWORD="${BACKUP_DB_PASSWORD:-${DB_PASSWORD:-}}"
  export PGPASSWORD

  if ! pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc > "$DUMP_FILE"; then
    echo "ERROR: pg_dump failed" >&2
    rm -f "$DUMP_FILE"
    if [[ -x "$ALERT_SCRIPT" ]]; then
      "$ALERT_SCRIPT" send "[backup] FAILED: pg_dump error on $(hostname -s)"
    fi
    exit 1
  fi
elif [[ "$BACKUP_PG_DUMP_MODE" = "docker" ]]; then
  # --- preflight: postgres container must be running ---
  if ! docker compose -f "${REPO_ROOT}/compose.yml" ps --services --filter status=running 2>/dev/null \
       | grep -q "^postgres$"; then
    echo "ERROR: postgres container is not running. Start it with:" >&2
    echo "  docker compose -f ${REPO_ROOT}/compose.yml up -d postgres" >&2
    if [[ -x "$ALERT_SCRIPT" ]]; then
      "$ALERT_SCRIPT" send "[backup] FAILED: postgres container not running on $(hostname -s)"
    fi
    exit 1
  fi

  if ! docker compose -f "${REPO_ROOT}/compose.yml" exec -T postgres \
         pg_dump -U navi -d navi -Fc \
         > "$DUMP_FILE"; then
    echo "ERROR: pg_dump failed" >&2
    rm -f "$DUMP_FILE"
    if [[ -x "$ALERT_SCRIPT" ]]; then
      "$ALERT_SCRIPT" send "[backup] FAILED: pg_dump error on $(hostname -s)"
    fi
    exit 1
  fi
else
  echo "ERROR: BACKUP_PG_DUMP_MODE must be docker or direct." >&2
  rm -f "$DUMP_FILE"
  exit 1
fi

SIZE="$(du -sh "$DUMP_FILE" | cut -f1)"
echo "[backup-postgres] dump complete — ${SIZE} written to ${DUMP_FILE}"

# --- prune dumps older than 7 days ---
echo "[backup-postgres] pruning local dumps older than 7 days..."
find "$BACKUP_DIR" -maxdepth 1 -name "navi-*.dump" -mtime +7 -print -delete

# ---------------------------------------------------------------------------
# OFF-HOST BACKUP SEAM
# ---------------------------------------------------------------------------

BACKUP_REMOTE_ENABLED="${BACKUP_REMOTE_ENABLED:-}"

if [[ "$BACKUP_REMOTE_ENABLED" != "true" ]]; then
  echo "[backup-postgres] remote: disabled (BACKUP_REMOTE_ENABLED not set)"
  echo "[backup-postgres] done."
  exit 0
fi

echo "[backup-postgres] remote: enabled — starting off-host upload"

# --- require age binary ---
if ! command -v age > /dev/null 2>&1; then
  echo "ERROR: remote backup enabled but 'age' binary not found." >&2
  echo "  Install: brew install age   or   https://age-encryption.org/" >&2
  if [[ -x "$ALERT_SCRIPT" ]]; then
    "$ALERT_SCRIPT" send "[backup] FAILED: age binary missing — remote upload aborted on $(hostname -s)"
  fi
  exit 1
fi

# --- require recipient key ---
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
if [[ -z "$BACKUP_AGE_RECIPIENT" ]]; then
  echo "ERROR: BACKUP_REMOTE_ENABLED=true but BACKUP_AGE_RECIPIENT is unset." >&2
  echo "  Set it to the age public key of the backup owner." >&2
  if [[ -x "$ALERT_SCRIPT" ]]; then
    "$ALERT_SCRIPT" send "[backup] FAILED: BACKUP_AGE_RECIPIENT unset — remote upload aborted on $(hostname -s)"
  fi
  exit 1
fi

# --- encrypt ---
AGE_FILE="${DUMP_FILE}.age"
echo "[backup-postgres] encrypting dump with age..."
if ! age -r "$BACKUP_AGE_RECIPIENT" -o "$AGE_FILE" "$DUMP_FILE"; then
  echo "ERROR: age encryption failed" >&2
  rm -f "$AGE_FILE"
  if [[ -x "$ALERT_SCRIPT" ]]; then
    "$ALERT_SCRIPT" send "[backup] FAILED: age encryption error on $(hostname -s)"
  fi
  exit 1
fi
echo "[backup-postgres] encrypted: ${AGE_FILE}"

# --- require upload command ---
BACKUP_REMOTE_UPLOAD_CMD="${BACKUP_REMOTE_UPLOAD_CMD:-}"
if [[ -z "$BACKUP_REMOTE_UPLOAD_CMD" ]]; then
  echo "ERROR: BACKUP_REMOTE_ENABLED=true but BACKUP_REMOTE_UPLOAD_CMD is unset." >&2
  echo "  Example: rclone copyto {file} r2:hachozeh-backups/{name}" >&2
  rm -f "$AGE_FILE"
  if [[ -x "$ALERT_SCRIPT" ]]; then
    "$ALERT_SCRIPT" send "[backup] FAILED: BACKUP_REMOTE_UPLOAD_CMD unset — upload aborted on $(hostname -s)"
  fi
  exit 1
fi

# --- upload ---
AGE_NAME="$(basename "$AGE_FILE")"
UPLOAD_CMD="${BACKUP_REMOTE_UPLOAD_CMD//\{file\}/$AGE_FILE}"
UPLOAD_CMD="${UPLOAD_CMD//\{name\}/$AGE_NAME}"
echo "[backup-postgres] uploading ${AGE_NAME} via BACKUP_REMOTE_UPLOAD_CMD..."
if ! eval "$UPLOAD_CMD"; then
  echo "ERROR: remote upload failed" >&2
  rm -f "$AGE_FILE"
  if [[ -x "$ALERT_SCRIPT" ]]; then
    "$ALERT_SCRIPT" send "[backup] FAILED: remote upload error (${AGE_NAME}) on $(hostname -s)"
  fi
  exit 1
fi
echo "[backup-postgres] upload complete: ${AGE_NAME}"

# --- delete local .age after successful upload ---
rm -f "$AGE_FILE"
echo "[backup-postgres] local .age deleted after successful upload"

# --- remote retention (optional) ---
BACKUP_REMOTE_RETENTION_DAYS="${BACKUP_REMOTE_RETENTION_DAYS:-30}"
BACKUP_REMOTE_PRUNE_CMD="${BACKUP_REMOTE_PRUNE_CMD:-}"

if [[ -z "$BACKUP_REMOTE_PRUNE_CMD" ]]; then
  echo "[backup-postgres] remote retention: BACKUP_REMOTE_PRUNE_CMD not set — skipping prune"
else
  CUTOFF_DATE="$(date -v -"${BACKUP_REMOTE_RETENTION_DAYS}"d "+%Y-%m-%d" 2>/dev/null \
    || date -d "-${BACKUP_REMOTE_RETENTION_DAYS} days" "+%Y-%m-%d")"
  PRUNE_CMD="${BACKUP_REMOTE_PRUNE_CMD//\{cutoff_date\}/$CUTOFF_DATE}"
  echo "[backup-postgres] pruning remote dumps older than ${BACKUP_REMOTE_RETENTION_DAYS} days (cutoff: ${CUTOFF_DATE})..."
  if ! eval "$PRUNE_CMD"; then
    echo "WARNING: remote prune command failed (non-fatal)" >&2
  else
    echo "[backup-postgres] remote prune done"
  fi
fi

echo "[backup-postgres] done."
