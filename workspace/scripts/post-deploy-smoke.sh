#!/usr/bin/env bash
set -euo pipefail

PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://hachozeh.com}"
SHA=""
RUN_DIR=""
PATHS=()
SKIP_RELEASE_CHECK="false"

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/post-deploy-smoke.sh --sha <commit> [options]

Options:
  --sha <commit>          Expected deployed SHA/release marker.
  --base-url <url>        Public origin. Defaults to https://hachozeh.com.
  --path <path-or-url>    Extra path to curl. Can be repeated.
  --run-dir <path>        Receipt directory. Defaults to workspace/runtime/post-deploy-smoke/<timestamp>.
  --skip-release-check    Do not require root HTML sentry-release to match --sha.
  -h, --help              Show help.

Purpose:
  Public post-deploy smoke receipts for health, root release marker, SEO /markets,
  static sitemap, and optional changed paths.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha)
      SHA="${2:-}"
      shift 2
      ;;
    --sha=*)
      SHA="${1#--sha=}"
      shift
      ;;
    --base-url)
      PUBLIC_BASE_URL="${2:-}"
      shift 2
      ;;
    --base-url=*)
      PUBLIC_BASE_URL="${1#--base-url=}"
      shift
      ;;
    --path)
      PATHS+=("${2:-}")
      shift 2
      ;;
    --path=*)
      PATHS+=("${1#--path=}")
      shift
      ;;
    --run-dir)
      RUN_DIR="${2:-}"
      shift 2
      ;;
    --run-dir=*)
      RUN_DIR="${1#--run-dir=}"
      shift
      ;;
    --skip-release-check)
      SKIP_RELEASE_CHECK="true"
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

if [[ -z "$SHA" ]]; then
  echo "--sha is required." >&2
  usage >&2
  exit 2
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 127; }
command -v rg >/dev/null 2>&1 || { echo "rg is required." >&2; exit 127; }

PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
RUN_DIR="${RUN_DIR:-workspace/runtime/post-deploy-smoke/$(date -u +"%Y%m%dT%H%M%SZ")}"
mkdir -p "$RUN_DIR"

summary="$RUN_DIR/summary.txt"
: > "$summary"

status_for() {
  local url="$1"
  local body="$2"
  local headers="$3"
  curl -sS -L -D "$headers" -o "$body" -w "%{http_code}" "$url"
}

record() {
  local name="$1"
  local url="$2"
  local expected="$3"
  local body="$RUN_DIR/${name}.body"
  local headers="$RUN_DIR/${name}.headers"
  local status
  status="$(status_for "$url" "$body" "$headers")"
  local result="succeeded"
  if [[ "$status" != "$expected" ]]; then
    result="failed"
  fi
  printf "%s|%s|%s|%s|%s|%s\n" "$name" "$status" "$result" "$url" "$headers" "$body" >> "$summary"
  [[ "$result" == "succeeded" ]]
}

overall="succeeded"

record "edge-health" "$PUBLIC_BASE_URL/edge/health" "200" || overall="failed"
if ! grep -qx "ok" "$RUN_DIR/edge-health.body"; then
  printf "edge-health-body|n/a|failed|expected ok|n/a|%s\n" "$RUN_DIR/edge-health.body" >> "$summary"
  overall="failed"
fi

root_url="$PUBLIC_BASE_URL/?__deploy=${SHA:0:12}"
record "root" "$root_url" "200" || overall="failed"
if [[ "$SKIP_RELEASE_CHECK" != "true" ]] && ! rg -q "sentry-release=${SHA}" "$RUN_DIR/root.body"; then
  printf "root-release|n/a|failed|missing sentry-release=%s|n/a|%s\n" "$SHA" "$RUN_DIR/root.body" >> "$summary"
  overall="failed"
fi

record "markets" "$PUBLIC_BASE_URL/markets?__deploy=${SHA:0:12}" "200" || overall="failed"
if ! rg -q "<title>.*(markets|שווקים)" "$RUN_DIR/markets.body"; then
  printf "markets-title|n/a|failed|missing markets title|n/a|%s\n" "$RUN_DIR/markets.body" >> "$summary"
  overall="failed"
fi

record "static-sitemap" "$PUBLIC_BASE_URL/sitemaps/static.xml?__deploy=${SHA:0:12}" "200" || overall="failed"
if ! rg -q "<loc>${PUBLIC_BASE_URL}/markets</loc>" "$RUN_DIR/static-sitemap.body"; then
  printf "static-sitemap-markets|n/a|failed|missing /markets loc|n/a|%s\n" "$RUN_DIR/static-sitemap.body" >> "$summary"
  overall="failed"
fi

index=0
if [[ "${#PATHS[@]}" -gt 0 ]]; then
  for extra_path in "${PATHS[@]}"; do
    index=$((index + 1))
    if [[ "$extra_path" == http://* || "$extra_path" == https://* ]]; then
      extra_url="$extra_path"
    else
      extra_url="$PUBLIC_BASE_URL/${extra_path#/}"
    fi
    record "extra-${index}" "$extra_url" "200" || overall="failed"
  done
fi

printf "Post-deploy smoke receipts: %s\n\n" "$RUN_DIR"
column -t -s '|' "$summary"

[[ "$overall" == "succeeded" ]]
