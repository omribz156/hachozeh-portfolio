#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

backend_url="${BACKEND_BASE_URL:-http://127.0.0.1:3001}"
astro_url="${ASTRO_BASE_URL:-http://127.0.0.1:4321}"
gateway_url="${GATEWAY_BASE_URL:-http://127.0.0.1:6969}"
edge_url="${EDGE_PROBE_URL:-https://dev.hachozeh.com/trending}"
private_ops_env_file="${PRIVATE_OPS_ENV_FILE:-${NAVI_PRIVATE_OPS_ENV_FILE:-}}"

backend_session="${BACKEND_TMUX_SESSION:-codex-navi-back}"
astro_session="${ASTRO_TMUX_SESSION:-codex-web}"
caddy_session="${CADDY_TMUX_SESSION:-codex-caddy}"
watchdog_session="${WATCHDOG_TMUX_SESSION:-codex-platform-watchdog}"

backend_command="${BACKEND_START_COMMAND:-npm --prefix systems/back run dev}"
astro_command="${ASTRO_START_COMMAND:-npm --prefix systems/web run dev}"
caddy_command="${CADDY_START_COMMAND:-caddy run --config workspace/dev/Caddyfile.mac-proof}"
watchdog_command="${WATCHDOG_START_COMMAND:-npm --prefix systems/back run watchdog:platform:loop}"

wait_seconds="${BOOT_PLATFORM_WAIT_SECONDS:-75}"
docker_wait_seconds="${BOOT_PLATFORM_DOCKER_WAIT_SECONDS:-45}"
postgres_port="${POSTGRES_HOST_PORT:-55432}"
force_restart=0
run_seed="${BOOT_PLATFORM_SEED:-0}"
start_watchdog="${BOOT_PLATFORM_WATCHDOG_LOOP:-1}"
start_oracle="${BOOT_PLATFORM_ORACLE_WORKER:-1}"
probe_edge="${BOOT_PLATFORM_EDGE_PROBE:-1}"

# ---------- launchd mode switch ----------
# Default mode (no flag): launchd-aware.
#   If com.hachozeh.* agents are installed, check/kickstart them instead of
#   creating tmux lanes. Postgres + migrations still run unconditionally.
# --dev flag: preserves the original tmux+watch behaviour for active development.
# Detection: a launchd agent is "installed" when its plist exists in LaunchAgents.
dev_mode=0

user_id="$(id -u)"
launchd_plist_dir="${HOME}/Library/LaunchAgents"
launchd_labels=(
  com.hachozeh.backend
  com.hachozeh.web
  com.hachozeh.caddy
  com.hachozeh.watchdog
  com.hachozeh.oracle-worker
)

# Returns 0 (true) if ALL five platform plists are present
launchd_agents_installed() {
  for label in "${launchd_labels[@]}"; do
    [ -f "${launchd_plist_dir}/${label}.plist" ] || return 1
  done
  return 0
}

# Returns 0 (true) if the given launchd label is currently running (pid > 0)
launchd_lane_running() {
  local label="$1"
  launchctl print "gui/${user_id}/${label}" 2>/dev/null \
    | grep -qE '^\s+pid\s*=\s*[1-9]'
}

log() {
  printf '[boot-platform] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: $0 [--dev] [--restart] [--seed] [--no-watchdog] [--no-oracle] [--no-edge]

Boot/check the local Hachozeh platform:
  - Docker/Postgres
  - backend lane
  - Astro lane
  - Caddy gateway lane
  - platform status checks
  - watchdog loop lane
  - Oracle lifecycle heartbeat worker
  - doctor verdict

Mode:
  (default)   launchd-aware: if com.hachozeh.* agents are installed,
              check/kickstart them; skip tmux lane creation.
  --dev       Force tmux+watch mode (original behaviour, for active development).

Defaults are data-safe: migrations run, seed does not.
EOF
}

while (($#)); do
  case "$1" in
    --dev)
      dev_mode=1
      ;;
    --restart)
      force_restart=1
      ;;
    --seed)
      run_seed=1
      ;;
    --no-watchdog)
      start_watchdog=0
      ;;
    --no-oracle)
      start_oracle=0
      ;;
    --no-edge)
      probe_edge=0
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

# ---------- launchd lane helpers (no-op when dev_mode=1) ----------

# kickstart a launchd lane if it is not already running
ensure_launchd_lane() {
  local label="$1"
  local name="$2"

  if launchd_lane_running "$label"; then
    log "launchd/${name}=running (${label})"
  else
    log "launchd/${name}=kickstart (${label})"
    launchctl kickstart "gui/${user_id}/${label}" 2>/dev/null || {
      log "launchd/${name}: kickstart failed — agent may need: launchctl bootstrap gui/${user_id} ~/Library/LaunchAgents/${label}.plist" >&2
    }
  fi
}

# ---------- tmux helpers (preserved; only called in dev_mode) ----------

tmux_exists() {
  tmux has-session -t "$1" >/dev/null 2>&1
}

