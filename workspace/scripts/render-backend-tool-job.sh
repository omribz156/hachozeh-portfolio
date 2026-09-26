#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
tool=""
execute_render_job="false"
poll_seconds="${RENDER_BACKEND_TOOL_POLL_SECONDS:-4}"
poll_attempts="${RENDER_BACKEND_TOOL_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_BACKEND_TOOL_LOG_LIMIT:-500}"
run_dir=""
tool_args=()

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-backend-tool-job.sh --tool <tool> [options] -- [tool args]

Tools:
  integrity-scan     Read-only market contract/source/lifecycle drift scan.
  incident-audit     Read-only post-incident audit receipt.
  notification-scan  Read-only notification integrity scan.
  queue-doctor       Read-only lifecycle queue reason-code report.
  cascade-preview    Read-only event/dependent cascade blast-radius preview.
  event-doctor       Read-only event/child dependency report.
  production-doctor  Read-only production doctor aggregate report.
  watch-doctor       Read-only market-watch coverage report.
  seer-opportunities Read-only Seer next-market opportunity suggestions.
  incident-impact    Read-only incident impact / make-whole sizing report.
  incident-trades    Preview or execute exact-suffix known-result trade reversal.

Options:
  --service <name-or-id>      Render backend service. Default: hachozeh-backend.
  --execute-render-job        Actually create the Render one-off job.
  --run-dir <path>            Receipt directory. Default: workspace/runtime/render-backend-tool/<timestamp>.
  --poll-seconds <n>          Render job poll interval. Default: 4.
  --poll-attempts <n>         Render job poll attempts. Default: 45.
  --log-limit <n>             Render log lines to capture. Default: 500.

Default mode is local dry-run of the Render command shape.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool)
      tool="${2:-}"
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
    --)
      shift
      tool_args=("$@")
      break
      ;;
    *)
      tool_args=("$@")
      break
      ;;
  esac
done

case "$tool" in
  integrity-scan)
    script_path="dist/back/src/scripts/market-integrity-scan.js"
    ;;
  incident-audit)
    script_path="dist/back/src/scripts/market-post-incident-audit.js"
    ;;
  notification-scan)
    script_path="dist/back/src/scripts/notification-integrity-scan.js"
    ;;
  queue-doctor)
    script_path="dist/back/src/scripts/lifecycle-queue-doctor.js"
    ;;
  cascade-preview)
    script_path="dist/back/src/scripts/event-cascade-preview.js"
    ;;
  event-doctor)
    script_path="dist/back/src/scripts/event-dependency-doctor.js"
    ;;
  production-doctor)
    script_path=""
    ;;
  watch-doctor)
    script_path="dist/back/src/scripts/market-watch-coverage-doctor.js"
    ;;
  seer-opportunities)
    script_path="dist/back/src/scripts/seer-opportunity-watch.js"
    ;;
  incident-impact)
    script_path="dist/back/src/scripts/market-incident-impact.js"
    ;;
  incident-trades)
    script_path="dist/back/src/scripts/market-known-result-trades.js"
    ;;
  *)
    echo "Unknown or missing --tool: $tool" >&2
    usage >&2
    exit 2
    ;;
esac

render_job_require_command node

if [[ "$tool" == "production-doctor" ]]; then
  production_doctor_script='const {parseProductionDoctorOptions,runProductionDoctor}=require("./dist/back/src/scripts/production-doctor.js"); (async()=>{const options=parseProductionDoctorOptions(["--json",...process.argv.slice(1)]); const report=await runProductionDoctor(options); const modules={}; for (const module of report.modules) { const entry={verdict:module.verdict}; if (module.name==="platform") entry.notes=Array.isArray(module.report?.notes)?module.report.notes:[]; if (module.name==="economy_integrity") entry.checks=Array.isArray(module.report?.checks)?module.report.checks.filter((check)=>Number(check.count)>0):[]; if (module.name==="event_integrity") { entry.auditedEventCount=module.report?.auditedEventCount ?? null; entry.findingEventCount=module.report?.findingEventCount ?? null; entry.warningCount=module.report?.warningCount ?? null; } if (module.name==="market_watch") { entry.scannedCount=module.report?.scannedCount ?? null; entry.issueCount=module.report?.issueCount ?? null; entry.blockerCount=module.report?.blockerCount ?? null; entry.warningCount=module.report?.warningCount ?? null; } if (module.name==="market_integrity") { entry.scannedCount=module.report?.scannedCount ?? null; entry.issueCount=module.report?.issueCount ?? null; entry.blockerCount=module.report?.blockerCount ?? null; entry.watchCount=module.report?.watchCount ?? null; } if (module.name==="lifecycle_queue") { entry.checkedCount=module.report?.checkedCount ?? null; entry.blockerCount=module.report?.blockerCount ?? null; entry.watchCount=module.report?.watchCount ?? null; } if (module.name==="notification_integrity") entry.issueCount=module.report?.issueCount ?? null; if (module.name==="avatar_integrity") { entry.databaseReferenceCount=module.report?.databaseReferenceCount ?? null; entry.storedObjectCount=module.report?.storedObjectCount ?? null; entry.danglingReferenceCount=module.report?.danglingReferenceCount ?? null; entry.invalidReferenceCount=module.report?.invalidReferenceCount ?? null; } modules[module.name]=entry; } console.log(JSON.stringify({event:report.event,generatedAt:report.generatedAt,verdict:report.verdict,modules},null,2)); if (report.verdict==="bad" || (options.failOnWatch && report.verdict==="watch")) process.exitCode=1;})().catch((error)=>{console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode=1;});'
  production_doctor_script="${production_doctor_script/process.argv.slice(1)/(process.argv.includes(\"--\") ? process.argv.slice(process.argv.indexOf(\"--\") + 1) : process.argv.slice(2))}"
  production_doctor_script_base64="$(printf "%s" "$production_doctor_script" | base64 | tr -d '\n')"
  command_args=(node -e "eval(Buffer.from(process.argv[1],Buffer.from([98,97,115,101,54,52]).toString()).toString())" "$production_doctor_script_base64" --)
