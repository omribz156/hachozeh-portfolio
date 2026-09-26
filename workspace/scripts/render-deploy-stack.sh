#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_BACKEND="srv-configure-your-service"
SERVICE_WEB="srv-configure-your-service"
SERVICE_GATEWAY="srv-configure-your-service"
SERVICE_HORIZON="crn-configure-your-service"
SERVICE_ORACLE="crn-configure-your-service"
SERVICE_MARKET_WATCH="crn-configure-your-service"
SERVICE_PROD_DOCTOR="crn-configure-your-service"

run_dir="$repo_root/workspace/runtime/render-deploy/$(date -u +"%Y%m%dT%H%M%SZ")"
deploy_sha="$(git -C "$repo_root" rev-parse --short HEAD)"
deploy_backend="false"
deploy_web="false"
deploy_gateway="false"
deploy_horizon="false"
deploy_oracle="false"
deploy_market_watch="false"
deploy_prod_doctor="false"
run_doctor="false"
run_smoke="false"
dry_run="false"
overall_success="true"
skip_migration_check="false"
avatar_storage_gate_bypass_reason=""
migrate_apply="false"
migration_guard_bypass_reason=""
migration_pending_count=""

declare -a summary_lines=()

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-deploy-stack.sh [options]

Options:
  --backend            Deploy backend.
  --web                Deploy web.
  --gateway            Deploy gateway.
  --horizon            Deploy horizon cron.
  --oracle             Deploy oracle cron.
  --market-watch       Deploy market watch cron.
  --prod-doctor        Deploy production doctor cron.
  --all-active         Deploy backend, web, gateway, horizon, oracle, market-watch, prod-doctor.
  --sha <commit>       Commit SHA to deploy (defaults to current HEAD short SHA).
  --skip-migration-check
                       Do not run the backend migration plan gate.
  --avatar-storage-gate-bypass-reason <reason>
                       Bootstrap/incident-only: skip the avatar audit and record why.
  --migrate-apply      Apply pending migrations after the backend deploy and before other targets.
  --migration-guard-bypass-reason <reason>
                       Add the guarded production migration bypass reason to --migrate-apply.
  --doctor             Run production-doctor one-off job on backend and poll status.
  --smoke              Curl https://hachozeh.com/edge/health and https://hachozeh.com/.
  --run-dir <path>     Receipt directory. Default: workspace/runtime/render-deploy/<timestamp>.
  --dry-run            Print command plan only; no Render or curl calls.
  --help               Show this help.
USAGE
}

die() {
  echo "render-deploy-stack: $*" >&2
  exit 1
}

join_cmd() {
  local arg
  local out=""
  for arg in "$@"; do
    out+="$(printf "%q" "$arg") "
  done
  printf "%s" "${out% }"
}

extract_id_like() {
  local file="$1"
  local id=""
  id="$(grep -Eo 'dep-[A-Za-z0-9]+' "$file" | head -n 1 || true)"
  if [[ -z "$id" ]]; then
    id="$(grep -Eo 'job-[A-Za-z0-9]+' "$file" | head -n 1 || true)"
  fi
  printf "%s" "${id:-n/a}"
}

extract_json_field() {
  local file="$1"
  local field="$2"
  node - "$file" "$field" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const field = process.argv[3];
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
if (!payload || typeof payload[field] !== "string") {
  process.exit(1);
}
process.stdout.write(payload[field]);
NODE
}

poll_job_status() {
  local service_id="$1"
  local job_id="$2"
  local status_file="$3"
  local attempts="${4:-45}"
  local poll_seconds="${5:-4}"

  local job_status="failed"
  for _ in $(seq 1 "$attempts"); do
    job_status="$(render jobs list "$service_id" --output json | JOB_ID="$job_id" node -e '
const jobId = process.env.JOB_ID;
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const rows = JSON.parse(input);
  const match = Array.isArray(rows) ? rows.find((row) => row?.id === jobId) : null;
  process.stdout.write(match?.status ?? "missing");
});
'
)"
    printf "job=%s status=%s\n" "$job_id" "$job_status" >> "$status_file"

    case "$job_status" in
      succeeded|failed|canceled|missing)
        break
        ;;
    esac
    sleep "$poll_seconds"
  done

  printf "%s" "$job_status"
}

