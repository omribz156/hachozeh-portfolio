#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"

SERVICE_ID="${RENDER_BACKEND_SERVICE_ID:-srv-configure-your-service}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://hachozeh.com}"
MARKET_ID=""
POLL_SECONDS="${RENDER_ORACLE_POLL_SECONDS:-4}"
POLL_ATTEMPTS="${RENDER_ORACLE_POLL_ATTEMPTS:-45}"
LOG_LIMIT="${RENDER_ORACLE_LOG_LIMIT:-500}"
RUN_DIR=""

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/open-market-doctor.sh [options]

Options:
  --market <market-id>       Inspect one market. Without this, inspects lifecycle globally.
  --service-id <id>          Render backend service id. Defaults to prod backend.
  --public-base-url <url>    Public origin. Defaults to https://hachozeh.com.
  --poll-seconds <n>         Render job poll interval. Defaults to 4.
  --poll-attempts <n>        Render job poll attempts. Defaults to 45.
  -h, --help                 Show this help.

What it checks:
  - prod lifecycle-run dry run inside Render
  - public market API when --market is supplied
  - Horizon/Oracle actions, warnings, blockers, and inbox pressure

This script is read-only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --market)
      MARKET_ID="${2:-}"
      shift 2
      ;;
    --market=*)
      MARKET_ID="${1#--market=}"
      shift
      ;;
    --service-id)
      SERVICE_ID="${2:-}"
      shift 2
      ;;
    --service-id=*)
      SERVICE_ID="${1#--service-id=}"
      shift
      ;;
    --public-base-url)
      PUBLIC_BASE_URL="${2:-}"
      shift 2
      ;;
    --public-base-url=*)
      PUBLIC_BASE_URL="${1#--public-base-url=}"
      shift
      ;;
    --poll-seconds)
      POLL_SECONDS="${2:-}"
      shift 2
      ;;
    --poll-seconds=*)
      POLL_SECONDS="${1#--poll-seconds=}"
      shift
      ;;
    --poll-attempts)
      POLL_ATTEMPTS="${2:-}"
      shift 2
      ;;
    --poll-attempts=*)
      POLL_ATTEMPTS="${1#--poll-attempts=}"
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

render_job_require_command render
render_job_require_command node
render_job_require_command curl

PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
if [[ "$MARKET_ID" =~ [[:space:]] ]]; then
  render_job_die "--market must be a market id/key without whitespace."
fi
RUN_DIR="$repo_root/workspace/runtime/open-market-doctor/$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "$RUN_DIR"

export RENDER_JSON_JOB_SERVICE_ID="$SERVICE_ID"
export RENDER_JSON_JOB_RUN_DIR="$RUN_DIR"
export RENDER_JSON_JOB_POLL_SECONDS="$POLL_SECONDS"
export RENDER_JSON_JOB_POLL_ATTEMPTS="$POLL_ATTEMPTS"
export RENDER_JSON_JOB_LOG_LIMIT="$LOG_LIMIT"

lifecycle_command="node dist/oracle/src/oracle-cli.js lifecycle-run --dry-run true --limit 100 --json"
if [[ -n "$MARKET_ID" ]]; then
  lifecycle_command="node dist/oracle/src/oracle-cli.js lifecycle-run --dry-run true --market ${MARKET_ID} --json"
fi

echo "open-market-doctor: service=${SERVICE_ID} receipts=${RUN_DIR}"
lifecycle_json="$(render_json_job "lifecycle-run" "$lifecycle_command")"

public_json=""
if [[ -n "$MARKET_ID" ]]; then
  public_json="$RUN_DIR/public-market.json"
  curl -fsS "${PUBLIC_BASE_URL}/api/markets/${MARKET_ID}" > "$public_json"
fi

node - "$lifecycle_json" "${public_json:-}" <<'NODE'
const fs = require("fs");
const lifecycle = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const publicPath = process.argv[3] || "";
const publicPayload = publicPath ? JSON.parse(fs.readFileSync(publicPath, "utf8")) : null;
const market = publicPayload?.market ?? publicPayload;
const actions = Array.isArray(lifecycle.actions) ? lifecycle.actions : [];
const blockers = Array.isArray(lifecycle.blockers) ? lifecycle.blockers : [];
const warnings = Array.isArray(lifecycle.warnings) ? lifecycle.warnings : [];
const receipts = Array.isArray(lifecycle.receipts) ? lifecycle.receipts : [];
const inbox = lifecycle.phases?.inbox ?? {};

const summary = {
  objectType: "open_market_doctor_summary",
  marketId: lifecycle.marketId ?? market?.marketId ?? null,
  public: market
    ? {
        marketId: market.marketId,
        title: market.title ?? market.marketTitle ?? null,
        marketStatus: market.marketStatus ?? market.status ?? null,
        closeAt: market.lifecycle?.closeAt ?? null,
        expectedResolutionAt: market.lifecycle?.expectedResolutionAt ?? null,
        settlementStatus: market.settlementStatus ?? market.lifecycle?.settlementStatus ?? null,
        publicPath: market.publicPath ?? null,
        sourceLabel:
          market.result?.source?.label ??
          market.trust?.resolutionSource ??
          market.trust?.contract?.resolutionSource?.label ??
          null,
        sourceUrl:
          market.result?.source?.url ??
          market.trust?.sourceUrl ??
          market.trust?.contract?.resolutionSource?.url ??
          null
      }
    : null,
  lifecycle: {
    status: lifecycle.status,
    dryRun: lifecycle.dryRun,
    mutationMode: lifecycle.mutationMode,
    nextRecommendedRunAt: lifecycle.nextRecommendedRunAt,
    closeDueCandidates: lifecycle.phases?.closeDueMarkets?.candidateCount ?? lifecycle.phases?.closeDueMarkets?.closeCandidateCount ?? null,
    closeConditionCreatedCaseCount: lifecycle.phases?.closeCondition?.createdCaseCount ?? null,
    closeConditionSatisfiedCount: lifecycle.phases?.closeCondition?.satisfiedCount ?? null,
    capability: lifecycle.phases?.capability
      ? {
          checked: lifecycle.phases.capability.checkedMarketCount,
          supported: lifecycle.phases.capability.supportedCount,
          unsupported: lifecycle.phases.capability.unsupportedCount,
          incomplete: lifecycle.phases.capability.incompleteCount,
          manual: lifecycle.phases.capability.manualResolutionRequiredCount,
          blocked: lifecycle.phases.capability.blockedByContractCount
        }
      : null,
    sourceSnapshots: lifecycle.phases?.sourceSnapshots
      ? {
          checked: lifecycle.phases.sourceSnapshots.checkedMarketCount,
          captured: lifecycle.phases.sourceSnapshots.capturedCount,
          skippedExisting: lifecycle.phases.sourceSnapshots.skippedExistingCount
        }
      : null,
    inbox: {
      missing: inbox.missingCaseCount ?? null,
      recommended: inbox.recommendedCaseCount ?? null,
      reviewNeeded: inbox.reviewNeededCaseCount ?? null
    },
    actionCount: actions.length,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    receiptCount: receipts.length
  },
  actions: actions.map((item) => ({
    actionType: item.actionType,
    riskLevel: item.riskLevel,
    requiresExplicitApproval: item.requiresExplicitApproval,
    marketId: item.marketId,
    oracleCaseId: item.oracleCaseId,
    reason: item.reason,
    command: item.command
  })),
  blockers,
  warnings
};

console.log(JSON.stringify(summary, null, 2));

if (blockers.length > 0) {
  process.exitCode = 1;
}
NODE

echo "open-market-doctor: done receipts=${RUN_DIR}"
