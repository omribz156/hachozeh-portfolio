#!/usr/bin/env bash

render_job_die() {
  echo "render-json-job: $*" >&2
  exit 1
}

render_job_require_command() {
  command -v "$1" >/dev/null 2>&1 || render_job_die "$1 is required."
}

render_job_shell_quote() {
  printf "'"
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

render_job_resolve_service_id() {
  local service="$1"
  if [[ "$service" == srv-* ]]; then
    printf "%s" "$service"
    return 0
  fi

  render_job_require_command render
  render_job_require_command node

  local services_json
  services_json="$(render services -o json)"
  RENDER_SERVICES_JSON="$services_json" node - "$service" <<'NODE'
const serviceName = process.argv[2];
const entries = JSON.parse(process.env.RENDER_SERVICES_JSON || "[]");
const match = entries.find((entry) => entry.service?.name === serviceName);

if (!match?.service?.id) {
  console.error(`Render service not found: ${serviceName}`);
  process.exit(2);
}

process.stdout.write(match.service.id);
NODE
}

render_job_command_from_args() {
  local command_string=""
  local arg
  for arg in "$@"; do
    if [[ -z "$arg" ]]; then
      render_job_die "Render start-command arguments cannot be empty."
    fi
    if [[ -n "$command_string" ]]; then
      command_string+=" "
    fi
    if [[ "$arg" =~ [[:space:]] || "$arg" == *"'"* ]]; then
      command_string+="$(render_job_shell_quote "$arg")"
    else
      command_string+="$arg"
    fi
  done
  printf "%s" "$command_string"
}

render_job_extract_json_from_log() {
  local log_file="$1"
  node - "$log_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
const cleaned = raw
  .split(/\r?\n/)
  .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+/, ""))
  .join("\n");

const objects = [];
let start = -1;
let depth = 0;
let inString = false;
let escape = false;

for (let index = 0; index < cleaned.length; index += 1) {
  const ch = cleaned[index];

  if (start === -1) {
    if (ch === "{") {
      start = index;
      depth = 1;
      inString = false;
      escape = false;
    }
    continue;
  }

  if (escape) {
    escape = false;
    continue;
  }

  if (ch === "\\") {
    escape = true;
    continue;
  }

  if (ch === '"') {
    inString = !inString;
    continue;
  }

  if (inString) continue;

  if (ch === "{") {
    depth += 1;
  } else if (ch === "}") {
    depth -= 1;
    if (depth === 0) {
      const candidate = cleaned.slice(start, index + 1);
      try {
        objects.push(JSON.parse(candidate));
      } catch {
        // Render logs may contain non-JSON lines. Keep scanning.
      }
      start = -1;
    }
  }
}

const object =
  objects.findLast((item) => item?.event === "production_doctor_report") ??
  objects.findLast((item) => item && typeof item.objectType === "string") ??
  objects.at(-1);
if (!object) {
  console.error(`No JSON object found in ${file}`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(object, null, 2)}\n`);
NODE
}

render_json_job() {
  local label="$1"
  local command_string="$2"
  local service_id="${RENDER_JSON_JOB_SERVICE_ID:?RENDER_JSON_JOB_SERVICE_ID is required}"
  local run_dir="${RENDER_JSON_JOB_RUN_DIR:?RENDER_JSON_JOB_RUN_DIR is required}"
  local poll_seconds="${RENDER_JSON_JOB_POLL_SECONDS:-4}"
  local poll_attempts="${RENDER_JSON_JOB_POLL_ATTEMPTS:-45}"
  local log_limit="${RENDER_JSON_JOB_LOG_LIMIT:-500}"
  local start_time job_json job_id job_status job_file log_file json_file

  mkdir -p "$run_dir"

  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  job_json="$(render jobs create "$service_id" --start-command "$command_string" --output json --confirm)"
  job_id="$(printf "%s" "$job_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).id));')"

  job_file="$run_dir/${label}.job.json"
  log_file="$run_dir/${label}.log"
  json_file="$run_dir/${label}.json"
  printf "%s\n" "$job_json" > "$job_file"

  echo "${label}: job=${job_id}" >&2

  job_status="pending"
  for _ in $(seq 1 "$poll_attempts"); do
    job_status="$(render jobs list "$service_id" --output json | node -e "
let s = '';
process.stdin.on('data', (d) => s += d);
process.stdin.on('end', () => {
  const jobs = JSON.parse(s);
  const job = jobs.find((item) => item.id === '$job_id');
  process.stdout.write(job ? job.status : 'missing');
});
")"
    echo "${label}: status=${job_status}" >&2
    case "$job_status" in
      succeeded|failed|canceled)
        break
        ;;
    esac
    sleep "$poll_seconds"
  done

  render logs \
    --resources "$job_id" \
    --start "$start_time" \
    --limit "$log_limit" \
    --output text > "$log_file"

  if [[ "$job_status" != "succeeded" ]]; then
    echo "${label}: logs:" >&2
    sed -n '1,220p' "$log_file" >&2
    render_job_die "${label} Render job ended with status=${job_status}."
  fi

  render_job_extract_json_from_log "$log_file" > "$json_file"
  printf "%s" "$json_file"
}