run_migration_job() {
  local mode="$1"
  local label="migration-${mode}"
  local command_file="$run_dir/${label}.cmd.txt"
  local create_file="$run_dir/${label}.create.json"
  local status_file="$run_dir/${label}.status.txt"
  local log_file="$run_dir/${label}.log.txt"
  local output_file="$run_dir/${label}.out.txt"
  local start_command="node dist/back/src/scripts/migrate.js"

  if [[ "$mode" == "plan" ]]; then
    start_command+=" --plan"
  elif [[ "$mode" == "apply" ]]; then
    if [[ -n "$migration_guard_bypass_reason" ]]; then
      start_command+=" --allow-production-recovery-guard-bypass --reason=${migration_guard_bypass_reason}"
    fi
  else
    die "unknown migration job mode: $mode"
  fi

  local create_cmd=(render jobs create "$SERVICE_BACKEND" --start-command "$start_command" --output json --confirm)
  local command_text
  command_text="$(join_cmd "${create_cmd[@]}")"
  printf "%s\n" "$command_text" > "$command_file"

  if [[ "$dry_run" == "true" ]]; then
    echo "[dry-run] $command_text" > "$output_file"
    echo "${label}|${SERVICE_BACKEND}|planned|n/a|${command_file}|${output_file}" >> "$run_dir/summary.txt"
    summary_lines+=("${label}|${SERVICE_BACKEND}|planned|n/a|${command_file}|${output_file}")
    return 0
  fi

  if ! "${create_cmd[@]}" > "$create_file" 2>&1; then
    echo "${label}|${SERVICE_BACKEND}|failed|n/a|${command_file}|${output_file}" >> "$run_dir/summary.txt"
    summary_lines+=("${label}|${SERVICE_BACKEND}|failed|n/a|${command_file}|${output_file}")
    overall_success="false"
    return 1
  fi

  local job_id
  job_id="$(extract_json_field "$create_file" "id")"
  local start_time
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local attempts="${RENDER_MIGRATION_POLL_ATTEMPTS:-60}"
  local poll_seconds="${RENDER_MIGRATION_POLL_SECONDS:-5}"
  local log_limit="${RENDER_MIGRATION_LOG_LIMIT:-500}"

  local job_status
  job_status="$(poll_job_status "$SERVICE_BACKEND" "$job_id" "$status_file" "$attempts" "$poll_seconds")"
  render logs --resources "$job_id" --start "$start_time" --limit "$log_limit" --output text > "$log_file"
  printf "%s\n" "id=$job_id status=$job_status" > "$output_file"

  if [[ "$mode" == "plan" ]]; then
    local pending_raw
    pending_raw="$(grep -Eo 'pending=[0-9]+' "$log_file" | tail -n 1 | cut -d= -f2 || true)"
    migration_pending_count="${pending_raw:-unknown}"
    printf "pending=%s\n" "$migration_pending_count" >> "$output_file"
  fi

  if [[ "$job_status" != "succeeded" ]]; then
    overall_success="false"
    echo "${label}|${SERVICE_BACKEND}|${job_status}|${job_id}|${command_file}|${output_file}" >> "$run_dir/summary.txt"
    summary_lines+=("${label}|${SERVICE_BACKEND}|${job_status}|${job_id}|${command_file}|${output_file}")
    return 1
  fi

  echo "${label}|${SERVICE_BACKEND}|${job_status}|${job_id}|${command_file}|${output_file}" >> "$run_dir/summary.txt"
  summary_lines+=("${label}|${SERVICE_BACKEND}|${job_status}|${job_id}|${command_file}|${output_file}")
}

deploy_target() {
  local name="$1"
  local service_id="$2"
  local use_commit="$3"
  local output_file="$run_dir/${name}.out.txt"
  local command_file="$run_dir/${name}.cmd.txt"
  local command=(render deploys create "$service_id")

  if [[ "$use_commit" == "true" ]]; then
    command+=(--commit "$deploy_sha")
  fi
  command+=(--wait --confirm --output text)

  local command_text
  command_text="$(join_cmd "${command[@]}")"
  printf "%s\n" "$command_text" > "$command_file"

  local target_status="failed"
  local deploy_id="n/a"
  if [[ "$dry_run" == "true" ]]; then
    echo "[dry-run] $command_text" > "$output_file"
    target_status="planned"
  else
    if "${command[@]}" > "$output_file" 2>&1; then
      target_status="succeeded"
    else
      target_status="failed"
      overall_success="false"
    fi
    deploy_id="$(extract_id_like "$output_file")"
  fi

  echo "${name}|${service_id}|${target_status}|${deploy_id}|${command_file}|${output_file}" >> "$run_dir/summary.txt"
  summary_lines+=("${name}|${service_id}|${target_status}|${deploy_id}|${command_file}|${output_file}")
}

