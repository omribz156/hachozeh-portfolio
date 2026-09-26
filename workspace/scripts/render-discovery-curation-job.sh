#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
surface=""
position=""
market=""
event=""
note=""
starts_at=""
ends_at=""
configure="false"
max_items=""
fill=""
clear_settings="false"
disable="false"
clear="false"
execute_render_job="false"
poll_seconds="${RENDER_DISCOVERY_CURATION_POLL_SECONDS:-4}"
poll_attempts="${RENDER_DISCOVERY_CURATION_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_DISCOVERY_CURATION_LOG_LIMIT:-500}"
run_dir=""

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-discovery-curation-job.sh --surface hero|trending --position <n> [target] [options]
  workspace/scripts/render-discovery-curation-job.sh --surface hero --configure --max-items <n> --fill true|false

Targets:
  --market <market-key>          Pin a market into the slot.
  --event <event-id-or-slug>     Pin an event card into the slot.

Actions:
  --clear                        Delete the slot.
  --disable                      Disable the slot without deleting metadata.
  --configure                    Configure hero curation settings instead of a slot.
  --clear-settings               Clear hero curation settings.

Options:
  --note <text>                  Operator note for set/update.
  --max-items <n>                Hero settings: cap rendered hero items.
  --fill true|false              Hero settings: auto-fill after pinned slots. Use false for pinned-only.
  --starts-at <timestamp>        Optional activation timestamp.
  --ends-at <timestamp>          Optional expiry timestamp.
  --service <name-or-id>         Render backend service. Default: hachozeh-backend.
  --execute-render-job           Actually create the Render one-off job.
  --run-dir <path>               Receipt directory. Default: workspace/runtime/render-discovery-curation/<timestamp>.
  --poll-seconds <n>             Render job poll interval. Default: 4.
  --poll-attempts <n>            Render job poll attempts. Default: 45.
  --log-limit <n>                Render log lines to capture. Default: 500.

Default mode is dry-run: prints the Render command shape only.
Render command uses compiled JS directly; it does not require npm on Render.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --surface)
      surface="${2:-}"
      shift 2
      ;;
    --position)
      position="${2:-}"
      shift 2
      ;;
    --market)
      market="${2:-}"
      shift 2
      ;;
    --event)
      event="${2:-}"
      shift 2
      ;;
    --note)
      note="${2:-}"
      shift 2
      ;;
    --starts-at)
      starts_at="${2:-}"
      shift 2
      ;;
    --ends-at)
      ends_at="${2:-}"
      shift 2
      ;;
    --configure)
      configure="true"
      shift
      ;;
    --max-items)
      max_items="${2:-}"
      shift 2
      ;;
    --fill)
      fill="${2:-}"
      shift 2
      ;;
    --clear-settings)
      clear_settings="true"
      shift
      ;;
    --clear)
      clear="true"
      shift
      ;;
    --disable)
      disable="true"
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

if [[ "$surface" != "hero" && "$surface" != "trending" ]]; then
  echo "Missing/invalid --surface. Use hero or trending." >&2
  usage >&2
  exit 2
fi

if [[ "$clear" == "true" && "$disable" == "true" ]]; then
  echo "Use only one action: --clear or --disable." >&2
  usage >&2
  exit 2
fi

if [[ "$configure" == "true" && "$clear_settings" == "true" ]]; then
  echo "Use only one settings action: --configure or --clear-settings." >&2
  usage >&2
  exit 2
fi

if [[ "$configure" == "true" || "$clear_settings" == "true" ]]; then
  if [[ "$surface" != "hero" ]]; then
    echo "Settings are currently supported only for --surface hero." >&2
    usage >&2
    exit 2
  fi
  if [[ -n "$position" || -n "$market" || -n "$event" || "$clear" == "true" || "$disable" == "true" ]]; then
    echo "Use --configure/--clear-settings separately from slot target options." >&2
    usage >&2
    exit 2
  fi
  if [[ "$configure" == "true" && -z "$max_items" && -z "$fill" && -z "$note" ]]; then
    echo "Missing setting. Pass --max-items, --fill, or --note with --configure." >&2
    usage >&2
    exit 2
  fi
else
  if [[ ! "$position" =~ ^[0-9]+$ || "$position" == "0" ]]; then
    echo "Missing/invalid --position. Use a positive integer." >&2
    usage >&2
    exit 2
  fi
  if [[ "$clear" != "true" && "$disable" != "true" && -z "$market" && -z "$event" ]]; then
    echo "Missing target. Pass --market or --event, or use --clear/--disable." >&2
    usage >&2
    exit 2
  fi
  if [[ -n "$market" && -n "$event" ]]; then
    echo "Use only one target: --market or --event." >&2
    usage >&2
    exit 2
  fi
fi

script_args=(--json --surface "$surface")
if [[ "$clear_settings" == "true" ]]; then
  script_args+=(--clear-settings)
elif [[ "$configure" == "true" ]]; then
  script_args+=(--configure)
  if [[ -n "$max_items" ]]; then
    script_args+=(--max-items "$max_items")
  fi
  if [[ -n "$fill" ]]; then
    script_args+=(--fill "$fill")
  fi
  if [[ -n "$note" ]]; then
    script_args+=(--note "$note")
  fi
else
  script_args+=(--position "$position")
fi

if [[ "$clear" == "true" ]]; then
  script_args+=(--clear)
elif [[ "$disable" == "true" ]]; then
  script_args+=(--disable)
elif [[ "$configure" != "true" && "$clear_settings" != "true" ]]; then
  if [[ -n "$market" ]]; then
    script_args+=(--market "$market")
  fi
  if [[ -n "$event" ]]; then
    script_args+=(--event "$event")
  fi
  if [[ -n "$note" ]]; then
    script_args+=(--note "$note")
  fi
  if [[ -n "$starts_at" ]]; then
    script_args+=(--starts-at "$starts_at")
  fi
  if [[ -n "$ends_at" ]]; then
    script_args+=(--ends-at "$ends_at")
  fi
fi

render_job_require_command node

resolved_service="$service"
if [[ "$execute_render_job" == "true" ]]; then
  render_job_require_command render
  resolved_service="$(render_job_resolve_service_id "$service")"
fi
render_command="$(render_job_command_from_args node dist/back/src/scripts/set-discovery-curation.js "${script_args[@]}")"

if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-discovery-curation/$(date -u +"%Y%m%dT%H%M%SZ")"
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

json_file="$(render_json_job "discovery-curation" "$render_command")"
echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`Render result: ${receipt.objectType ?? "json"}`);
if (receipt.row) {
  console.log(`${receipt.row.surface} #${receipt.row.position}: ${receipt.row.target_type}:${receipt.row.target_key}`);
}
if (typeof receipt.deleted !== "undefined") {
  console.log(`Deleted: ${receipt.deleted}`);
}
if (typeof receipt.updated !== "undefined") {
  console.log(`Updated: ${receipt.updated}`);
}
NODE