elif [[ "$tool" == "queue-doctor" ]]; then
  queue_doctor_script='const {loadAppEnv}=require("./dist/back/src/config/env.js"); const {createDbPool}=require("./dist/back/src/db/client/pool.js"); const {runLifecycleQueueDoctor}=require("./dist/back/src/scripts/lifecycle-queue-doctor.js"); const args=process.argv.includes("--")?process.argv.slice(process.argv.indexOf("--")+1):process.argv.slice(2); const value=(name,fallback)=>{const exact=args.indexOf(`--${name}`); if(exact>=0)return args[exact+1]??fallback; const pref=args.find((item)=>item.startsWith(`--${name}=`)); return pref?pref.slice(name.length+3):fallback;}; (async()=>{const pool=createDbPool(loadAppEnv().db); try {const report=await runLifecycleQueueDoctor(pool,{marketId:value("market",undefined),limit:Number(value("limit","200"))}); const compact={...report,items:report.items.filter((item)=>item.severity!=="ok")}; console.log(JSON.stringify(compact,null,2)); if(report.blockerCount>0)process.exitCode=2;} finally {await pool.end();}})().catch((error)=>{console.error(error instanceof Error?error.stack||error.message:String(error));process.exitCode=1;});'
  queue_doctor_script_base64="$(printf "%s" "$queue_doctor_script" | base64 | tr -d '\n')"
  command_args=(node -e "eval(Buffer.from(process.argv[1],Buffer.from([98,97,115,101,54,52]).toString()).toString())" "$queue_doctor_script_base64" --)
else
  command_args=(node "$script_path" --json)
fi
if [[ "${#tool_args[@]}" -gt 0 ]]; then
  command_args+=("${tool_args[@]}")
fi
render_command="$(render_job_command_from_args "${command_args[@]}")"

resolved_service="$service"
if [[ "$execute_render_job" == "true" ]]; then
  render_job_require_command render
  resolved_service="$(render_job_resolve_service_id "$service")"
fi

if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-backend-tool/$(date -u +"%Y%m%dT%H%M%SZ")-$tool"
fi

echo "Render job target: $service ($resolved_service)"
echo "Render job command: $render_command"
echo "Render receipts: $run_dir"
echo "Tool: $tool"

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

json_file="$(render_json_job "$tool" "$render_command")"
echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const fields = [
  `objectType=${receipt.objectType ?? receipt.event ?? "json"}`,
  `verdict=${receipt.verdict ?? "n/a"}`,
  `issueCount=${receipt.issueCount ?? "n/a"}`,
  `blockerCount=${receipt.blockerCount ?? "n/a"}`,
  `watchCount=${receipt.watchCount ?? "n/a"}`,
  `childCount=${receipt.childCount ?? "n/a"}`,
  `scannedCount=${receipt.scannedCount ?? "n/a"}`,
  `suggestionCount=${receipt.suggestionCount ?? "n/a"}`,
  `duplicateCount=${receipt.duplicateCount ?? "n/a"}`,
  `auditedEventCount=${receipt.auditedEventCount ?? "n/a"}`,
  `findingEventCount=${receipt.findingEventCount ?? "n/a"}`,
  `warningCount=${receipt.warningCount ?? "n/a"}`,
  `tradeCount=${receipt.trades?.length ?? "n/a"}`,
  `totalCash=${receipt.totalCash ?? "n/a"}`,
  `repairBlockers=${receipt.blockers?.length ?? "n/a"}`
];
console.log(`Render result: ${fields.join(" ")}`);
NODE
