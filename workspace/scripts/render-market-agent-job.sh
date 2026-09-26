#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"
cd "$repo_root"

service="hachozeh-backend"
snapshot_path="systems/seer/state/market-creation-drafts-latest.json"
render_input="auto"
draft_id=""
all_drafts="false"
seed_amount=""
allow_manual_resolution="false"
force_materialize="false"
show_graph="false"
show_parent_in_discovery=""
show_children_in_discovery=""
watch_plan_receipt=""
allow_missing_watch_plan="false"
execute_render_job="false"
poll_seconds="${RENDER_MARKET_AGENT_POLL_SECONDS:-4}"
poll_attempts="${RENDER_MARKET_AGENT_POLL_ATTEMPTS:-45}"
log_limit="${RENDER_MARKET_AGENT_LOG_LIMIT:-500}"
run_dir=""

usage() {
  cat <<'USAGE'
Usage:
  workspace/scripts/render-market-agent-job.sh --draft <creation-draft-id> [options]
  workspace/scripts/render-market-agent-job.sh --all true --snapshot <path> [options]

Options:
  --snapshot <path>              Seer creation draft snapshot path.
  --all true|false               Ship every draft in the snapshot. Default: false.
  --render-input auto|snapshot-path|base64
                                  Render payload mode. Default: auto.
  --service <name-or-id>         Render backend service. Default: hachozeh-backend.
  --seed-amount <amount>         Override publish seed.
  --allow-manual-resolution      Pass manual-resolution waiver to publish.
  --force-materialize            Force rematerialization.
  --show-graph                   Pass event graph display flag to materialization.
  --show-parent-in-discovery true|false
                                  Pass event parent discovery visibility to materialization.
  --show-children-in-discovery true|false
                                  Pass event child discovery visibility to materialization.
  --watch-plan-receipt <path>     Required when the snapshot declares market-watch pings.
  --allow-missing-watch-plan      Explicitly publish without an installed watch plan receipt.
  --execute-render-job           Actually create the Render one-off job.
  --run-dir <path>               Receipt directory. Default: workspace/runtime/render-market-agent/<timestamp>.
  --poll-seconds <n>             Render job poll interval. Default: 4.
  --poll-attempts <n>            Render job poll attempts. Default: 45.
  --log-limit <n>                Render log lines to capture. Default: 500.

Default mode is dry-run: local plan only plus the compact Render command shape.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --draft)
      draft_id="${2:-}"
      shift 2
      ;;
    --all)
      all_drafts="${2:-}"
      shift 2
      ;;
    --snapshot)
      snapshot_path="${2:-}"
      shift 2
      ;;
    --render-input)
      render_input="${2:-}"
      shift 2
      ;;
    --service)
      service="${2:-}"
      shift 2
      ;;
    --seed-amount)
      seed_amount="${2:-}"
      shift 2
      ;;
    --allow-manual-resolution)
      allow_manual_resolution="true"
      shift
      ;;
    --force-materialize)
      force_materialize="true"
      shift
      ;;
    --show-graph)
      show_graph="true"
      shift
      ;;
    --show-parent-in-discovery)
      show_parent_in_discovery="${2:-}"
      shift 2
      ;;
    --show-children-in-discovery)
      show_children_in_discovery="${2:-}"
      shift 2
      ;;
    --watch-plan-receipt)
      watch_plan_receipt="${2:-}"
      shift 2
      ;;
    --allow-missing-watch-plan)
      allow_missing_watch_plan="true"
      shift
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

if [[ "$all_drafts" != "true" && "$all_drafts" != "false" ]]; then
  echo "--all must be true|false." >&2
  exit 2
fi

if [[ "$all_drafts" == "false" && -z "$draft_id" ]]; then
  echo "Missing required --draft, or pass --all true." >&2
  usage >&2
  exit 2
fi

if [[ ! -f "$snapshot_path" ]]; then
  echo "Snapshot file not found: $snapshot_path" >&2
  exit 2
