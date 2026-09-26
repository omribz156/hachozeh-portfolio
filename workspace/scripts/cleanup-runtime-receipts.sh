#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_dir="$repo_root/workspace/runtime"
days="14"
execute="false"

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/cleanup-runtime-receipts.sh [options]

Options:
  --days <n>      Delete receipts older than n days. Defaults to 14.
  --execute       Actually delete. Without this, prints a dry-run.
  -h, --help      Show this help.

Scope:
  Cleans local files under workspace/runtime only. Durable market snapshots and
  operator decisions belong in workspace/market-packs or workspace/docs.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)
      days="${2:-}"
      shift 2
      ;;
    --days=*)
      days="${1#--days=}"
      shift
      ;;
    --execute)
      execute="true"
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

if [[ ! "$days" =~ ^[0-9]+$ ]]; then
  echo "--days must be a non-negative integer." >&2
  exit 2
fi

if [[ ! -d "$runtime_dir" ]]; then
  echo "cleanup-runtime-receipts: no runtime dir at $runtime_dir"
  exit 0
fi

case "$runtime_dir" in
  "$repo_root"/workspace/runtime) ;;
  *)
    echo "Refusing to clean unexpected path: $runtime_dir" >&2
    exit 2
    ;;
esac

mode="dry-run"
[[ "$execute" == "true" ]] && mode="execute"
echo "cleanup-runtime-receipts: mode=${mode} dir=${runtime_dir} olderThanDays=${days}"

if [[ "$execute" == "true" ]]; then
  find "$runtime_dir" -mindepth 1 -type f -mtime +"$days" -print -delete
  find "$runtime_dir" -mindepth 1 -type d -empty -print -delete
else
  find "$runtime_dir" -mindepth 1 -type f -mtime +"$days" -print
  echo "cleanup-runtime-receipts: dry-run only; rerun with --execute to delete."
fi
