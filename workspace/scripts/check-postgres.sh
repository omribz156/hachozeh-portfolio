#!/usr/bin/env bash
# Check that Postgres is reachable, and optionally nudge a local runtime.
#
# The backend's ensure_postgres() only runs at START. If OrbStack/postgres
# dies WHILE everything is already running, the backend errors on queries but
# doesn't crash — so launchd KeepAlive never restarts it and nothing brings
# the DB back (recovery gap surfaced by the partial-failure review, 2026-06-11).
#
# What it does:
#   - Exits 0 if DB_HOST:DB_PORT is reachable.
#   - If closed: optionally runs POSTGRES_NUDGE_COMMAND or nudges OrbStack on macOS, waits briefly, re-checks.
#     Still closed → fires a platform alert and exits 1. Recovered → exits 0
#     after alerting that it self-healed.
#
# Intended caller: platform-checks.sh (every 5 min).
#
# Exit codes:
#   0  — postgres reachable (possibly after a nudge)
#   1  — still unreachable after the nudge; alert fired if configured

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ALERT_SCRIPT="${SCRIPT_DIR}/platform-alert.sh"
HOST="$(hostname -s)"
PGHOST="${DB_HOST:-127.0.0.1}"
PGPORT="${DB_PORT:-55432}"
NUDGE_WAIT_S="${POSTGRES_NUDGE_WAIT_S:-45}"
POSTGRES_NUDGE_COMMAND="${POSTGRES_NUDGE_COMMAND:-}"

alert() { echo "$1" >&2; [[ -x "$ALERT_SCRIPT" ]] && "$ALERT_SCRIPT" send "$2" || true; }

can_connect() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 3 bash -c "</dev/tcp/${PGHOST}/${PGPORT}" >/dev/null 2>&1 && return 0
  fi

  nc -z -w 3 "$PGHOST" "$PGPORT" >/dev/null 2>&1 && return 0
  nc -z -G 3 "$PGHOST" "$PGPORT" >/dev/null 2>&1 && return 0
  return 1
}

if can_connect; then
  echo "[check-postgres] OK: ${PGHOST}:${PGPORT} reachable"
  exit 0
fi

echo "[check-postgres] ${PGHOST}:${PGPORT} unreachable" >&2
if [[ -n "$POSTGRES_NUDGE_COMMAND" ]]; then
  echo "[check-postgres] running POSTGRES_NUDGE_COMMAND" >&2
  eval "$POSTGRES_NUDGE_COMMAND" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  echo "[check-postgres] nudging OrbStack" >&2
  open -ga OrbStack >/dev/null 2>&1 || true
else
  echo "[check-postgres] no nudge command configured; waiting for recovery" >&2
fi

waited=0
while ! can_connect; do
  if [ "$waited" -ge "$NUDGE_WAIT_S" ]; then
    alert "[check-postgres] STILL DOWN after ${NUDGE_WAIT_S}s nudge" \
          "[postgres] ${PGHOST}:${PGPORT} DOWN on ${HOST} — backend is DB-blind, manual recovery needed"
    exit 1
  fi
  sleep 3; waited=$((waited + 3))
done

alert "[check-postgres] recovered after ${waited}s" \
      "[postgres] ${PGHOST}:${PGPORT} was down on ${HOST} — recovered after ${waited}s"
exit 0