run_doctor_job() {
  local command_file="$run_dir/doctor-job.cmd.txt"
  local create_file="$run_dir/doctor-job.create.json"
  local status_file="$run_dir/doctor-job.status.txt"
  local log_file="$run_dir/doctor-job.log.txt"
  local output_file="$run_dir/doctor-job.out.txt"

  local start_command="node dist/back/src/scripts/production-doctor.js --json --fail-on-watch"
  local create_cmd=(render jobs create "$SERVICE_BACKEND" --start-command "$start_command" --output json --confirm)
  local command_text
  command_text="$(join_cmd "${create_cmd[@]}")"
  printf "%s\n" "$command_text" > "$command_file"

  if [[ "$dry_run" == "true" ]]; then
    echo "[dry-run] $command_text" > "$output_file"
    echo "doctor|${SERVICE_BACKEND}|planned|n/a|${command_file}|${output_file}" >> "$run_dir/summary.txt"
    summary_lines+=("doctor|${SERVICE_BACKEND}|planned|n/a|${command_file}|${output_file}")
    return
  fi

  local job_create_status=0
  if ! "${create_cmd[@]}" > "$create_file" 2>&1; then
    job_create_status=1
  fi

  if [[ "$job_create_status" -ne 0 ]]; then
    echo "doctor|${SERVICE_BACKEND}|failed|n/a|${command_file}|${output_file}" >> "$run_dir/summary.txt"
    summary_lines+=("doctor|${SERVICE_BACKEND}|failed|n/a|${command_file}|${output_file}")
    overall_success="false"
    return
  fi

  local job_id
  job_id="$(extract_json_field "$create_file" "id")"
  local start_time
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local attempts="${RENDER_DOCTOR_POLL_ATTEMPTS:-45}"
  local poll_seconds="${RENDER_DOCTOR_POLL_SECONDS:-4}"
  local log_limit="${RENDER_DOCTOR_LOG_LIMIT:-500}"

  local job_status
  job_status="$(poll_job_status "$SERVICE_BACKEND" "$job_id" "$status_file" "$attempts" "$poll_seconds")"

  render logs --resources "$job_id" --start "$start_time" --limit "$log_limit" --output text > "$log_file"
  if [[ "$job_status" != "succeeded" ]]; then
    overall_success="false"
  fi
  printf "%s\n" "id=$job_id status=$job_status" > "$output_file"

  echo "doctor|${SERVICE_BACKEND}|${job_status}|${job_id}|${command_file}|${output_file}" >> "$run_dir/summary.txt"
  summary_lines+=("doctor|${SERVICE_BACKEND}|${job_status}|${job_id}|${command_file}|${output_file}")
}

run_avatar_storage_gate() {
  local command_file="$run_dir/avatar-storage-gate.cmd.txt"
  local create_file="$run_dir/avatar-storage-gate.create.json"
  local status_file="$run_dir/avatar-storage-gate.status.txt"
  local log_file="$run_dir/avatar-storage-gate.log.txt"
  local output_file="$run_dir/avatar-storage-gate.out.txt"
  local start_command="node dist/back/src/scripts/avatar-storage-audit.js --json"
  local create_cmd=(render jobs create "$SERVICE_BACKEND" --start-command "$start_command" --output json --confirm)
  local command_text
  command_text="$(join_cmd "${create_cmd[@]}")"
  printf "%s\n" "$command_text" > "$command_file"

  if [[ "$dry_run" == "true" ]]; then
    echo "[dry-run] $command_text" > "$output_file"
    echo "avatar-storage-gate|${SERVICE_BACKEND}|planned|n/a|${command_file}|${output_file}" >> "$run_dir/summary.txt"
    summary_lines+=("avatar-storage-gate|${SERVICE_BACKEND}|planned|n/a|${command_file}|${output_file}")
    return 0
  fi

  if ! "${create_cmd[@]}" > "$create_file" 2>&1; then
    overall_success="false"
    echo "avatar-storage-gate|${SERVICE_BACKEND}|failed|n/a|${command_file}|${output_file}" >> "$run_dir/summary.txt"
    summary_lines+=("avatar-storage-gate|${SERVICE_BACKEND}|failed|n/a|${command_file}|${output_file}")
    return 1
  fi

  local job_id
  job_id="$(extract_json_field "$create_file" "id")"
  local start_time
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local job_status
  job_status="$(poll_job_status "$SERVICE_BACKEND" "$job_id" "$status_file")"
  render logs --resources "$job_id" --start "$start_time" --limit 200 --output text > "$log_file"
  printf "%s\n" "id=$job_id status=$job_status" > "$output_file"

  echo "avatar-storage-gate|${SERVICE_BACKEND}|${job_status}|${job_id}|${command_file}|${output_file}" >> "$run_dir/summary.txt"
  summary_lines+=("avatar-storage-gate|${SERVICE_BACKEND}|${job_status}|${job_id}|${command_file}|${output_file}")
  if [[ "$job_status" != "succeeded" ]]; then
    overall_success="false"
    return 1
  fi
}

