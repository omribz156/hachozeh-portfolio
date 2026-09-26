#!/usr/bin/env bash
set -euo pipefail

BASE_REF="origin/main"
EXECUTE="false"
NO_PUSH="false"
PUSH_REMOTE="origin"
RUN_ENV_CHECK="true"

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/render-deploy-from-preview.sh [options]

Options:
  --base <ref>       Compare/deploy stack against ref. Defaults to origin/main.
  --execute          Actually push and deploy. Without this, only preview + dry-run.
  --no-push          Skip git push in execute mode.
  --push-remote <r>  Push remote. Defaults to HTTPS GitHub fallback.
  --skip-env-check   Skip render-env-contract-check.
  -h, --help         Show help.

Purpose:
  One command deploy pipe:
    preview -> env drift note -> env contract check -> render dry-run
    -> optional push+deploy -> receipt summary -> SHA/service checks -> smoke.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_REF="${2:-}"
      shift 2
      ;;
    --base=*)
      BASE_REF="${1#--base=}"
      shift
      ;;
    --execute)
      EXECUTE="true"
      shift
      ;;
    --no-push)
      NO_PUSH="true"
      shift
      ;;
    --push-remote)
      PUSH_REMOTE="${2:-}"
      shift 2
      ;;
    --push-remote=*)
      PUSH_REMOTE="${1#--push-remote=}"
      shift
      ;;
    --skip-env-check)
      RUN_ENV_CHECK="false"
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

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/navi-deploy-preview.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

preview_json="$tmp_dir/preview.json"

workspace/scripts/deploy-target-preview.mjs --base "$BASE_REF" --json > "$preview_json"
workspace/scripts/deploy-target-preview.mjs --base "$BASE_REF"
echo
workspace/scripts/render-env-drift-note.mjs --base "$BASE_REF"
echo

if [[ "$RUN_ENV_CHECK" == "true" ]]; then
  workspace/scripts/render-env-contract-check.mjs
  echo
fi

dry_run_command="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.dryRunCommand);' "$preview_json")"
deploy_command="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.deployCommand);' "$preview_json")"
head_sha="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.head);' "$preview_json")"
targets_json="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify(data.targets));' "$preview_json")"
deploys_web="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write((data.targets ?? []).includes("web") ? "true" : "false");' "$preview_json")"
target_count="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String((data.targets ?? []).length));' "$preview_json")"

echo "Dry-run deploy command:"
if [[ "$target_count" == "0" ]]; then
  echo "none"
  echo
  echo "No deploy targets detected."
  exit 0
fi

echo "$dry_run_command"
eval "$dry_run_command"

if [[ "$EXECUTE" != "true" ]]; then
  echo
  echo "Preview complete. Re-run with --execute to push and deploy."
  exit 0
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  echo "Refusing execute from branch ${current_branch}; expected main." >&2
  exit 1
fi

if [[ "$NO_PUSH" != "true" ]]; then
  git push "$PUSH_REMOTE" main
  git fetch "$PUSH_REMOTE" main:refs/remotes/origin/main
fi

remote_sha="$(git rev-parse origin/main)"
if [[ "$remote_sha" != "$head_sha" ]]; then
  echo "Remote SHA mismatch: origin/main=${remote_sha} expected=${head_sha}" >&2
  exit 1
fi

echo
echo "Executing deploy:"
echo "$deploy_command"
eval "$deploy_command"

run_dir="$(ls -td workspace/runtime/render-deploy/* | head -1)"
echo
workspace/scripts/deploy-receipt-summary.mjs --run-dir "$run_dir"

service_args=()
node - "$targets_json" <<'NODE' > "$tmp_dir/services.txt"
const targets = JSON.parse(process.argv[2]);
const targetToService = {
  backend: "backend",
  web: "web",
  gateway: "gateway",
  horizon: "horizon",
  oracle: "oracle",
  marketWatch: "market-watch",
  prodDoctor: "prod-doctor"
};
for (const target of targets) {
  if (targetToService[target]) console.log(targetToService[target]);
}
NODE
while IFS= read -r service_name; do
  [[ -n "$service_name" ]] && service_args+=(--service "$service_name")
done < "$tmp_dir/services.txt"

if [[ "${#service_args[@]}" -gt 0 ]]; then
  echo
  workspace/scripts/render-service-sha-check.mjs --sha "$head_sha" "${service_args[@]}"
fi

smoke_args=()
workspace/scripts/changed-route-smoke-suggest.mjs --base "$BASE_REF" --json > "$tmp_dir/smoke.json"
node - "$tmp_dir/smoke.json" <<'NODE' > "$tmp_dir/routes.txt"
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const row of data.suggestions ?? []) console.log(row.route);
NODE
while IFS= read -r route; do
  [[ -n "$route" ]] && smoke_args+=(--path "$route")
done < "$tmp_dir/routes.txt"

echo
if [[ "${#smoke_args[@]}" -gt 0 ]]; then
  if [[ "$deploys_web" == "true" ]]; then
    workspace/scripts/post-deploy-smoke.sh --sha "$head_sha" "${smoke_args[@]}"
  else
    workspace/scripts/post-deploy-smoke.sh --sha "$head_sha" --skip-release-check "${smoke_args[@]}"
  fi
else
  if [[ "$deploys_web" == "true" ]]; then
    workspace/scripts/post-deploy-smoke.sh --sha "$head_sha"
  else
    workspace/scripts/post-deploy-smoke.sh --sha "$head_sha" --skip-release-check
  fi
fi
