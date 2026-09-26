#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/lifecycle-ops.sh <command> [args]

Commands:
  publish-promote       Promote a reviewed market pack snapshot into 03-prod.
  publish-check         Preflight or post-check a market publish snapshot.
  open-doctor           Read-only prod lifecycle/public API check for an open market.
  close-inspect         Inspect prod close-condition cases.
  close-approve         Approve prod close-condition cases after explicit operator approval.
  resolution-inspect    Inspect prod resolution cases.
  resolution-approve    Approve prod resolution cases after explicit operator approval.
  operator-resolve      Create/approve a manual official resolution case in prod-safe Render wrapper.
  incident-compensate   Dry-run or execute prod incident note / make-whole compensation wrapper.
  incident-reopen       Dry-run or execute prod premature-resolution reopen wrapper.
  incident-finalize     Dry-run or execute guarded partial-incident final settlement.
  incident-impact       Read-only incident impact / make-whole sizing report.
  incident-trades       Preview or reverse an exact suffix of known-result trades.
  incident-audit        Read-only post-incident audit receipt.
  contract-patch        Dry-run or execute guarded live market contract/source patch.
  integrity-scan        Read-only scan for market contract/source/lifecycle drift.
  notification-scan     Read-only notification integrity scan.
  queue-doctor          Read-only lifecycle queue doctor with reason codes.
  event-doctor          Read-only event/child dependency and cascade sanity report.
  event-audit           Read-only audit of every active multi-child event.
  production-doctor     Read-only production doctor aggregate report.
  cascade-preview       Read-only event/dependent cascade blast-radius preview.
  watch-doctor          Read-only market-watch opt-in coverage report.
  seer-opportunities    Read-only Seer next-market opportunity suggestions.
  batch-verify          Post-publish public API verifier for market snapshots.
  pack-lint             Static market-pack lint before publish.
  pack-lint-all         Static market-pack lint across every canonical prod snapshot.
  adapter-map           Static/read-only Oracle source adapter route map.
  receipts-index        Build compact runtime receipt index.
  recurring-guard       Static recurring-market snapshot guard before publish.
  event-partial-smoke   Prove early close/resolution for one event child while sibling stays open.
  cleanup-receipts      Dry-run or execute local runtime receipt cleanup.

Examples:
  workspace/scripts/lifecycle-ops.sh open-doctor --market <market-id>
  workspace/scripts/lifecycle-ops.sh close-inspect --expect-count 1
  workspace/scripts/lifecycle-ops.sh resolution-approve --market <market-id> --expect-count 1
  workspace/scripts/lifecycle-ops.sh operator-resolve --market <market-id> --mode official --winning-outcome-id <id> ...
  workspace/scripts/lifecycle-ops.sh incident-compensate --market <market-id> --note-only
  workspace/scripts/lifecycle-ops.sh incident-reopen --market <market-id>
  workspace/scripts/lifecycle-ops.sh incident-finalize --market <market-id> --oracle-case-id <case-id> --winning-outcome-id <outcome-id> --source-url <url>
  workspace/scripts/lifecycle-ops.sh incident-impact --market <market-id>
  workspace/scripts/lifecycle-ops.sh incident-trades --market <market-id> --cutoff-at <iso> --trade <trade-id>
  workspace/scripts/lifecycle-ops.sh incident-audit --market <market-id>
  workspace/scripts/lifecycle-ops.sh contract-patch --market <market-id> --replace-from <old> --replace-to <new>
  workspace/scripts/lifecycle-ops.sh integrity-scan --market <market-id>
  workspace/scripts/lifecycle-ops.sh notification-scan --market <market-id>
  workspace/scripts/lifecycle-ops.sh queue-doctor --market <market-id>
  workspace/scripts/lifecycle-ops.sh event-doctor --event <event-id>
  workspace/scripts/lifecycle-ops.sh event-audit
  workspace/scripts/lifecycle-ops.sh production-doctor --execute-render-job
  workspace/scripts/lifecycle-ops.sh cascade-preview --case <oracle-case-id>
  workspace/scripts/lifecycle-ops.sh watch-doctor --event <event-id>
  workspace/scripts/lifecycle-ops.sh seer-opportunities --event <event-id>
  workspace/scripts/lifecycle-ops.sh batch-verify --snapshot <snapshot-path>
  workspace/scripts/lifecycle-ops.sh pack-lint --snapshot <snapshot-path>
  workspace/scripts/lifecycle-ops.sh pack-lint-all
  workspace/scripts/lifecycle-ops.sh adapter-map
  workspace/scripts/lifecycle-ops.sh receipts-index
  workspace/scripts/lifecycle-ops.sh recurring-guard --snapshot <snapshot-path>
  workspace/scripts/lifecycle-ops.sh publish-promote --pack <pack-name> --draft <draft-id>
  workspace/scripts/lifecycle-ops.sh event-partial-smoke
