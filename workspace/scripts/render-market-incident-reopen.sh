#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
markets=()
actor_id="oracle_incident_operator"
reason="Premature market resolution reopen"
summary=""
source_url=""
source_label=""
idempotency_key=""
reopen_until=""
execute_incident="false"
execute_render_job="false"
poll_seconds="${RENDER_MARKET_INCIDENT_POLL_SECONDS:-4}"
poll_attempts="${RENDER_MARKET_INCIDENT_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_MARKET_INCIDENT_LOG_LIMIT:-500}"
run_dir=""

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-market-incident-reopen.sh --market <market-id> [--market <market-id> ...] [options]

Options:
  --market <market-id>       Market id to reopen after premature resolution.
  --reopen-until <iso>       Optional replacement close_at. Existing close_at is used by default.
  --reason <text>            Internal/audit reason.
  --summary <text>           Public correction summary shown in trust updates.
  --source-url <url>         Public source URL for the correction.
  --source-label <label>     Public source label.
  --actor-id <id>            Actor id. Default: oracle_incident_operator.
  --idempotency-key <key>    Stable key. Default is derived by the script.
  --execute-incident         Actually reopen markets inside the job.
  --service <name-or-id>     Render backend service. Default: hachozeh-backend.
  --execute-render-job       Actually create the Render one-off job.
  --run-dir <path>           Receipt directory. Default: workspace/runtime/render-market-incident-reopen/<timestamp>.
  --poll-seconds <n>         Render job poll interval. Default: 4.
  --poll-attempts <n>        Render job poll attempts. Default: 45.
  --log-limit <n>            Render log lines to capture. Default: 500.

Default mode is local dry-run of the Render command shape.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --market)
      markets+=("${2:-}")
      shift 2
      ;;
    --reopen-until)
      reopen_until="${2:-}"
      shift 2
      ;;
    --reason)
      reason="${2:-}"
      shift 2
      ;;
    --summary)
      summary="${2:-}"
      shift 2
      ;;
    --source-url)
      source_url="${2:-}"
      shift 2
      ;;
    --source-label)
      source_label="${2:-}"
      shift 2
      ;;
    --actor-id)
      actor_id="${2:-}"
      shift 2
      ;;
    --idempotency-key)
      idempotency_key="${2:-}"
      shift 2
      ;;
    --execute-incident)
      execute_incident="true"
      shift
      ;;
    --service)
      service="${2:-}"
      shift 2
      ;;
    --execute-render-job)
      execute_render_job="true"
      shift
      ;;
    --run-dir)
      run_dir="${2:-}"
      shift 2
      ;;
    --poll-seconds)
      poll_seconds="${2:-}"
      shift 2
      ;;
    --poll-attempts)
      poll_attempts="${2:-}"
      shift 2
      ;;
    --log-limit)
      log_limit="${2:-}"
      shift 2
      ;;
    --help|-h)
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

if [[ "${#markets[@]}" -eq 0 ]]; then
  echo "Missing --market." >&2
  usage >&2
  exit 2
fi

if [[ -z "$summary" ]]; then
  summary="$reason"
fi

render_job_require_command node

payload_b64="$(MARKETS_JSON="$(printf '%s\n' "${markets[@]}" | node -e 'const fs=require("node:fs"); const lines=fs.readFileSync(0,"utf8").split(/\n/).filter(Boolean); process.stdout.write(JSON.stringify(lines));')" node - \
  "$actor_id" \
  "$reason" \
  "$summary" \
  "$source_url" \
  "$source_label" \
  "$idempotency_key" \
  "$reopen_until" \
  "$execute_incident" <<'NODE'
const [
  actorId,
  reason,
  summary,
  sourceUrl,
  sourceLabel,
  idempotencyKey,
  reopenUntil,
  execute
] = process.argv.slice(2);
const payload = {
  marketIds: JSON.parse(process.env.MARKETS_JSON || "[]"),
  actorId,
  reason,
  summary,
  sourceUrl: sourceUrl || undefined,
  sourceLabel: sourceLabel || undefined,
  idempotencyKey: idempotencyKey || undefined,
  reopenUntil: reopenUntil || undefined,
  execute: execute === "true"
};
process.stdout.write(Buffer.from(JSON.stringify(payload), "utf8").toString("base64"));
NODE
)"

resolved_service="$service"
if [[ "$execute_render_job" == "true" ]]; then
  render_job_require_command render
  resolved_service="$(render_job_resolve_service_id "$service")"
fi

render_command="$(render_job_command_from_args node dist/back/src/scripts/market-incident-reopen.js --json --render-log-receipt "--payload-json-b64=$payload_b64")"

if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-market-incident-reopen/$(date -u +"%Y%m%dT%H%M%SZ")"
fi

echo "Render job target: $service ($resolved_service)"
echo "Render job command: node dist/back/src/scripts/market-incident-reopen.js --json --render-log-receipt --payload-json-b64 <${#payload_b64}_chars>"
echo "Render receipts: $run_dir"
echo "Incident execute: $execute_incident"
echo "Markets: ${markets[*]}"

if [[ "$execute_render_job" != "true" ]]; then
  echo
  echo "Dry-run only. Add --execute-render-job to create the Render one-off job."
  exit 0
fi

echo
echo "Creating compact Render one-off job..."
export RENDER_JSON_JOB_SERVICE_ID="$resolved_service"
export RENDER_JSON_JOB_RUN_DIR="$run_dir"
export RENDER_JSON_JOB_POLL_SECONDS="$poll_seconds"
export RENDER_JSON_JOB_POLL_ATTEMPTS="$poll_attempts"
export RENDER_JSON_JOB_LOG_LIMIT="$log_limit"

json_file="$(render_json_job "market-incident-reopen" "$render_command")"
echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`Render result: ${receipt.objectType ?? "json"} dryRun=${receipt.dryRun}`);
for (const item of receipt.markets || []) {
  console.log(`Market: ${item.market?.id ?? "missing"} restored=${item.restoredPositionCount} deletedLosses=${item.deletedLossRealizationCount} keptWins=${item.keptWinRealizationCount} skipped=${item.skipped}`);
}
NODE