fi

case "$render_input" in
  auto|snapshot-path|base64) ;;
  *)
    echo "--render-input must be auto, snapshot-path, or base64." >&2
    exit 2
    ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
single_snapshot="$tmp_dir/market-creation-drafts.json"

node - "$snapshot_path" "$draft_id" "$all_drafts" "$single_snapshot" <<'NODE'
const fs = require("node:fs");
const [snapshotPath, draftId, allDrafts, outPath] = process.argv.slice(2);
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const items = allDrafts === "true"
  ? snapshot.items
  : snapshot.items?.filter((candidate) => candidate.creationDraftId === draftId);

if (!Array.isArray(items) || items.length === 0) {
  console.error(`Draft not found in snapshot: ${draftId}`);
  process.exit(2);
}

fs.writeFileSync(outPath, JSON.stringify({
  ...snapshot,
  snapshotId: `${snapshot.snapshotId || "mcds"}_${allDrafts === "true" ? "all" : draftId}_render_job`,
  itemCount: items.length,
  items
}, null, 2));
NODE

node - "$single_snapshot" "$watch_plan_receipt" "$allow_missing_watch_plan" <<'NODE'
const fs = require("node:fs");
const [snapshotPath, receiptPath, allowMissing] = process.argv.slice(2);
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const items = Array.isArray(snapshot.items) ? snapshot.items : [];

function containsWatchRequired(value) {
  if (value === "market-watch-pings-only-no-mutation") return true;
  if (Array.isArray(value)) return value.some(containsWatchRequired);
  if (value && typeof value === "object") return Object.values(value).some(containsWatchRequired);
  return false;
}

const watchRequired = items.filter((item) => containsWatchRequired(item) && !item.watchPlan);
if (watchRequired.length === 0) process.exit(0);

if (receiptPath) {
  if (!fs.existsSync(receiptPath)) {
    console.error(`Watch-plan receipt not found: ${receiptPath}`);
    process.exit(2);
  }
  console.log(`Watch-plan guard: receipt=${receiptPath}`);
  process.exit(0);
}

if (allowMissing === "true") {
  console.warn(`Watch-plan guard: explicit missing-watch override for ${watchRequired.length} draft(s).`);
  process.exit(0);
}

console.error(
  [
    `Watch-plan guard failed: ${watchRequired.length} draft(s) declare market-watch-pings-only-no-mutation.`,
    "Pass --watch-plan-receipt <path> after installing the prod watch plan,",
    "or pass --allow-missing-watch-plan to make the missing watch plan explicit."
  ].join(" ")
);
process.exit(2);
NODE

if [[ -n "$watch_plan_receipt" ]]; then
  node workspace/scripts/lib/market-watch-receipt-check.mjs "$single_snapshot" "$watch_plan_receipt"
fi

echo "Local dry-run:"
snapshot_b64="$(base64 < "$single_snapshot" | tr -d '\n')"

local_args=(ship --market-environment prod)
render_args=(ship --market-environment prod --execute true --json)

if [[ "$all_drafts" == "true" ]]; then
  local_args+=(--all true)
  render_args+=(--all true)
else
  local_args+=(--draft "$draft_id")
  render_args+=(--draft "$draft_id")
fi

if [[ -n "$seed_amount" ]]; then
  local_args+=(--seed-amount "$seed_amount")
  render_args+=(--seed-amount "$seed_amount")
fi

if [[ "$allow_manual_resolution" == "true" ]]; then
  local_args+=(--allow-manual-resolution true)
  render_args+=(--allow-manual-resolution true)
fi

if [[ "$force_materialize" == "true" ]]; then
  local_args+=(--force-materialize true)
  render_args+=(--force-materialize true)
fi

if [[ "$show_graph" == "true" ]]; then
  local_args+=(--show-graph true)
  render_args+=(--show-graph true)
fi

