#!/usr/bin/env bash
# Check that the Oracle lifecycle worker's heartbeat is fresh.
#
# The worker has its own supervise loop and writes worker-status.json each
# tick (default interval 5 min / 300s), but nothing PROBES it — a dead worker
# just stops sweeping lifecycle silently (alert coverage gap 1, 2026-06-11).
#
# What it does:
#   - Reads workspace/runtime/oracle-lifecycle-worker/worker-status.json.
#   - Exits 0 if latestHeartbeatCompletedAt is younger than the threshold.
#   - Exits 1 (and fires a platform alert) if the file is missing, unparseable,
#     or the heartbeat is stale.
#
# Threshold default 20 min (4 missed 5-min cycles). Override: ORACLE_HEARTBEAT_MAX_AGE_S.
#
# Exit codes:
#   0  — heartbeat fresh
#   1  — missing / unparseable / stale; alert fired if configured

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STATUS_FILE="${REPO_ROOT}/workspace/runtime/oracle-lifecycle-worker/worker-status.json"
ALERT_SCRIPT="${SCRIPT_DIR}/platform-alert.sh"
HOST="$(hostname -s)"

MAX_AGE_SECONDS="${ORACLE_HEARTBEAT_MAX_AGE_S:-$((20 * 60))}"

alert() {
  echo "$1" >&2
  [[ -x "$ALERT_SCRIPT" ]] && "$ALERT_SCRIPT" send "$2" || true
}

if [[ ! -f "$STATUS_FILE" ]]; then
  alert "[oracle-heartbeat] MISSING status file: ${STATUS_FILE}" \
        "[oracle] worker status file missing on ${HOST} — worker may never have started"
  exit 1
fi

# Parse latestHeartbeatCompletedAt (ISO8601) → epoch via python3 (robust).
HEARTBEAT_EPOCH="$(python3 - "$STATUS_FILE" <<'PY' 2>/dev/null || true
import json, sys, datetime
try:
    d = json.load(open(sys.argv[1]))
    ts = d.get("latestHeartbeatCompletedAt")
    if not ts:
        sys.exit(0)
    # tolerate trailing Z
    dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    print(int(dt.timestamp()))
except Exception:
    sys.exit(0)
PY
)"

if [[ -z "$HEARTBEAT_EPOCH" ]]; then
  alert "[oracle-heartbeat] UNPARSEABLE latestHeartbeatCompletedAt in ${STATUS_FILE}" \
        "[oracle] worker heartbeat timestamp unreadable on ${HOST}"
  exit 1
fi

NOW_EPOCH="$(date +%s)"
AGE_SECONDS=$(( NOW_EPOCH - HEARTBEAT_EPOCH ))
AGE_MINS=$(( AGE_SECONDS / 60 ))

if [[ "$AGE_SECONDS" -lt "$MAX_AGE_SECONDS" ]]; then
  echo "[oracle-heartbeat] OK: last heartbeat ${AGE_MINS}m ago (< $((MAX_AGE_SECONDS / 60))m)"
  exit 0
else
  alert "[oracle-heartbeat] STALE: last heartbeat ${AGE_MINS}m ago (>= $((MAX_AGE_SECONDS / 60))m)" \
        "[oracle] worker heartbeat STALE — ${AGE_MINS}m since last sweep on ${HOST}; lifecycle may be stalled"
  exit 1
fi
