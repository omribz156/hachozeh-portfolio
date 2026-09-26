#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
markets=()
replace_from=""
replace_to=""
require_source_id=""
require_status=""
require_close_date=""
execute_patch="false"
execute_render_job="false"
poll_seconds="${RENDER_MARKET_CONTRACT_PATCH_POLL_SECONDS:-4}"
poll_attempts="${RENDER_MARKET_CONTRACT_PATCH_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_MARKET_CONTRACT_PATCH_LOG_LIMIT:-500}"
run_dir=""

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-market-contract-patch.sh --market <market-id> --replace-from <text> --replace-to <text> [options]

Options:
  --market <market-id>             Exact market id. Repeatable.
  --replace-from <text>            Exact JSON text fragment to replace.
  --replace-to <text>              Exact JSON text fragment replacement.
  --require-source-id <source-id>  Block unless current contract/source policy contains this source id.
  --require-status <status>        Block unless each market has this status.
  --require-close-date <yyyy-mm-dd> Block unless close_at date matches.
  --execute-patch                  Actually update DB rows inside the job. Default is dry-run.
  --service <name-or-id>           Render backend service. Default: hachozeh-backend.
  --execute-render-job             Actually create the Render one-off job.
  --run-dir <path>                 Receipt directory. Default: workspace/runtime/render-market-contract-patch/<timestamp>.
  --poll-seconds <n>               Render job poll interval. Default: 4.
  --poll-attempts <n>              Render job poll attempts. Default: 45.
  --log-limit <n>                  Render log lines to capture. Default: 500.

Default mode is local dry-run of the Render command shape.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --market)
      markets+=("${2:-}")
      shift 2
      ;;
    --replace-from)
      replace_from="${2:-}"
      shift 2
      ;;
    --replace-to)
      replace_to="${2:-}"
      shift 2
      ;;
    --require-source-id)
      require_source_id="${2:-}"
      shift 2
      ;;
    --require-status)
      require_status="${2:-}"
      shift 2
      ;;
    --require-close-date)
      require_close_date="${2:-}"
      shift 2
      ;;
    --execute-patch)
      execute_patch="true"
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

if [[ -z "$replace_from" || -z "$replace_to" ]]; then
  echo "Missing --replace-from or --replace-to." >&2
  usage >&2
  exit 2
fi

render_job_require_command node

payload_b64="$(MARKETS_JSON="$(printf '%s\n' "${markets[@]}" | node -e 'const fs=require("node:fs"); const lines=fs.readFileSync(0,"utf8").split(/\n/).filter(Boolean); process.stdout.write(JSON.stringify(lines));')" node - \
  "$replace_from" \
  "$replace_to" \
  "$require_source_id" \
  "$require_status" \
  "$require_close_date" \
  "$execute_patch" <<'NODE'
const [
  replaceFrom,
  replaceTo,
  requireSourceId,
  requireStatus,
  requireCloseDate,
  execute
] = process.argv.slice(2);
const payload = {
  marketIds: JSON.parse(process.env.MARKETS_JSON || "[]"),
  replaceFrom,
  replaceTo,
  requireSourceId: requireSourceId || undefined,
  requireStatus: requireStatus || undefined,
  requireCloseDate: requireCloseDate || undefined,
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

render_command="$(render_job_command_from_args node dist/back/src/scripts/market-contract-patch.js --json "--payload-json-b64=$payload_b64")"

if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-market-contract-patch/$(date -u +"%Y%m%dT%H%M%SZ")"
fi

echo "Render job target: $service ($resolved_service)"
echo "Render job command: node dist/back/src/scripts/market-contract-patch.js --json --payload-json-b64 <${#payload_b64}_chars>"
echo "Render receipts: $run_dir"
echo "Patch execute: $execute_patch"
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

json_file="$(render_json_job "market-contract-patch" "$render_command")"
echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`Render result: ${receipt.objectType ?? "json"} status=${receipt.status ?? "unknown"} dryRun=${receipt.dryRun}`);
console.log(`Markets: ${receipt.requestedMarketIds?.join(", ") ?? "unknown"} patched=${receipt.patchedCount ?? 0}`);
if (receipt.errors?.length) {
  console.log(`Errors: ${receipt.errors.join("; ")}`);
}
NODE
