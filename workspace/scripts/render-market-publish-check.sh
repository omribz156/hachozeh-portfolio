#!/usr/bin/env bash
set -euo pipefail

SNAPSHOT_PATH=""
DRAFT_ID=""
MARKET_ID=""
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://hachozeh.com}"
RUN_DRY_RUN="true"
RUN_DIR=""
WATCH_PLAN_RECEIPT=""
ALLOW_MISSING_WATCH_PLAN="false"

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/render-market-publish-check.sh --snapshot <path> --draft <draft-id> [options]

Options:
  --snapshot <path>          Market creation draft snapshot JSON.
  --draft <draft-id>         Creation draft id to check.
  --market <market-id>       Optional post-publish public API check.
  --public-base-url <url>    Public origin. Defaults to https://hachozeh.com.
  --skip-dry-run             Skip render-market-agent-job.sh local dry-run.
  --watch-plan-receipt <path> Required when draft declares market-watch pings.
  --allow-missing-watch-plan  Explicitly allow no installed watch plan receipt.
  -h, --help                 Show this help.

Purpose:
  Preflight a production market draft and, when --market is supplied, verify the
  published public API surface. This script does not execute the Render publish.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot)
      SNAPSHOT_PATH="${2:-}"
      shift 2
      ;;
    --snapshot=*)
      SNAPSHOT_PATH="${1#--snapshot=}"
      shift
      ;;
    --draft)
      DRAFT_ID="${2:-}"
      shift 2
      ;;
    --draft=*)
      DRAFT_ID="${1#--draft=}"
      shift
      ;;
    --market)
      MARKET_ID="${2:-}"
      shift 2
      ;;
    --market=*)
      MARKET_ID="${1#--market=}"
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
    --skip-dry-run)
      RUN_DRY_RUN="false"
      shift
      ;;
    --watch-plan-receipt)
      WATCH_PLAN_RECEIPT="${2:-}"
      shift 2
      ;;
    --watch-plan-receipt=*)
      WATCH_PLAN_RECEIPT="${1#--watch-plan-receipt=}"
      shift
      ;;
    --allow-missing-watch-plan)
      ALLOW_MISSING_WATCH_PLAN="true"
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

if [[ -z "$SNAPSHOT_PATH" || -z "$DRAFT_ID" ]]; then
  echo "--snapshot and --draft are required." >&2
  usage >&2
  exit 2
fi

if [[ ! -f "$SNAPSHOT_PATH" ]]; then
  echo "Snapshot file not found: ${SNAPSHOT_PATH}" >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || { echo "node is required." >&2; exit 127; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 127; }

PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
RUN_DIR="workspace/runtime/render-market-publish-check/$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "$RUN_DIR"

preflight_json="$RUN_DIR/preflight.json"

node - "$SNAPSHOT_PATH" "$DRAFT_ID" "$WATCH_PLAN_RECEIPT" "$ALLOW_MISSING_WATCH_PLAN" > "$preflight_json" <<'NODE'
const fs = require("fs");
const [snapshotPath, draftId, watchPlanReceipt, allowMissingWatchPlan] = process.argv.slice(2);
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const items = Array.isArray(snapshot.items) ? snapshot.items : [];
const item = items.find((candidate) => candidate.creationDraftId === draftId);
const errors = [];
const warnings = [];

function containsWatchRequired(value) {
  if (value === "market-watch-pings-only-no-mutation") return true;
  if (Array.isArray(value)) return value.some(containsWatchRequired);
  if (value && typeof value === "object") return Object.values(value).some(containsWatchRequired);
  return false;
}

function collectStrings(value, path = "item", output = []) {
  if (typeof value === "string") {
    output.push({ path, value });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, `${path}[${index}]`, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => collectStrings(entry, `${path}.${key}`, output));
  }
  return output;
}

if (snapshot.objectType !== "market_creation_draft_snapshot") errors.push(`objectType=${snapshot.objectType ?? "missing"}`);
if (!item) errors.push(`draft not found: ${draftId}`);

