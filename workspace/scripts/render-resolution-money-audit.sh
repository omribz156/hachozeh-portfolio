#!/usr/bin/env bash
set -euo pipefail

SERVICE_ID="${RENDER_BACKEND_SERVICE_ID:-srv-configure-your-service}"
MARKET_ID=""
POLL_SECONDS="${RENDER_AUDIT_POLL_SECONDS:-5}"
POLL_ATTEMPTS="${RENDER_AUDIT_POLL_ATTEMPTS:-24}"

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/render-resolution-money-audit.sh --market-id <market-id>

Env:
  RENDER_BACKEND_SERVICE_ID   Render backend service id. Defaults to prod backend.
  RENDER_AUDIT_POLL_SECONDS  Poll interval. Defaults to 5.
  RENDER_AUDIT_POLL_ATTEMPTS Poll attempts. Defaults to 24.

Notes:
  The backend script runs read-only. It intentionally uses --render-log-receipt,
  which prints the receipt to stderr and exits non-zero so Render exposes the
  one-off job output in CLI logs.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --market-id)
      MARKET_ID="${2:-}"
      shift 2
      ;;
    --market-id=*)
      MARKET_ID="${1#--market-id=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$MARKET_ID" ]]; then
  echo "--market-id is required." >&2
  usage >&2
  exit 2
fi

if ! command -v render >/dev/null 2>&1; then
  echo "render CLI is required." >&2
  exit 127
fi

start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
start_command="node dist/back/src/scripts/resolution-money-audit.js --market-id=${MARKET_ID} --json --render-log-receipt"

job_json="$(render jobs create "$SERVICE_ID" --start-command "$start_command" --output json --confirm)"
job_id="$(printf '%s' "$job_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).id));')"

echo "resolution-money-audit: job=${job_id} service=${SERVICE_ID} market=${MARKET_ID}"

status="pending"
for _ in $(seq 1 "$POLL_ATTEMPTS"); do
  status="$(render jobs list "$SERVICE_ID" --output json | node -e "
let s='';
process.stdin.on('data', d => s += d);
process.stdin.on('end', () => {
  const job = JSON.parse(s).find((item) => item.id === '$job_id');
  process.stdout.write(job ? job.status : 'missing');
});
")"

  echo "resolution-money-audit: job=${job_id} status=${status}"
  case "$status" in
    succeeded|failed|canceled)
      break
      ;;
  esac
  sleep "$POLL_SECONDS"
done

if [[ "$status" != "failed" && "$status" != "succeeded" ]]; then
  echo "resolution-money-audit: job did not finish in time; pulling logs anyway" >&2
fi

logs="$(render logs \
  --resources "$job_id" \
  --start "$start_time" \
  --text PROD_RESOLUTION_MONEY_AUDIT \
  --limit 50 \
  --output text)"

printf '%s\n' "$logs"

if [[ "$status" == "failed" ]]; then
  echo "resolution-money-audit: Render job failed by design after emitting receipt."
fi

if [[ "$logs" != *"PROD_RESOLUTION_MONEY_AUDIT"* ]]; then
  echo "resolution-money-audit: receipt marker missing" >&2
  exit 1
fi

if [[ "$logs" == *'"verdict":"review"'* ]]; then
  echo "resolution-money-audit: verdict=review" >&2
  exit 1
fi