start_tmux() {
  local session="$1"
  local command="$2"

  log "start tmux=${session}: ${command}"
  tmux new-session -d -s "$session" -c "$repo_root" "$command"
}

respawn_tmux() {
  local session="$1"
  local command="$2"

  if tmux_exists "$session"; then
    log "respawn tmux=${session}: ${command}"
    tmux respawn-pane -k -t "$session" "cd \"$repo_root\" && ${command}"
  else
    start_tmux "$session" "$command"
  fi
}

ensure_tmux() {
  local session="$1"
  local command="$2"

  if ((force_restart)); then
    respawn_tmux "$session" "$command"
    return
  fi

  if tmux_exists "$session"; then
    log "tmux=${session} present"
  else
    start_tmux "$session" "$command"
  fi
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 10 "$url" 2>/dev/null || printf '000'
}

wait_http() {
  local name="$1"
  local url="$2"
  local expected_regex="$3"
  local deadline=$((SECONDS + wait_seconds))
  local code

  while ((SECONDS <= deadline)); do
    code="$(http_code "$url")"
    if [[ "$code" =~ $expected_regex ]]; then
      log "${name}=ok code=${code} url=${url}"
      return 0
    fi
    sleep 1
  done

  code="$(http_code "$url")"
  log "${name}=bad code=${code} url=${url}"
  return 1
}

wait_postgres_ready() {
  local deadline=$((SECONDS + wait_seconds))

  while ((SECONDS <= deadline)); do
    if docker compose exec -T postgres pg_isready -U navi -d navi >/dev/null 2>&1; then
      log "postgres=ok pg_isready port=${postgres_port}"
      return 0
    fi
    sleep 1
  done

  log "postgres=bad pg_isready port=${postgres_port}"
  return 1
}

ensure_docker() {
  need_command docker

  if docker info >/dev/null 2>&1; then
    log "docker=ok"
    return
  fi

  if [[ "$(uname -s)" == "Darwin" ]] && open -Ra OrbStack >/dev/null 2>&1; then
    log "docker=starting OrbStack"
    open -a OrbStack >/dev/null 2>&1 || true
  else
    die "docker is not ready"
  fi

  local deadline=$((SECONDS + docker_wait_seconds))
  while ((SECONDS <= deadline)); do
    if docker info >/dev/null 2>&1; then
      log "docker=ok"
      return
    fi
    sleep 2
  done

  die "docker did not become ready"
}

ensure_postgres() {
  log "postgres compose up"
  docker compose up -d postgres >/dev/null

  if wait_postgres_ready; then
    return
  fi

  log "postgres did not become ready; trying direct container start"
  docker start navi-postgres >/dev/null 2>&1 || true
  wait_postgres_ready || die "postgres is not ready on 127.0.0.1:${postgres_port}"
}

run_migrations() {
  log "db:migrate"
  npm --prefix systems/back run db:migrate

  if [[ "$run_seed" == "1" ]]; then
    log "db:seed"
    npm --prefix systems/back run db:seed
  else
    log "db:seed skipped (use --seed only for reset/rehearsal data)"
  fi
}

ensure_core_lanes() {
  if (( dev_mode )); then
    # --- original tmux+watch behaviour (--dev flag) ---
    need_command tmux

    ensure_tmux "$backend_session" "$backend_command"
    if ! wait_http "backend-ready" "${backend_url}/health/ready" '^(200)$'; then
      respawn_tmux "$backend_session" "$backend_command"
      wait_http "backend-ready" "${backend_url}/health/ready" '^(200)$' || die "backend failed health"
    fi

    ensure_tmux "$astro_session" "$astro_command"
    if ! wait_http "astro-trending" "${astro_url}/trending" '^(200)$'; then
      respawn_tmux "$astro_session" "$astro_command"
      wait_http "astro-trending" "${astro_url}/trending" '^(200)$' || die "Astro failed health"
    fi

    ensure_tmux "$caddy_session" "$caddy_command"
    if ! wait_http "caddy-trending" "${gateway_url}/trending" '^(200)$'; then
      respawn_tmux "$caddy_session" "$caddy_command"
      wait_http "caddy-trending" "${gateway_url}/trending" '^(200)$' || die "Caddy gateway failed health"
    fi

  elif launchd_agents_installed; then
    # --- launchd-aware mode (default, agents installed) ---
    log "launchd agents detected — checking/kickstarting lanes"

    ensure_launchd_lane "com.hachozeh.backend" "backend"
    if ! wait_http "backend-ready" "${backend_url}/health/ready" '^(200)$'; then
      die "backend (launchd) failed health — check workspace/runtime/backend.err.log"
    fi

    ensure_launchd_lane "com.hachozeh.web" "web"
    if ! wait_http "astro-trending" "${astro_url}/trending" '^(200)$'; then
      die "Astro (launchd) failed health — check workspace/runtime/web.err.log (initial build can take ~60 s)"
    fi

    ensure_launchd_lane "com.hachozeh.caddy" "caddy"
    if ! wait_http "caddy-trending" "${gateway_url}/trending" '^(200)$'; then
      die "Caddy gateway (launchd) failed health — check workspace/runtime/caddy.err.log"
    fi

  else
    # --- fallback: agents not yet installed, use tmux ---
    log "launchd agents not installed — falling back to tmux lanes (run install-platform-launchd.sh install to migrate)"
    need_command tmux

    ensure_tmux "$backend_session" "$backend_command"
    if ! wait_http "backend-ready" "${backend_url}/health/ready" '^(200)$'; then
      respawn_tmux "$backend_session" "$backend_command"
      wait_http "backend-ready" "${backend_url}/health/ready" '^(200)$' || die "backend failed health"
    fi

    ensure_tmux "$astro_session" "$astro_command"
    if ! wait_http "astro-trending" "${astro_url}/trending" '^(200)$'; then
      respawn_tmux "$astro_session" "$astro_command"
      wait_http "astro-trending" "${astro_url}/trending" '^(200)$' || die "Astro failed health"
    fi

    ensure_tmux "$caddy_session" "$caddy_command"
    if ! wait_http "caddy-trending" "${gateway_url}/trending" '^(200)$'; then
      respawn_tmux "$caddy_session" "$caddy_command"
      wait_http "caddy-trending" "${gateway_url}/trending" '^(200)$' || die "Caddy gateway failed health"
    fi
  fi
}