run_smoke_checks() {
  local urls=( "https://hachozeh.com/edge/health" "https://hachozeh.com/" )
  local status="succeeded"

  for index in "${!urls[@]}"; do
    local url="${urls[$index]}"
    local file="$run_dir/smoke-$index.out.txt"
    local cmd_file="$run_dir/smoke-$index.cmd.txt"
    local command_text="curl -sS -o ${file} -w '%{http_code}' ${url}"
    printf "%s\n" "$command_text" > "$cmd_file"

    if [[ "$dry_run" == "true" ]]; then
      echo "[dry-run] $command_text" > "$file"
      echo "smoke|${url}|planned|n/a|${cmd_file}|${file}" >> "$run_dir/summary.txt"
      summary_lines+=("smoke|${url}|planned|n/a|${cmd_file}|${file}")
      continue
    fi

    local code
    code="$(curl -sS -o "$file" -w "%{http_code}" "$url" || true)"
    if [[ "$code" =~ ^[23] ]]; then
      printf "smoke|%s|succeeded|%s|%s|%s\n" "$url" "$code" "$cmd_file" "$file" >> "$run_dir/summary.txt"
      summary_lines+=("smoke|${url}|succeeded|${code}|${cmd_file}|${file}")
      continue
    fi

    status="failed"
    overall_success="false"
    echo "smoke|${url}|failed|curl-failed|${cmd_file}|${file}" >> "$run_dir/summary.txt"
    summary_lines+=("smoke|${url}|failed|curl-failed|${cmd_file}|${file}")
  done

  if [[ "$status" == "failed" ]]; then
    return 1
  fi
}

