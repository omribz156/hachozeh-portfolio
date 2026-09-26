#!/usr/bin/env bash
# rebuild-web-safe.sh — build Astro into a temp dir, swap dist, restart web,
# then prove the route surface. If build/status fails, restore previous dist.

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"
WEB_DIR="${REPO_ROOT}/systems/web"
RUNTIME_DIR="${REPO_ROOT}/workspace/runtime/web-safe-rebuild"
LABEL="${WEB_LAUNCHD_LABEL:-com.hachozeh.web}"
USER_ID="$(id -u)"

TMP_DIST=""
ROLLBACK_DIST=""
SWAPPED=0

log() { printf '[rebuild-web-safe] %s\n' "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

cleanup() {
  [ -n "$TMP_DIST" ] && [ -d "$TMP_DIST" ] && rm -rf "$TMP_DIST"
  if [ "$SWAPPED" -eq 0 ] && [ -n "$ROLLBACK_DIST" ] && [ -d "$ROLLBACK_DIST" ]; then
    rm -rf "$ROLLBACK_DIST"
  fi
}
trap cleanup EXIT

launchd_loaded() {
  launchctl print "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1
}

stop_web() {
  if launchd_loaded; then
    log "bootout ${LABEL}"
    launchctl bootout "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1 || true
  else
    log "${LABEL} not loaded; continuing"
  fi
}

start_web() {
  local plist="${HOME}/Library/LaunchAgents/${LABEL}.plist"
  if [ -f "$plist" ]; then
    if launchd_loaded; then
      log "kickstart ${LABEL}"
      launchctl kickstart -k "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1 || true
    else
      log "bootstrap ${LABEL}"
      launchctl bootstrap "gui/${USER_ID}" "$plist" >/dev/null 2>&1 || true
    fi
  else
    log "launchd plist missing; starting web wrapper directly"
    "${REPO_ROOT}/workspace/deploy/agents/navi-web.sh" start &
  fi
}

restore_previous_dist() {
  if [ "$SWAPPED" -eq 1 ] && [ -n "$ROLLBACK_DIST" ] && [ -d "$ROLLBACK_DIST" ]; then
    log "restoring previous dist"
    stop_web
    rm -rf "${WEB_DIR}/dist"
    mv "$ROLLBACK_DIST" "${WEB_DIR}/dist"
    SWAPPED=0
    start_web
  fi
}

mkdir -p "$RUNTIME_DIR"
TMP_DIST="$(mktemp -d "${RUNTIME_DIR}/dist-next.XXXXXX")"
ROLLBACK_DIST="${RUNTIME_DIR}/dist-prev.$(date +%Y%m%d%H%M%S)"

log "building into ${TMP_DIST}"
NAVI_ASTRO_OUT_DIR="$TMP_DIST" npm --prefix "$WEB_DIR" run build

log "swapping dist"
stop_web
if [ -d "${WEB_DIR}/dist" ]; then
  mv "${WEB_DIR}/dist" "$ROLLBACK_DIST"
else
  mkdir -p "$ROLLBACK_DIST"
fi
mv "$TMP_DIST" "${WEB_DIR}/dist"
TMP_DIST=""
SWAPPED=1

start_web
sleep "${WEB_SAFE_REBUILD_SETTLE_SECONDS:-3}"

if ! npm --prefix "$WEB_DIR" run status; then
  restore_previous_dist
  die "web status failed after rebuild; previous dist restored"
fi

rm -rf "$ROLLBACK_DIST"
SWAPPED=0
log "ok"