run_web_status() {
  log "web status"
  if npm --prefix systems/web run status; then
    return
  fi

  log "web status failed; restarting Astro singleton once"
  respawn_tmux "$astro_session" "$astro_command"
  wait_http "astro-trending" "${astro_url}/trending" '^(200)$' || die "Astro failed after restart"
  npm --prefix systems/web run status
}

ensure_watchdog() {
  if [[ "$start_watchdog" != "1" ]]; then
    log "watchdog loop skipped"
    return
  fi

  if (( dev_mode )) || ! launchd_agents_installed; then
    # tmux path
    ensure_tmux "$watchdog_session" "$watchdog_command"
  else
    # launchd path
    ensure_launchd_lane "com.hachozeh.watchdog" "watchdog"
  fi

  log "watchdog one-shot verdict"
  npm --prefix systems/back run watchdog:platform
}

ensure_oracle_worker() {
  if [[ "$start_oracle" != "1" ]]; then
    log "oracle lifecycle worker skipped"
    return
  fi

  if (( dev_mode )) || ! launchd_agents_installed; then
    # tmux path: oracle-lifecycle-worker.sh start spawns its own tmux session
    log "oracle lifecycle worker start"
    npm --silent --prefix systems/back run oracle:lifecycle-worker:start
  else
    # launchd path: kickstart the agent; the wrapper calls `supervise` directly
    ensure_launchd_lane "com.hachozeh.oracle-worker" "oracle-worker"
  fi

  log "oracle lifecycle worker status"
  npm --silent --prefix systems/back run oracle:lifecycle-worker:status -- --json
}

run_doctor() {
  log "doctor verdict"
  if [ ! -f "$private_ops_env_file" ]; then
    log "doctor auth=none private-env=missing"
    npm --prefix systems/back run doctor:platform
    return
  fi

  (
    set -a
    # shellcheck disable=SC1090
    . "$private_ops_env_file"
    set +a

    if [ -n "${DOCTOR_DIAGNOSTICS_COOKIE:-}" ]; then
      log "doctor auth=diagnostics-cookie private-env=loaded"
    elif [ -n "${DOCTOR_DIAGNOSTICS_BEARER:-}" ]; then
      log "doctor auth=diagnostics-bearer private-env=loaded"
    else
      log "doctor auth=none private-env=loaded"
    fi

    npm --prefix systems/back run doctor:platform
  )
}

probe_public_edge() {
  if [[ "$probe_edge" != "1" ]]; then
    log "edge probe skipped"
    return
  fi

  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 15 "$edge_url" 2>/dev/null || printf '000')"
  if [[ "$code" =~ ^(200|302)$ ]]; then
    log "edge=ok code=${code} url=${edge_url}"
  else
    log "edge=watch code=${code} url=${edge_url}"
  fi
}

print_summary() {
  log "summary"
  printf '  backend:  %s\n' "$backend_url"
  printf '  astro:    %s\n' "$astro_url"
  printf '  gateway:  %s\n' "$gateway_url"
  printf '  edge:     %s\n' "$edge_url"
  if (( dev_mode )); then
    printf '  mode:     tmux (--dev)\n'
    printf '  tmux:     %s %s %s %s\n' "$backend_session" "$astro_session" "$caddy_session" "$watchdog_session"
  elif launchd_agents_installed; then
    printf '  mode:     launchd (com.hachozeh.*)\n'
  else
    printf '  mode:     tmux (launchd agents not installed — fallback)\n'
    printf '  tmux:     %s %s %s %s\n' "$backend_session" "$astro_session" "$caddy_session" "$watchdog_session"
  fi
}

cd "$repo_root"

ensure_docker
ensure_postgres
run_migrations
ensure_core_lanes
run_web_status
ensure_watchdog
ensure_oracle_worker
run_doctor
probe_public_edge
print_summary

log "done"
