#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
market=""
outcome_id=""
from_label=""
to_label=""
execute_render_job="false"
poll_seconds="${RENDER_OUTCOME_LABEL_POLL_SECONDS:-4}"
poll_attempts="${RENDER_OUTCOME_LABEL_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_OUTCOME_LABEL_LOG_LIMIT:-500}"
run_dir=""

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-market-outcome-label-job.sh --market <market-id> (--outcome-id <id>|--from-label <label>) --to-label <label> [options]

Options:
  --market <market-id>           Market id to patch.
  --outcome-id <outcome-id>      Exact outcome id.
  --from-label <label>           Expected current label or short label.
  --to-label <label>             Replacement label and short label.
  --service <name-or-id>         Render backend service. Default: hachozeh-backend.
  --execute-render-job           Actually create the Render one-off job.
  --run-dir <path>               Receipt directory. Default: workspace/runtime/render-market-outcome-label/<timestamp>.
  --poll-seconds <n>             Render job poll interval. Default: 4.
  --poll-attempts <n>            Render job poll attempts. Default: 45.
  --log-limit <n>                Render log lines to capture. Default: 500.

Default mode is dry-run: prints the Render command shape only.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --market)
      market="${2:-}"
      shift 2
      ;;
    --outcome-id)
      outcome_id="${2:-}"
      shift 2
      ;;
    --from-label)
      from_label="${2:-}"
      shift 2
      ;;
    --to-label)
      to_label="${2:-}"
      shift 2
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

if [[ -z "$market" || -z "$to_label" ]]; then
  echo "Missing --market or --to-label." >&2
  usage >&2
  exit 2
fi

if [[ -z "$outcome_id" && -z "$from_label" ]]; then
  echo "Use --outcome-id or --from-label." >&2
  usage >&2
  exit 2
fi

render_job_require_command node

payload_b64="$(node - "$market" "$outcome_id" "$from_label" "$to_label" <<'NODE'
const payload = {
  market: process.argv[2],
  outcomeId: process.argv[3] || undefined,
  fromLabel: process.argv[4] || undefined,
  toLabel: process.argv[5]
};
process.stdout.write(Buffer.from(JSON.stringify(payload), "utf8").toString("base64"));
NODE
)"

resolved_service="$service"
if [[ "$execute_render_job" == "true" ]]; then
  render_job_require_command render
  resolved_service="$(render_job_resolve_service_id "$service")"
fi
render_command="$(render_job_command_from_args node dist/back/src/scripts/patch-market-outcome-label.js --json --payload-json-b64 "$payload_b64")"

if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-market-outcome-label/$(date -u +"%Y%m%dT%H%M%SZ")"
fi

echo "Render job target: $service ($resolved_service)"
echo "Render job command: node dist/back/src/scripts/patch-market-outcome-label.js --json --payload-json-b64 <${#payload_b64}_chars>"
echo "Render receipts: $run_dir"

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

json_file="$(render_json_job "market-outcome-label" "$render_command")"
echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`Render result: ${receipt.objectType ?? "json"} status=${receipt.status ?? "unknown"}`);
if (receipt.marketId && receipt.outcomeId) {
  console.log(`Patched: ${receipt.marketId} ${receipt.outcomeId}`);
}
NODE