print_summary() {
  echo
  echo "Render deploy stack run receipts: $run_dir"
  echo
  printf "%-20s %-12s %-26s %s\n" "Target" "Status" "ID" "Details"
  echo "--------------------------------------------------------------------------------"

  local line
  for line in "${summary_lines[@]}"; do
    local name service status target_id cmd output
    IFS='|' read -r name service status target_id cmd output <<< "$line"
    printf "%-20s %-12s %-26s %s\n" "$name" "$status" "$target_id" "$output"
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)
      deploy_backend="true"
      shift
      ;;
    --web)
      deploy_web="true"
      shift
      ;;
    --gateway)
      deploy_gateway="true"
      shift
      ;;
    --horizon)
      deploy_horizon="true"
      shift
      ;;
    --oracle)
      deploy_oracle="true"
      shift
      ;;
    --market-watch)
      deploy_market_watch="true"
      shift
      ;;
    --prod-doctor)
      deploy_prod_doctor="true"
      shift
      ;;
    --all-active)
      deploy_backend="true"
      deploy_web="true"
      deploy_gateway="true"
      deploy_horizon="true"
      deploy_oracle="true"
      deploy_market_watch="true"
      deploy_prod_doctor="true"
      shift
      ;;
    --sha)
      deploy_sha="${2:-}"
      if [[ -z "$deploy_sha" ]]; then
        die "missing --sha value"
      fi
      shift 2
      ;;
    --sha=*)
      deploy_sha="${1#*=}"
      if [[ -z "$deploy_sha" ]]; then
        die "missing --sha value"
      fi
      shift
      ;;
    --skip-migration-check)
      skip_migration_check="true"
      shift
      ;;
    --avatar-storage-gate-bypass-reason)
      avatar_storage_gate_bypass_reason="${2:-}"
      if [[ -z "$avatar_storage_gate_bypass_reason" ]]; then
        die "missing --avatar-storage-gate-bypass-reason value"
      fi
      shift 2
      ;;
    --avatar-storage-gate-bypass-reason=*)
      avatar_storage_gate_bypass_reason="${1#*=}"
      if [[ -z "$avatar_storage_gate_bypass_reason" ]]; then
        die "missing --avatar-storage-gate-bypass-reason value"
      fi
      shift
      ;;
    --migrate-apply)
      migrate_apply="true"
      shift
      ;;
    --migration-guard-bypass-reason)
      migration_guard_bypass_reason="${2:-}"
      if [[ -z "$migration_guard_bypass_reason" ]]; then
        die "missing --migration-guard-bypass-reason value"
      fi
      shift 2
      ;;
    --migration-guard-bypass-reason=*)
      migration_guard_bypass_reason="${1#*=}"
      if [[ -z "$migration_guard_bypass_reason" ]]; then
        die "missing --migration-guard-bypass-reason value"
      fi
      shift
      ;;
    --doctor)
      run_doctor="true"
      shift
      ;;
    --smoke)
      run_smoke="true"
      shift
      ;;
    --run-dir)
      run_dir="${2:-}"
      if [[ -z "$run_dir" ]]; then
        die "missing --run-dir value"
      fi
      if [[ "$run_dir" != /* ]]; then
        run_dir="$repo_root/$run_dir"
      fi
      shift 2
      ;;
    --run-dir=*)
      run_dir="${1#*=}"
      if [[ -z "$run_dir" ]]; then
        die "missing --run-dir value"
      fi
      if [[ "$run_dir" != /* ]]; then
        run_dir="$repo_root/$run_dir"
      fi
      shift
      ;;
    --dry-run)
      dry_run="true"
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

if [[ "$deploy_backend" != "true" && "$deploy_web" != "true" && "$deploy_gateway" != "true" && "$deploy_horizon" != "true" && "$deploy_oracle" != "true" && "$deploy_market_watch" != "true" && "$deploy_prod_doctor" != "true" && "$run_doctor" != "true" && "$run_smoke" != "true" ]]; then
  usage >&2
  exit 2
fi

mkdir -p "$run_dir"
if [[ "$dry_run" == "false" ]]; then
  command -v render >/dev/null || die "render CLI is required."
  command -v node >/dev/null || die "node is required."
  if [[ "$run_smoke" == "true" ]]; then
    command -v curl >/dev/null || die "curl is required for smoke."
  fi
fi

if [[ "$deploy_backend" == "true" ]]; then
  if [[ -z "$avatar_storage_gate_bypass_reason" ]]; then
    if ! run_avatar_storage_gate; then
      print_summary
      die "avatar storage integrity gate failed; repair dangling references before replacing the backend"
    fi
  else
    bypass_file="$run_dir/avatar-storage-gate-bypass.txt"
    printf "reason=%s\n" "$avatar_storage_gate_bypass_reason" > "$bypass_file"
    echo "avatar-storage-gate|${SERVICE_BACKEND}|bypassed|n/a|${bypass_file}|${bypass_file}" >> "$run_dir/summary.txt"
    summary_lines+=("avatar-storage-gate|${SERVICE_BACKEND}|bypassed|n/a|${bypass_file}|${bypass_file}")
  fi

  deploy_target "backend" "$SERVICE_BACKEND" "true"
  if [[ "$overall_success" != "true" ]]; then
    print_summary
    die "backend deploy failed; stop before migration check and dependent targets"
  fi

  if [[ "$skip_migration_check" != "true" ]]; then
    if ! run_migration_job "plan"; then
      print_summary
      die "migration plan failed; stop before deploying dependent targets"
    fi

    if [[ "$dry_run" == "true" ]]; then
      :
    elif [[ "$migration_pending_count" == "unknown" ]]; then
      overall_success="false"
      print_summary
      die "migration plan did not report a pending count; inspect ${run_dir}/migration-plan.log.txt"
    elif [[ "$migration_pending_count" != "0" ]]; then
      if [[ "$migrate_apply" != "true" ]]; then
        overall_success="false"
        print_summary
        die "pending migrations detected (${migration_pending_count}); rerun with --migrate-apply after reviewing the plan"
      fi

      if ! run_migration_job "apply"; then
        print_summary
        die "migration apply failed; stop before deploying dependent targets"
      fi
    fi
  fi
fi
if [[ "$deploy_web" == "true" ]]; then
  deploy_target "web" "$SERVICE_WEB" "true"
fi
if [[ "$deploy_gateway" == "true" ]]; then
  deploy_target "gateway" "$SERVICE_GATEWAY" "true"
fi
if [[ "$deploy_horizon" == "true" ]]; then
  deploy_target "horizon" "$SERVICE_HORIZON" "false"
fi
if [[ "$deploy_oracle" == "true" ]]; then
  deploy_target "oracle" "$SERVICE_ORACLE" "false"
fi
if [[ "$deploy_market_watch" == "true" ]]; then
  deploy_target "market-watch" "$SERVICE_MARKET_WATCH" "false"
fi
if [[ "$deploy_prod_doctor" == "true" ]]; then
  deploy_target "prod-doctor" "$SERVICE_PROD_DOCTOR" "false"
fi
if [[ "$run_doctor" == "true" ]]; then
  run_doctor_job
fi

if [[ "$run_smoke" == "true" ]]; then
  run_smoke_checks || overall_success="false"
fi

print_summary

if [[ "$overall_success" == "false" ]]; then
  die "one or more targets failed"
fi