EOF
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi

command_name="$1"
shift

render_backend_tool() {
  local tool="$1"
  shift
  local wrapper_args=(--tool "$tool")
  local tool_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --execute-render-job)
        wrapper_args+=("$1")
        shift
        ;;
      --service|--run-dir|--poll-seconds|--poll-attempts|--log-limit)
        wrapper_args+=("$1" "${2:-}")
        shift 2
        ;;
      --)
        shift
        tool_args+=("$@")
        break
        ;;
      *)
        tool_args+=("$1")
        shift
        ;;
    esac
  done

  if [[ "${#tool_args[@]}" -gt 0 ]]; then
    exec "$repo_root/workspace/scripts/render-backend-tool-job.sh" "${wrapper_args[@]}" -- "${tool_args[@]}"
  fi
  exec "$repo_root/workspace/scripts/render-backend-tool-job.sh" "${wrapper_args[@]}"
}

case "$command_name" in
  -h|--help|help)
    usage
    ;;
  publish-promote)
    exec "$repo_root/workspace/scripts/market-pack-promote.sh" "$@"
    ;;
  publish-check)
    exec "$repo_root/workspace/scripts/render-market-publish-check.sh" "$@"
    ;;
  open-doctor)
    exec "$repo_root/workspace/scripts/open-market-doctor.sh" "$@"
    ;;
  close-inspect)
    exec "$repo_root/workspace/scripts/render-oracle-close-cases.sh" --inspect "$@"
    ;;
  close-approve)
    exec "$repo_root/workspace/scripts/render-oracle-close-cases.sh" --approve "$@"
    ;;
  resolution-inspect)
    exec "$repo_root/workspace/scripts/render-oracle-resolution-cases.sh" --inspect "$@"
    ;;
  resolution-approve)
    exec "$repo_root/workspace/scripts/render-oracle-resolution-cases.sh" --approve "$@"
    ;;
  operator-resolve)
    exec "$repo_root/workspace/scripts/render-oracle-operator-resolve.sh" "$@"
    ;;
  incident-compensate)
    exec "$repo_root/workspace/scripts/render-market-incident-compensation.sh" "$@"
    ;;
  incident-reopen)
    exec "$repo_root/workspace/scripts/render-market-incident-reopen.sh" "$@"
    ;;
  incident-finalize)
    exec "$repo_root/workspace/scripts/render-market-incident-finalize.sh" "$@"
    ;;
  incident-impact)
    render_backend_tool incident-impact "$@"
    ;;
  incident-trades)
    render_backend_tool incident-trades "$@"
    ;;
  incident-audit)
    render_backend_tool incident-audit "$@"
    ;;
  contract-patch)
    exec "$repo_root/workspace/scripts/render-market-contract-patch.sh" "$@"
    ;;
  integrity-scan)
    render_backend_tool integrity-scan "$@"
    ;;
  notification-scan)
    render_backend_tool notification-scan "$@"
    ;;
  queue-doctor)
    render_backend_tool queue-doctor "$@"
    ;;
  event-doctor)
    render_backend_tool event-doctor "$@"
    ;;
  event-audit)
    render_backend_tool event-doctor --all-active --jsonl "$@"
    ;;
  production-doctor)
    render_backend_tool production-doctor "$@"
    ;;
  cascade-preview)
    render_backend_tool cascade-preview "$@"
    ;;
  watch-doctor)
    render_backend_tool watch-doctor "$@"
    ;;
  seer-opportunities)
    render_backend_tool seer-opportunities "$@"
    ;;
  batch-verify)
    exec npm --prefix "$repo_root/systems/back" run publish:batch-verify -- "$@"
    ;;
  pack-lint)
    exec npm --silent --prefix "$repo_root/systems/back" run market:pack-lint -- "$@"
    ;;
  pack-lint-all)
    exec npm --silent --prefix "$repo_root/systems/back" run market:pack-lint -- --all-prod --summary --json "$@"
    ;;
  adapter-map)
    exec npm --prefix "$repo_root/systems/back" run oracle:adapter-coverage-map -- "$@"
    ;;
  receipts-index)
    exec npm --prefix "$repo_root/systems/back" run ops:receipts-index -- "$@"
    ;;
  recurring-guard)
    exec npm --prefix "$repo_root/systems/back" run market:recurring-guard -- "$@"
    ;;
  event-partial-smoke)
    exec npm --prefix "$repo_root/systems/back" run oracle:eol-smoke -- "$@"
    ;;
  cleanup-receipts)
    exec "$repo_root/workspace/scripts/cleanup-runtime-receipts.sh" "$@"
    ;;
  *)
    echo "Unknown lifecycle command: $command_name" >&2
    usage >&2
    exit 2
    ;;
esac
