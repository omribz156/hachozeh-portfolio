#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./workspace/scripts/find-context.sh <pattern> [scope...]
  ./workspace/scripts/find-context.sh --files <pattern> [scope...]

Examples:
  ./workspace/scripts/find-context.sh "health|readiness|logging" backend docs tasks
  ./workspace/scripts/find-context.sh market-detail
  ./workspace/scripts/find-context.sh --files "market-detail|portfolio"

Defaults:
  scopes = frontend backend docs scripts tasks README.md AGENTS.md ARCHITECTURE.md SECURITY.md
EOF
}

if ! command -v rg >/dev/null 2>&1; then
  echo "rg is required for find-context.sh" >&2
  exit 1
fi

mode="content"

if [ "${1:-}" = "--files" ]; then
  mode="files"
  shift
fi

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

pattern="$1"
shift

scopes=("$@")

if [ ${#scopes[@]} -eq 0 ]; then
  scopes=(
    frontend
    backend
    docs
    scripts
    tasks
    README.md
    AGENTS.md
    ARCHITECTURE.md
    SECURITY.md
  )
fi

if [ "$mode" = "files" ]; then
  rg --files "${scopes[@]}" | rg -i "$pattern"
  exit 0
fi

rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!coverage/**' --glob '!playwright-report/**' --glob '!test-results/**' "$pattern" "${scopes[@]}"
