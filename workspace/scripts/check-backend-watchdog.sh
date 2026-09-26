#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend_base_url="${BACKEND_BASE_URL:-http://127.0.0.1:3001}"
tmux_session="${BACKEND_TMUX_SESSION:-codex-navi-back}"
start_command="${BACKEND_START_COMMAND:-npm --prefix systems/back run dev}"
wait_seconds="${BACKEND_WATCHDOG_WAIT_SECONDS:-30}"
mode="${1:-check}"

log() {
  printf '[backend-watchdog] %s\n' "$*"
}

usage() {
  cat <<EOF
Usage: $0 [check|ensure|restart|status]

Modes:
  check    Report health/tmux/process state and exit non-zero if /health/ready is not 200.
  status   Report health/tmux/process state and always exit 0.
  ensure   Restart the tmux lane only if /health/ready is not 200.
  restart  Restart the tmux lane unconditionally.

Environment:
  BACKEND_BASE_URL=${backend_base_url}
  BACKEND_TMUX_SESSION=${tmux_session}
  BACKEND_START_COMMAND=${start_command}
EOF
}

health_code() {
  curl -sS -o /tmp/navi-backend-watchdog-ready.json -w '%{http_code}' \
    "${backend_base_url}/health/ready" 2>/dev/null || printf '000'
}

health_summary() {
  local code="$1"

  if [[ "$code" == "200" ]]; then
    node -e '
      const fs = require("fs");
      const payload = JSON.parse(fs.readFileSync("/tmp/navi-backend-watchdog-ready.json", "utf8"));
      const postgres = payload?.dependencies?.postgres?.ok === true ? "postgres=ok" : "postgres=bad";
      console.log(`ready=${payload.status ?? "unknown"} ${postgres}`);
    ' 2>/dev/null || true
    return
  fi

  printf 'ready=unreachable\n'
}

tmux_exists() {
  command -v tmux >/dev/null 2>&1 && tmux has-session -t "${tmux_session}" 2>/dev/null
}

print_state() {
  local code="$1"

  log "backend=${backend_base_url}"
  log "health_code=${code} $(health_summary "$code")"

  if tmux_exists; then
    log "tmux=${tmux_session} present"
    local pane_command
    pane_command="$(tmux display-message -p -t "${tmux_session}" '#{pane_current_command}' 2>/dev/null || true)"
    [[ -n "$pane_command" ]] && log "tmux_pane_command=${pane_command}"
  else
    log "tmux=${tmux_session} missing"
  fi

  local node_processes
  node_processes="$(pgrep -fl 'node .*src/server\.ts|node --watch|tsx src/server\.ts' 2>/dev/null || true)"
  if [[ -n "$node_processes" ]]; then
    log "node_processes:"
    printf '%s\n' "$node_processes"
  else
    log "node_processes=none-matched"
  fi
}

wait_for_ready() {
  local deadline=$((SECONDS + wait_seconds))
  local code

  while (( SECONDS <= deadline )); do
    code="$(health_code)"
    if [[ "$code" == "200" ]]; then
      print_state "$code"
      return 0
    fi
    sleep 1
  done

  code="$(health_code)"
  print_state "$code"
  return 1
}

restart_backend() {
  log "restart requested for tmux=${tmux_session}"

  if ! command -v tmux >/dev/null 2>&1; then
    log "tmux is unavailable"
    return 1
  fi

  if tmux_exists; then
    log "respawning pane with tmux respawn-pane -k"
    tmux respawn-pane -k -t "${tmux_session}" "cd \"${repo_root}\" && ${start_command}"
  else
    log "starting: ${start_command}"
    tmux new-session -d -s "${tmux_session}" -c "${repo_root}" "${start_command}"
  fi

  wait_for_ready
}

case "$mode" in
  check)
    code="$(health_code)"
    print_state "$code"
    [[ "$code" == "200" ]]
    ;;
  status)
    code="$(health_code)"
    print_state "$code"
    ;;
  ensure)
    code="$(health_code)"
    print_state "$code"
    if [[ "$code" != "200" ]]; then
      restart_backend
    fi
    ;;
  restart)
    restart_backend
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