if (item) {
  const contract = item.contract ?? {};
  const source = contract.resolutionSource ?? {};
  const timeline = contract.timeline ?? {};
  const outcomes = Array.isArray(item.outcomes) ? item.outcomes : [];
  const outcomeMap = Array.isArray(contract.outcomeMap) ? contract.outcomeMap : [];
  const eventSlug = item.eventSlug ?? item.event?.slug ?? contract.displayHints?.eventSlug ?? null;
  const closeAt = timeline.closeAt ?? item.closeAt ?? null;
  const expectedResolutionAt = timeline.expectedResolutionAt ?? item.expectedResolutionAt ?? null;
  const closeMs = closeAt ? Date.parse(closeAt) : NaN;

  if (!item.title) errors.push("missing title");
  if (!eventSlug) errors.push("missing eventSlug/public URL identity");
  if (!contract.objectType) errors.push("missing market_contract_v1");
  if (!contract.measurement) errors.push("missing contract.measurement");
  if (!contract.measurementKind) errors.push("missing measurementKind");
  if (!contract.resultShape) errors.push("missing resultShape");
  if (!contract.oracleCapability) errors.push("missing oracleCapability");
  if (contract.oracleCapability === "blocked") errors.push("oracleCapability=blocked");
  if (!source.label) errors.push("missing resolutionSource.label");
  if (!source.url && !item.trustDisplayUrl) errors.push("missing user-facing resolution source URL");
  if (!Array.isArray(source.sourceIds) || source.sourceIds.length === 0) errors.push("missing sourceIds");
  if (!contract.resolutionRule && !item.resolutionRules) errors.push("missing resolution rule");
  if (!contract.delayPolicy) warnings.push("missing delayPolicy");
  if (!contract.payoutPolicy) warnings.push("missing payoutPolicy");
  if (!closeAt) errors.push("missing closeAt");
  if (closeAt && (!Number.isFinite(closeMs) || closeMs <= Date.now())) errors.push(`closeAt is not in the future: ${closeAt}`);
  if (!expectedResolutionAt) errors.push("missing expectedResolutionAt");
  if (outcomes.length < 2) errors.push("fewer than two outcomes");
  if (outcomes.length > 0 && outcomeMap.length === 0) errors.push("missing outcomeMap");
  if (outcomeMap.length > 0 && outcomeMap.some((outcome) => !outcome.evidenceKey && !outcome.resolutionPath)) {
    errors.push("outcomeMap entries need evidenceKey or resolutionPath");
  }
  if (source.sourceIds?.includes("src_ims_daily_observations")) {
    const closeDate = closeAt && Number.isFinite(closeMs) ? new Date(closeMs).toISOString().slice(0, 10) : null;
    const expectedPathDate = closeDate ? closeDate.replaceAll("-", "/") : null;
    const imsEndpoints = collectStrings(item)
      .filter((entry) => entry.value.includes("api.ims.gov.il") && /\/data\/daily\/\d{4}\/\d{2}\/\d{2}/.test(entry.value));
    if (expectedPathDate) {
      for (const endpoint of imsEndpoints) {
        if (!endpoint.value.includes(`/data/daily/${expectedPathDate}`)) {
          errors.push(`IMS endpoint date mismatch at ${endpoint.path}: expected ${expectedPathDate}`);
        }
      }
    }
  }
  if (containsWatchRequired(item)) {
    if (item.watchPlan && typeof item.watchPlan === "object") {
      warnings.push(`embedded watch plan will install before publish: ${item.watchPlan.id ?? "missing-id"}`);
    } else if (watchPlanReceipt) {
      if (!fs.existsSync(watchPlanReceipt)) {
        errors.push(`watch-plan receipt not found: ${watchPlanReceipt}`);
      }
    } else if (allowMissingWatchPlan === "true") {
      warnings.push("market-watch required but explicitly marked not installed");
    } else {
      errors.push("market-watch required; pass --watch-plan-receipt or --allow-missing-watch-plan");
    }
  }
}

const receipt = {
  objectType: "market_publish_preflight_receipt",
  snapshotPath,
  draftId,
  errors,
  warnings,
  draft: item
    ? {
        title: item.title,
        candidateMarketId: item.candidateMarketId,
        eventSlug: item.eventSlug ?? item.event?.slug ?? item.contract?.displayHints?.eventSlug ?? null,
        category: item.category,
        closeAt: item.contract?.timeline?.closeAt ?? item.closeAt ?? null,
        expectedResolutionAt: item.contract?.timeline?.expectedResolutionAt ?? item.expectedResolutionAt ?? null,
        sourceLabel: item.contract?.resolutionSource?.label ?? null,
        sourceUrl: item.contract?.resolutionSource?.url ?? item.trustDisplayUrl ?? null,
        sourceIds: item.contract?.resolutionSource?.sourceIds ?? [],
        measurementKind: item.contract?.measurementKind ?? null,
        resultShape: item.contract?.resultShape ?? null,
        oracleCapability: item.contract?.oracleCapability ?? null,
        outcomeCount: Array.isArray(item.outcomes) ? item.outcomes.length : null,
        liquidityB: item.liquidityB ?? item.liquidity_b ?? null
      }
    : null
};

