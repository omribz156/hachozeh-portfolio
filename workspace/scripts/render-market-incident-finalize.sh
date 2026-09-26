#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
market=""
oracle_case_id=""
winning_outcome_id=""
actor_id="oracle_incident_operator"
summary="Incident-aware final settlement"
source_url=""
source_label="Official source"
idempotency_key=""
execute_incident="false"
execute_render_job="false"
poll_seconds="${RENDER_MARKET_INCIDENT_POLL_SECONDS:-4}"
poll_attempts="${RENDER_MARKET_INCIDENT_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_MARKET_INCIDENT_LOG_LIMIT:-500}"
run_dir=""

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-market-incident-finalize.sh --market <id> --oracle-case-id <id> --winning-outcome-id <id> --source-url <url> [options]

Options:
  --market <id>              Exact closed incident market.
  --oracle-case-id <id>      Recommended production resolution case.
  --winning-outcome-id <id>  Expected winner; must match case and evidence.
  --summary <text>           Resolution/audit summary.
  --source-url <url>         Official evidence URL.
  --source-label <label>     User-facing source label.
  --actor-id <id>            Actor id. Default: oracle_incident_operator.
  --idempotency-key <key>    Stable execution key.
  --execute-incident         Inner mutation gate.
  --service <name-or-id>     Render backend service. Default: hachozeh-backend.
  --execute-render-job       Create the Render one-off job.
  --run-dir <path>           Receipt directory.
  --poll-seconds <n>         Render job poll interval. Default: 4.
  --poll-attempts <n>        Render job poll attempts. Default: 45.
  --log-limit <n>            Render log lines to capture. Default: 500.

Default: command-shape dry-run. Production write requires both execute flags.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --market) market="${2:-}"; shift 2 ;;
    --oracle-case-id) oracle_case_id="${2:-}"; shift 2 ;;
    --winning-outcome-id) winning_outcome_id="${2:-}"; shift 2 ;;
    --actor-id) actor_id="${2:-}"; shift 2 ;;
    --summary) summary="${2:-}"; shift 2 ;;
    --source-url) source_url="${2:-}"; shift 2 ;;
    --source-label) source_label="${2:-}"; shift 2 ;;
    --idempotency-key) idempotency_key="${2:-}"; shift 2 ;;
    --execute-incident) execute_incident="true"; shift ;;
    --service) service="${2:-}"; shift 2 ;;
    --execute-render-job) execute_render_job="true"; shift ;;
    --run-dir) run_dir="${2:-}"; shift 2 ;;
    --poll-seconds) poll_seconds="${2:-}"; shift 2 ;;
    --poll-attempts) poll_attempts="${2:-}"; shift 2 ;;
    --log-limit) log_limit="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$market" || -z "$oracle_case_id" || -z "$winning_outcome_id" || -z "$source_url" ]]; then
  echo "Missing required incident finalization argument." >&2
  usage >&2
  exit 2
fi

render_job_require_command node

payload_b64="$(node - \
  "$market" "$oracle_case_id" "$winning_outcome_id" "$actor_id" "$summary" \
  "$source_url" "$source_label" "$idempotency_key" "$execute_incident" <<'NODE'
const [marketId, oracleCaseId, winningOutcomeId, actorId, summary, sourceUrl, sourceLabel, idempotencyKey, execute] = process.argv.slice(2);
const payload = {
  marketId,
  oracleCaseId,
  winningOutcomeId,
  actorId,
  summary,
  sourceUrl,
  sourceLabel,
  idempotencyKey: idempotencyKey || undefined,
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

render_command="$(render_job_command_from_args node dist/back/src/scripts/market-incident-finalize.js --json --render-log-receipt "--payload-json-b64=$payload_b64")"
if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-market-incident-finalize/$(date -u +"%Y%m%dT%H%M%SZ")"
fi

echo "Render job target: $service ($resolved_service)"
echo "Render job command: node dist/back/src/scripts/market-incident-finalize.js --json --render-log-receipt --payload-json-b64 <${#payload_b64}_chars>"
echo "Render receipts: $run_dir"
echo "Incident execute: $execute_incident"
echo "Market/case/winner: $market / $oracle_case_id / $winning_outcome_id"

if [[ "$execute_render_job" != "true" ]]; then
  echo
  echo "Dry-run only. Add --execute-render-job to create the Render one-off job."
  exit 0
fi

export RENDER_JSON_JOB_SERVICE_ID="$resolved_service"
export RENDER_JSON_JOB_RUN_DIR="$run_dir"
export RENDER_JSON_JOB_POLL_SECONDS="$poll_seconds"
export RENDER_JSON_JOB_POLL_ATTEMPTS="$poll_attempts"
export RENDER_JSON_JOB_LOG_LIMIT="$log_limit"

json_file="$(render_json_job "market-incident-finalize" "$render_command")"
echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`Render result: ${receipt.objectType ?? "json"} dryRun=${receipt.dryRun} replayed=${receipt.replayed}`);
console.log(`Market: ${receipt.marketId} blockers=${(receipt.blockers || []).join(",") || "none"} pending=${receipt.plan?.pendingClaimReserve ?? "n/a"} topUp=${receipt.plan?.treasuryTopUp ?? "n/a"}`);
console.log(`Resolution: ${receipt.resolutionId ?? "none"} notifications=${receipt.notificationCount ?? 0}`);
NODE
