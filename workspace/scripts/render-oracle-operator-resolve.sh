#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"

service="${RENDER_BACKEND_SERVICE:-hachozeh-backend}"
service_id="${RENDER_BACKEND_SERVICE_ID:-}"
poll_seconds="${RENDER_ORACLE_POLL_SECONDS:-4}"
poll_attempts="${RENDER_ORACLE_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_ORACLE_LOG_LIMIT:-500}"
execute_render_job="false"
run_dir="$repo_root/workspace/runtime/render-oracle-operator-resolve/$(date -u +"%Y%m%dT%H%M%SZ")"

args=()
redacted_args=()

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/render-oracle-operator-resolve.sh [operator-resolve flags] [options]

Required operator-resolve flags:
  --market <market-id-or-key>
  --mode test|official|manual
  --winning-outcome-id <outcome-id>       Prefer this for prod precision.
    or --winning-outcome-key <outcome-key>
  --reason-summary <text>
  --evidence-url <url-or-local-ref>
  --evidence-label <label>

Optional operator-resolve flags:
  --claim-summary <text>
  --approve true|false
  --review-note <text>
  --idempotency-key <key>
  --actor-id <id>

Render options:
  --service <name-or-id>                  Default: hachozeh-backend.
  --execute-render-job                    Actually create the Render one-off job.
  --poll-seconds <n>                      Default: 4.
  --poll-attempts <n>                     Default: 45.
  --log-limit <n>                         Default: 500.
  -h, --help

Notes:
  - Dry-run by default. Add --execute-render-job for prod mutation.
  - Uses a base64 JSON payload inside Render, so Hebrew/free-text args remain intact.
  - Receipts are written under workspace/runtime/render-oracle-operator-resolve/.
EOF
}

add_arg() {
  local key="$1"
  local value="$2"
  args+=("$key" "$value")
  redacted_args+=("$key" "$value")
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service)
      service="${2:-}"
      shift 2
      ;;
    --service=*)
      service="${1#--service=}"
      shift
      ;;
    --execute-render-job)
      execute_render_job="true"
      shift
      ;;
    --poll-seconds)
      poll_seconds="${2:-}"
      shift 2
      ;;
    --poll-seconds=*)
      poll_seconds="${1#--poll-seconds=}"
      shift
      ;;
    --poll-attempts)
      poll_attempts="${2:-}"
      shift 2
      ;;
    --poll-attempts=*)
      poll_attempts="${1#--poll-attempts=}"
      shift
      ;;
    --log-limit)
      log_limit="${2:-}"
      shift 2
      ;;
    --log-limit=*)
      log_limit="${1#--log-limit=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --market|--mode|--winning-outcome-id|--winning-outcome-key|--reason-summary|--evidence-url|--evidence-label|--claim-summary|--approve|--review-note|--idempotency-key|--actor-id)
      add_arg "$1" "${2:-}"
      shift 2
      ;;
    --market=*|--mode=*|--winning-outcome-id=*|--winning-outcome-key=*|--reason-summary=*|--evidence-url=*|--evidence-label=*|--claim-summary=*|--approve=*|--review-note=*|--idempotency-key=*|--actor-id=*)
      add_arg "${1%%=*}" "${1#*=}"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

render_job_require_command node

payload_file="$(mktemp)"
trap 'rm -f "$payload_file"' EXIT

node - "$payload_file" "${args[@]}" <<'NODE'
const fs = require("fs");
const [file, ...argv] = process.argv.slice(2);
const pairs = new Map();

for (let index = 0; index < argv.length; index += 2) {
  const key = argv[index];
  const value = argv[index + 1];
  if (!key || value == null || value === "") {
    console.error(`Missing value for ${key || "argument"}.`);
    process.exit(2);
  }
  pairs.set(key, value);
}

const required = ["--market", "--mode", "--reason-summary", "--evidence-url", "--evidence-label"];
const missing = required.filter((key) => !pairs.has(key));
if (!pairs.has("--winning-outcome-id") && !pairs.has("--winning-outcome-key")) {
  missing.push("--winning-outcome-id or --winning-outcome-key");
}
if (missing.length > 0) {
  console.error(`Missing required operator-resolve flags: ${missing.join(", ")}`);
  process.exit(2);
}

const mode = pairs.get("--mode");
if (!["test", "official", "manual"].includes(mode)) {
  console.error("--mode must be test, official, or manual.");
  process.exit(2);
}

const approve = pairs.get("--approve");
if (approve != null && !["true", "false"].includes(approve)) {
  console.error("--approve must be true or false.");
  process.exit(2);
}

const command = ["dist/oracle/src/oracle-cli.js", "operator-resolve"];
for (let index = 0; index < argv.length; index += 2) {
  command.push(argv[index], argv[index + 1]);
}
command.push("--json");

fs.writeFileSync(file, JSON.stringify(command));
NODE

payload_b64="$(base64 < "$payload_file" | tr -d '\n')"
node_eval_b64="$(node - "$payload_b64" <<'NODE'
const payloadB64 = process.argv[2];
const code = `const {spawnSync}=require('child_process');const argv=JSON.parse(Buffer.from('${payloadB64}','base64').toString('utf8'));const child=spawnSync('node',argv,{stdio:'inherit'});process.exit(child.status??1);`;
process.stdout.write(Buffer.from(code).toString("base64"));
NODE
)"
render_command="node -e eval(Buffer.from('${node_eval_b64}','base64').toString())"

echo "Render job target: $service"
echo "Operator command:"
node - "${redacted_args[@]}" <<'NODE'
const argv = ["node", "dist/oracle/src/oracle-cli.js", "operator-resolve", ...process.argv.slice(2), "--json"];
console.log(argv.map((value) => /\s/.test(value) ? JSON.stringify(value) : value).join(" "));
NODE

if [[ "$execute_render_job" != "true" ]]; then
  echo "Dry-run only. Add --execute-render-job to create the Render one-off job."
  exit 0
fi

render_job_require_command render

resolved_service="${service_id:-$(render_job_resolve_service_id "$service")}"
mkdir -p "$run_dir"

echo "Creating compact Render one-off job..."
export RENDER_JSON_JOB_SERVICE_ID="$resolved_service"
export RENDER_JSON_JOB_RUN_DIR="$run_dir"
export RENDER_JSON_JOB_POLL_SECONDS="$poll_seconds"
export RENDER_JSON_JOB_POLL_ATTEMPTS="$poll_attempts"
export RENDER_JSON_JOB_LOG_LIMIT="$log_limit"

json_file="$(render_json_job "operator-resolve" "$render_command")"
echo "Operator resolve JSON: $json_file"
node - "$json_file" <<'NODE'
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify({
  objectType: payload.objectType,
  marketId: payload.marketId ?? payload.market?.id ?? null,
  oracleCaseId: payload.oracleCase?.oracleCaseId ?? payload.oracleCaseId ?? null,
  resolutionId: payload.resolution?.resolutionId ?? null,
  settlementStatus: payload.settlement?.status ?? payload.settlementStatus ?? null,
  outcome: payload.outcome ?? null
}, null, 2));
NODE
