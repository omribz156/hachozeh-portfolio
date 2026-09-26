#!/usr/bin/env bash
set -euo pipefail

backend_base_url="${BACKEND_BASE_URL:-http://127.0.0.1:3001}"
market_key="${MARKET_KEY:-next-prime-minister}"

log() {
  printf '[runtime-baseline] %s\n' "$*"
}

fetch_json() {
  local path="$1"
  curl -fsS "${backend_base_url}${path}"
}

log "backend=${backend_base_url}"
log "market_key=${market_key}"

live_payload="$(fetch_json "/health/live")"
ready_payload="$(fetch_json "/health/ready")"
session_payload="$(fetch_json "/api/session")"
market_payload="$(fetch_json "/api/market-detail/markets/${market_key}")"

printf '\n== live ==\n%s\n' "$live_payload"
printf '\n== ready ==\n%s\n' "$ready_payload"
printf '\n== session ==\n%s\n' "$session_payload"
printf '\n== market ==\n%s\n' "$market_payload"

python3 - "$live_payload" "$ready_payload" "$session_payload" "$market_payload" <<'PY'
import json
import sys

live = json.loads(sys.argv[1])
ready = json.loads(sys.argv[2])
session = json.loads(sys.argv[3])
market = json.loads(sys.argv[4])

assert live.get("status") == "ok", f"live status was {live.get('status')!r}"
assert ready.get("status") == "ready", f"ready status was {ready.get('status')!r}"
assert ready.get("dependencies", {}).get("postgres", {}).get("ok") is True, "postgres not ready"
session_state = session.get("session", {})
assert isinstance(session_state.get("authenticated"), bool), "session auth shape missing"
snapshot = market.get("snapshot", {})
assert isinstance(snapshot.get("outcomes"), list) and snapshot.get("outcomes"), "market outcomes missing"

summary = {
    "service": live.get("service"),
    "environment": live.get("environment"),
    "ready": ready.get("status"),
    "sessionAuthenticated": session_state.get("authenticated"),
    "marketKey": market.get("marketKey"),
    "outcomes": len(snapshot.get("outcomes", [])),
}

print("\n== summary ==")
print(json.dumps(summary, ensure_ascii=False, indent=2))
PY