for flag_value in "$show_parent_in_discovery" "$show_children_in_discovery"; do
  if [[ -n "$flag_value" && "$flag_value" != "true" && "$flag_value" != "false" ]]; then
    echo "Discovery display flags must be true|false." >&2
    exit 2
  fi
done

if [[ -n "$show_parent_in_discovery" ]]; then
  local_args+=(--show-parent-in-discovery "$show_parent_in_discovery")
  render_args+=(--show-parent-in-discovery "$show_parent_in_discovery")
fi

if [[ -n "$show_children_in_discovery" ]]; then
  local_args+=(--show-children-in-discovery "$show_children_in_discovery")
  render_args+=(--show-children-in-discovery "$show_children_in_discovery")
fi

MARKET_AGENT_DRAFT_SNAPSHOT_B64="$snapshot_b64" \
  npm --prefix systems/back run market:agent -- "${local_args[@]}"

snapshot_abs="$(cd "$(dirname "$snapshot_path")" && pwd)/$(basename "$snapshot_path")"
deployed_snapshot_path=""
if [[ "$snapshot_abs" == "$repo_root"/workspace/market-packs/* ]]; then
  snapshot_rel="${snapshot_abs#"$repo_root"/}"
  deployed_snapshot_path="/app/$snapshot_rel"
fi

effective_render_input="$render_input"
if [[ "$effective_render_input" == "auto" ]]; then
  if [[ -n "$deployed_snapshot_path" ]]; then
    effective_render_input="snapshot-path"
  else
    effective_render_input="base64"
  fi
fi

if [[ "$effective_render_input" == "snapshot-path" ]]; then
  if [[ -z "$deployed_snapshot_path" ]]; then
    echo "--render-input snapshot-path requires a snapshot under workspace/market-packs/." >&2
    exit 2
  fi
  render_args+=(--snapshot-path "$deployed_snapshot_path")
else
  render_args+=(--snapshot-json-b64 "$snapshot_b64")
fi

render_job_require_command node

resolved_service="$service"
if [[ "$execute_render_job" == "true" ]]; then
  render_job_require_command render
  resolved_service="$(render_job_resolve_service_id "$service")"
fi
render_command="$(render_job_command_from_args node dist/back/src/scripts/agent-market.js "${render_args[@]}")"

if [[ -z "$run_dir" ]]; then
  run_dir="$repo_root/workspace/runtime/render-market-agent/$(date -u +"%Y%m%dT%H%M%SZ")"
fi

echo
echo "Render job target: $service ($resolved_service)"
echo "Render input: $effective_render_input"
echo "Render receipts: $run_dir"
redacted_render_args=("${render_args[@]}")
for i in "${!redacted_render_args[@]}"; do
  if [[ "${redacted_render_args[$i]}" == "$snapshot_b64" ]]; then
    redacted_render_args[$i]="<${#snapshot_b64}_chars>"
  fi
done
echo "Render job command: $(render_job_command_from_args node dist/back/src/scripts/agent-market.js "${redacted_render_args[@]}")"

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

label_source="$draft_id"
if [[ "$all_drafts" == "true" ]]; then
  label_source="$(basename "$snapshot_path" .json)-all"
fi
label="$(printf "%s" "$label_source" | tr -c 'A-Za-z0-9._-' '-')"
json_file="$(render_json_job "$label" "$render_command")"

echo "Render JSON receipt: $json_file"
node - "$json_file" <<'NODE'
const fs = require("node:fs");
const receiptPath = process.argv[2];
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const runs = Array.isArray(receipt.runs) ? receipt.runs : [];
const publishRuns = runs.filter((run) => String(run?.objectType ?? "").includes("publish"));
const marketIds = publishRuns
  .map((run) => run.marketId ?? run.market?.id ?? run.result?.marketId ?? null)
  .filter(Boolean);

console.log(`Render result: ${receipt.objectType ?? "json"} items=${receipt.itemCount ?? "unknown"} runs=${runs.length}`);
if (marketIds.length > 0) {
  console.log(`Published market ids: ${marketIds.join(", ")}`);
}
NODE
