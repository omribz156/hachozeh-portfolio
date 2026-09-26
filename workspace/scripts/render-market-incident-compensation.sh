#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
market=""
correct_winning_outcome_id=""
actor_id="oracle_incident_operator"
reason="Market incident compensation"
summary=""
source_url=""
source_label=""
idempotency_key=""
note_only="false"
correct_resolution_display="false"
execute_incident="false"
execute_render_job="false"
poll_seconds="${RENDER_MARKET_INCIDENT_POLL_SECONDS:-4}"
poll_attempts="${RENDER_MARKET_INCIDENT_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_MARKET_INCIDENT_LOG_LIMIT:-500}"
run_dir=""

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-market-incident-compensation.sh --market <market-id> [options]

Options:
  --market <market-id>                 Market id to annotate/compensate.
  --correct-winning-outcome-id <id>     Outcome that should have paid, for make-whole grants.
  --note-only                          Write only the public operator correction note.
  --correct-resolution-display         Update displayed winning outcome without re-settlement.
  --reason <text>                      Internal/audit reason.
  --summary <text>                     Public correction summary shown in trust updates.
  --source-url <url>                   Public source URL for the correction.
  --source-label <label>               Public source label.
  --actor-id <id>                      Actor id. Default: oracle_incident_operator.
  --idempotency-key <key>              Stable key. Default is derived by the script.
  --execute-incident                   Actually write the incident note/grants inside the job.
  --execute-compensation               Alias for --execute-incident.
  --service <name-or-id>               Render backend service. Default: hachozeh-backend.
  --execute-render-job                 Actually create the Render one-off job.
  --run-dir <path>                     Receipt directory. Default: workspace/runtime/render-market-incident-compensation/<timestamp>.
  --poll-seconds <n>                   Render job poll interval. Default: 4.
  --poll-attempts <n>                  Render job poll attempts. Default: 45.
  --log-limit <n>                      Render log lines to capture. Default: 500.

Default mode is local dry-run of the Render command shape.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --market)
      market="${2:-}"
      shift 2
      ;;
    --correct-winning-outcome-id)
      correct_winning_outcome_id="${2:-}"
      shift 2
      ;;
    --note-only)
      note_only="true"
      shift
      ;;
    --correct-resolution-display)
      correct_resolution_display="true"
      shift
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
    --execute-incident|--execute-compensation)
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

if [[ -z "$market" ]]; then
  echo "Missing --market." >&2
  usage >&2
  exit 2
fi

if [[ "$note_only" != "true" && -z "$correct_winning_outcome_id" ]]; then
  echo "Use --correct-winning-outcome-id, or pass --note-only." >&2
  usage >&2
  exit 2
fi

if [[ -z "$summary" ]]; then
  summary="$reason"
fi

render_job_require_command node

payload_b64="$(node - \
  "$market" \
  "$correct_winning_outcome_id" \
  "$actor_id" \
  "$reason" \
  "$summary" \
  "$source_url" \
  "$source_label" \
  "$idempotency_key" \
  "$note_only" \
  "$correct_resolution_display" \
  "$execute_incident" <<'NODE'
const [
  marketId,
  correctWinningOutcomeId,
  actorId,
  reason,
  summary,
  sourceUrl,
  sourceLabel,
  idempotencyKey,
  noteOnly,
  correctResolutionDisplay,
  execute
] = process.argv.slice(2);
const payload = {
  marketId,
  correctWinningOutcomeId: correctWinningOutcomeId || undefined,
  actorId,
  reason,
  summary,
  sourceUrl: sourceUrl || undefined,
  sourceLabel: sourceLabel || undefined,
  idempotencyKey: idempotencyKey || undefined,
  noteOnly: noteOnly === "true",
  correctResolutionDisplay: correctResolutionDisplay === "true",
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

render_command="$(render_job_command_from_args node dist/back/src/scripts/market-incident-compensation.js --json --render-log-receipt "--payload-json-b64=$payload_b64")"

if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-market-incident-compensation/$(date -u +"%Y%m%dT%H%M%SZ")"
fi

echo "Render job target: $service ($resolved_service)"
echo "Render job command: node dist/back/src/scripts/market-incident-compensation.js --json --render-log-receipt --payload-json-b64 <${#payload_b64}_chars>"
echo "Render receipts: $run_dir"
echo "Incident execute: $execute_incident"
echo "Incident note only: $note_only"
echo "Correct resolution display: $correct_resolution_display"

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

json_file="$(render_json_job "market-incident-compensation" "$render_command")"
echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`Render result: ${receipt.objectType ?? "json"} dryRun=${receipt.dryRun}`);
console.log(`Market: ${receipt.market?.id ?? "missing"}`);
console.log(`Candidates: ${receipt.candidateCount ?? "unknown"} eligible=${receipt.eligibleCompensationCount ?? "unknown"} compensated=${receipt.compensatedCount ?? "unknown"} total=${receipt.totalCompensation ?? "unknown"} correctedResolutionDisplay=${receipt.correctedResolutionDisplay ?? "unknown"}`);
console.log(`Cleared stale loss notifications: ${receipt.clearedLossNotificationCount ?? 0} notification events=${receipt.clearedLossNotificationEventCount ?? 0}`);
console.log(`Correction notifications: target=${receipt.correctionNotificationTargetCount ?? 0} existing=${receipt.correctionNotificationExistingCount ?? 0} inserted=${receipt.correctionNotificationInsertedCount ?? 0}`);
NODE