console.log(JSON.stringify(receipt, null, 2));
NODE

if [[ -n "$WATCH_PLAN_RECEIPT" ]]; then
  watch_snapshot="$RUN_DIR/watch-draft.json"
  node - "$SNAPSHOT_PATH" "$DRAFT_ID" "$watch_snapshot" <<'NODE'
const fs = require("node:fs");
const [snapshotPath, draftId, outputPath] = process.argv.slice(2);
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
fs.writeFileSync(outputPath, JSON.stringify({
  ...snapshot,
  items: (snapshot.items ?? []).filter((item) => item.creationDraftId === draftId)
}));
NODE
  node workspace/scripts/lib/market-watch-receipt-check.mjs "$watch_snapshot" "$WATCH_PLAN_RECEIPT" \
    > "$RUN_DIR/watch-plan-validation.json"
fi

cat "$preflight_json"

node - "$preflight_json" <<'NODE'
const fs = require("fs");
const receipt = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (Array.isArray(receipt.errors) && receipt.errors.length > 0) {
  process.exit(1);
}
NODE

if [[ "$RUN_DRY_RUN" == "true" ]]; then
  echo "render-market-publish-check: running local wrapper dry-run"
  wrapper_args=(--snapshot "$SNAPSHOT_PATH" --draft "$DRAFT_ID")
  if [[ -n "$WATCH_PLAN_RECEIPT" ]]; then
    wrapper_args+=(--watch-plan-receipt "$WATCH_PLAN_RECEIPT")
  fi
  if [[ "$ALLOW_MISSING_WATCH_PLAN" == "true" ]]; then
    wrapper_args+=(--allow-missing-watch-plan)
  fi
  workspace/scripts/render-market-agent-job.sh "${wrapper_args[@]}" \
    > "$RUN_DIR/wrapper-dry-run.log" 2>&1 || {
      sed -n '1,220p' "$RUN_DIR/wrapper-dry-run.log" >&2
      exit 1
    }
  sed -n '1,120p' "$RUN_DIR/wrapper-dry-run.log"
fi

if [[ -n "$MARKET_ID" ]]; then
  public_json="$RUN_DIR/public-market.json"
  curl -fsS "${PUBLIC_BASE_URL}/api/markets/${MARKET_ID}" > "$public_json"
  node - "$public_json" <<'NODE'
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const market = payload.market ?? payload;
const sourceUrl =
  market.result?.source?.url ??
  market.trust?.sourceUrl ??
  market.trust?.contract?.resolutionSource?.url ??
  null;
const sourceLabel =
  market.result?.source?.label ??
  market.trust?.resolutionSource ??
  market.trust?.contract?.resolutionSource?.label ??
  null;
const errors = [];
if (!market.marketId) errors.push("missing public market id");
if (!market.marketStatus) errors.push("missing public market status");
if (!market.publicPath || !String(market.publicPath).startsWith("/event/")) {
  errors.push(`publicPath is not /event: ${market.publicPath ?? "missing"}`);
}
if (!sourceLabel) errors.push("missing public source label");
if (!sourceUrl) errors.push("missing public source URL");
const receipt = {
  objectType: "market_publish_public_receipt",
  marketId: market.marketId,
  title: market.title ?? market.marketTitle ?? null,
  marketStatus: market.marketStatus,
  publicPath: market.publicPath,
  closeAt: market.lifecycle?.closeAt ?? null,
  expectedResolutionAt: market.lifecycle?.expectedResolutionAt ?? null,
  sourceLabel,
  sourceUrl,
  errors
};
console.log(JSON.stringify(receipt, null, 2));
if (errors.length > 0) process.exit(1);
NODE
fi

echo "render-market-publish-check: done receipts=${RUN_DIR}"
