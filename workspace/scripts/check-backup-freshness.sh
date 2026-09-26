#!/usr/bin/env bash
# Check that the most recent local Postgres dump is less than 26 hours old.
#
# What it does:
#   - Finds the newest workspace/backups/navi-*.dump file.
#   - Exits 0 if its mtime is < 26 hours ago.
#   - Exits 1 (and fires a platform alert) if no dump exists or the dump is stale.
#
# Intended caller: launchd watchdog or a manual health check.
# NOTE: launchd wiring of this script is NOT in scope for slice 3 — see
#       workspace/deploy/alerting.md for the planned slice 6 wiring.
#
# Usage:
#   workspace/scripts/check-backup-freshness.sh
#
# Exit codes:
#   0  — newest dump is fresh (< 26 h)
#   1  — no dump found, or dump is stale (>= 26 h); alert fired if configured

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_DIR="${NAVI_BACKUP_DIR:-${REPO_ROOT}/workspace/backups}"
ALERT_SCRIPT="${SCRIPT_DIR}/platform-alert.sh"

MAX_AGE_SECONDS=$((26 * 3600))

# --- find newest dump ---
NEWEST=""
if [[ -d "$BACKUP_DIR" ]]; then
  NEWEST="$(find "$BACKUP_DIR" -maxdepth 1 -name "navi-*.dump" -print \
    | sort | tail -1)"
fi

if [[ -z "$NEWEST" ]]; then
  MSG="[backup-freshness] STALE: no dump found in ${BACKUP_DIR}"
  echo "$MSG" >&2
  if [[ -x "$ALERT_SCRIPT" ]]; then
    "$ALERT_SCRIPT" send "[backup] STALE: no local dump found on $(hostname -s)"
  fi
  exit 1
fi

# --- compute age ---
NOW_EPOCH="$(date +%s)"
# macOS stat: -f %m; GNU stat: -c %Y — detect which is available
if stat -f %m "$NEWEST" > /dev/null 2>&1; then
  FILE_EPOCH="$(stat -f %m "$NEWEST")"
else
  FILE_EPOCH="$(stat -c %Y "$NEWEST")"
fi

AGE_SECONDS=$(( NOW_EPOCH - FILE_EPOCH ))
AGE_HOURS=$(( AGE_SECONDS / 3600 ))
AGE_MINS=$(( (AGE_SECONDS % 3600) / 60 ))

DUMP_NAME="$(basename "$NEWEST")"

if [[ "$AGE_SECONDS" -lt "$MAX_AGE_SECONDS" ]]; then
  echo "[backup-freshness] OK: ${DUMP_NAME} is ${AGE_HOURS}h ${AGE_MINS}m old (< 26h)"
  exit 0
else
  MSG="[backup-freshness] STALE: ${DUMP_NAME} is ${AGE_HOURS}h ${AGE_MINS}m old (>= 26h)"
  echo "$MSG" >&2
  if [[ -x "$ALERT_SCRIPT" ]]; then
    "$ALERT_SCRIPT" send "[backup] STALE: last dump ${DUMP_NAME} is ${AGE_HOURS}h old on $(hostname -s)"
  fi
  exit 1
fi
