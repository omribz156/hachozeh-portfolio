#!/usr/bin/env bash
set -euo pipefail

mode="default"

for arg in "$@"; do
  case "$arg" in
    --backend|--push-gate)
      mode="backend"
      ;;
    --help|-h)
      cat <<'EOF'
Usage:
  workspace/scripts/check-release-hygiene.sh
  workspace/scripts/check-release-hygiene.sh --backend
  workspace/scripts/check-release-hygiene.sh --push-gate

Default mode keeps the repo-wide closeout sweep.
Backend mode adds the backend push gate: typecheck, Seer typecheck, full backend suite.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

echo "== repo state =="
git status --short --branch
echo

echo "== unstaged names =="
git diff --name-only
echo

echo "== staged names =="
git diff --cached --name-only
echo

echo "== unstaged diff stat =="
git diff --stat
echo

if ! git diff --cached --quiet --exit-code; then
  echo "== staged diff stat =="
  git diff --cached --stat
  echo
fi

echo "== diff check =="
git diff --check
echo "ok"
echo


if [ "$mode" = "backend" ]; then
  echo "== backend push gate =="
  npm --prefix systems/back run push-gate
  echo
fi

if ! git diff --cached --quiet --exit-code; then
  echo "== staged diff check =="
  git diff --cached --check
  echo "ok"
  echo
fi

echo "== recent commits =="
git log --oneline --decorate -5
