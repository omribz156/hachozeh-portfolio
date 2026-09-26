#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
show_graph=""
show_parent_in_discovery=""
show_children_in_discovery=""
execute_render_job="false"
poll_seconds="${RENDER_EVENT_FLAGS_POLL_SECONDS:-4}"
poll_attempts="${RENDER_EVENT_FLAGS_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_EVENT_FLAGS_LOG_LIMIT:-500}"
run_dir=""
events=()

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-event-display-flags-job.sh --event <event-id> [display flags] [options]

Options:
  --event <event-id>             Event id to update. Repeat for multiple events.
  --show-graph true|false        Toggle the event-page graph.
  --show-parent-in-discovery true|false
                                  Toggle parent event card in discovery. Default behavior is true.
  --show-children-in-discovery true|false
                                  Toggle child market cards in discovery. Default behavior is false.
  --service <name-or-id>         Render backend service. Default: hachozeh-backend.
  --execute-render-job           Actually create the Render one-off job.
  --run-dir <path>               Receipt directory. Default: workspace/runtime/render-event-display-flags/<timestamp>.
  --poll-seconds <n>             Render job poll interval. Default: 4.
  --poll-attempts <n>            Render job poll attempts. Default: 45.
  --log-limit <n>                Render log lines to capture. Default: 500.

Default mode is dry-run: prints the Render command shape only.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --event)
      events+=("${2:-}")
      shift 2
      ;;
    --show-graph)
      show_graph="${2:-}"
      shift 2
      ;;
    --show-parent-in-discovery)
      show_parent_in_discovery="${2:-}"
      shift 2
      ;;
    --show-children-in-discovery)
      show_children_in_discovery="${2:-}"
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

if [[ "${#events[@]}" -eq 0 ]]; then
  echo "Missing required --event." >&2
  usage >&2
  exit 2
fi

for flag_value in "$show_graph" "$show_parent_in_discovery" "$show_children_in_discovery"; do
  if [[ -n "$flag_value" && "$flag_value" != "true" && "$flag_value" != "false" ]]; then
    echo "Display flag values must be true|false." >&2
    usage >&2
    exit 2
  fi
done

if [[ -z "$show_graph" && -z "$show_parent_in_discovery" && -z "$show_children_in_discovery" ]]; then
  echo "Missing display flag. Pass --show-graph, --show-parent-in-discovery, or --show-children-in-discovery." >&2
  usage >&2
  exit 2
fi

script_args=(--json)
if [[ -n "$show_graph" ]]; then
  script_args+=(--show-graph "$show_graph")
fi
if [[ -n "$show_parent_in_discovery" ]]; then
  script_args+=(--show-parent-in-discovery "$show_parent_in_discovery")
fi
if [[ -n "$show_children_in_discovery" ]]; then
  script_args+=(--show-children-in-discovery "$show_children_in_discovery")
fi
for event_id in "${events[@]}"; do
  if [[ -z "$event_id" ]]; then
    echo "Empty --event value." >&2
    exit 2
  fi
  script_args+=(--event "$event_id")
done

render_job_require_command node

resolved_service="$service"
if [[ "$execute_render_job" == "true" ]]; then
  render_job_require_command render
  resolved_service="$(render_job_resolve_service_id "$service")"
fi
render_command="$(render_job_command_from_args node dist/back/src/scripts/set-event-display-flags.js "${script_args[@]}")"

if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-event-display-flags/$(date -u +"%Y%m%dT%H%M%SZ")"
fi

echo "Render job target: $service ($resolved_service)"
echo "Render job command: $render_command"
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

json_file="$(render_json_job "event-display-flags" "$render_command")"
echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ids = Array.isArray(receipt.rows) ? receipt.rows.map((row) => row.id).filter(Boolean) : [];
console.log(`Render result: ${receipt.objectType ?? "json"} updated=${receipt.updated ?? "unknown"}`);
if (ids.length > 0) {
  console.log(`Events: ${ids.join(", ")}`);
}
if (Array.isArray(receipt.missingEventIds) && receipt.missingEventIds.length > 0) {
  console.log(`Missing: ${receipt.missingEventIds.join(", ")}`);
}
NODE
