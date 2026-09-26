#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"

MODE="inspect"
SERVICE_ID="${RENDER_BACKEND_SERVICE_ID:-srv-configure-your-service}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://hachozeh.com}"
EXPECTED_COUNT=""
MARKET_ID=""
ACTOR_ID="${ORACLE_APPROVAL_ACTOR_ID:-oracle_cli_operator}"
POLL_SECONDS="${RENDER_ORACLE_POLL_SECONDS:-4}"
POLL_ATTEMPTS="${RENDER_ORACLE_POLL_ATTEMPTS:-45}"
LOG_LIMIT="${RENDER_ORACLE_LOG_LIMIT:-500}"
RUN_DIR=""

usage() {
  cat <<'EOF'
Usage:
  workspace/scripts/render-oracle-close-cases.sh --inspect [options]
  workspace/scripts/render-oracle-close-cases.sh --approve [options]

Options:
  --inspect                  Read prod close-condition cases. Default.
  --approve                  Approve every gated recommended close-condition case.
  --expect-count <n>         Require exactly n recommended close cases.
  --market <market-id>       Limit to one market.
  --service-id <id>          Render backend service id. Defaults to prod backend.
  --public-base-url <url>    Public origin. Defaults to https://hachozeh.com.
  --actor-id <id>            Approval actor id. Defaults to oracle_cli_operator.
  --poll-seconds <n>         Render job poll interval. Defaults to 4.
  --poll-attempts <n>        Render job poll attempts. Defaults to 45.
  -h, --help                 Show this help.

Notes:
  - --inspect is read-only.
  - --approve is mutating: it approves Oracle close-condition cases and lets
    Horizon close the market through the trusted close path.
EOF
}

case_summary_tsv() {
  local queue_json="$1"
  node - "$queue_json" "$EXPECTED_COUNT" "$MARKET_ID" <<'NODE'
const fs = require("fs");
const queue = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expectedRaw = process.argv[3] ?? "";
const marketFilter = process.argv[4] ?? "";
const expected = expectedRaw === "" ? null : Number(expectedRaw);
let cases = Array.isArray(queue.items) ? queue.items : [];
cases = cases.filter((item) => item.caseType === "close_condition_check");
if (marketFilter) cases = cases.filter((item) => item.marketId === marketFilter);

if (expected !== null && (!Number.isInteger(expected) || expected < 0)) {
  console.error("--expect-count must be a non-negative integer.");
  process.exit(2);
}
if (expected !== null && cases.length !== expected) {
  console.error(`Expected ${expected} recommended close cases, found ${cases.length}.`);
  process.exit(1);
}
for (const item of cases) {
  const values = [
    item.oracleCaseId ?? "",
    item.marketId ?? "",
    item.marketTitle ?? "",
    item.evidencePacket?.evidenceSummary ?? item.summary ?? ""
  ];
  console.log(values.map((value) => String(value).replace(/\t/g, " ")).join("\t"));
}
NODE
}

validate_close_gate() {
  local detail_json="$1"
  local public_json="$2"
  node - "$detail_json" "$public_json" <<'NODE'
const fs = require("fs");
const detail = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const publicPayload = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const item = detail.item ?? {};
const publicMarket = publicPayload.market ?? publicPayload;
const sources = Array.isArray(detail.evidenceSources) ? detail.evidenceSources : [];
const publicStatus = publicMarket.marketStatus ?? publicMarket.status ?? publicMarket.result?.status ?? null;
const errors = [];

if (item.caseType !== "close_condition_check") errors.push(`caseType=${item.caseType ?? "missing"}`);
if (item.caseStatus !== "recommended") errors.push(`caseStatus=${item.caseStatus ?? "missing"}`);
if (item.marketStatus !== "open") errors.push(`marketStatus=${item.marketStatus ?? "missing"}`);
if (item.output?.outputType !== "early_close_recommendation") errors.push(`outputType=${item.output?.outputType ?? "missing"}`);
if (item.evidencePacket?.closeConditionSatisfied !== true) errors.push("close condition not explicitly satisfied");
if (publicStatus !== "open") errors.push(`publicStatus=${publicStatus ?? "missing"}`);

const hasOfficialSource = sources.some((source) => {
  const type = String(source.sourceType ?? "").toLowerCase();
  const label = String(source.sourceLabel ?? "").toLowerCase();
  return type.includes("official") || type.includes("canonical") || label.includes("official");
});
if (!hasOfficialSource) errors.push("no official/canonical evidence source");

const summary = {
  marketId: item.marketId,
  marketTitle: item.marketTitle,
  oracleCaseId: item.oracleCaseId,
  evidence: item.evidencePacket?.evidenceSummary ?? detail.outputSnapshot?.reasonSummary ?? null,
  closeConditionSatisfied: item.evidencePacket?.closeConditionSatisfied ?? null,
  source: sources.map((source) => ({
    label: source.sourceLabel,
    type: source.sourceType,
    url: source.sourceUrl
  })),
  publicStatus
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) {
  console.error(`Gate failed for ${item.oracleCaseId ?? "unknown case"}: ${errors.join("; ")}`);
  process.exit(1);
}
NODE
}

validate_close_approval() {
  local detail_json="$1"
  local approval_json="$2"
  local public_json="$3"
  node - "$detail_json" "$approval_json" "$public_json" <<'NODE'
const fs = require("fs");
const detail = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const approval = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const publicPayload = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
const item = detail.item ?? {};
const publicMarket = publicPayload.market ?? publicPayload;
const publicStatus = publicMarket.marketStatus ?? publicMarket.status ?? publicMarket.result?.status ?? null;
const errors = [];

if (approval.review?.resultStatus !== "completed" || approval.outcome !== "approved_close_condition") {
  errors.push(`approval=${approval.outcome ?? "missing"}/${approval.review?.resultStatus ?? "missing"}`);
}
if (approval.close?.status !== "closed") errors.push(`closeStatus=${approval.close?.status ?? "missing"}`);
if (publicStatus !== "closed") errors.push(`publicStatus=${publicStatus ?? "missing"}`);

const summary = {
  marketId: item.marketId,
  oracleCaseId: item.oracleCaseId,
  closeAuditEventId: approval.close?.auditEventId ?? null,
  publicStatus,
  closedAt: publicMarket.lifecycle?.closedAt ?? publicMarket.closedAt ?? null
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) {
  console.error(`Close approval verification failed for ${item.oracleCaseId ?? "unknown case"}: ${errors.join("; ")}`);
  process.exit(1);
}
NODE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --inspect)
      MODE="inspect"
      shift
      ;;
    --approve)
      MODE="approve"
      shift
      ;;
    --expect-count)
      EXPECTED_COUNT="${2:-}"
      shift 2
      ;;
    --expect-count=*)
      EXPECTED_COUNT="${1#--expect-count=}"
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
    --actor-id)
      ACTOR_ID="${2:-}"
      shift 2
      ;;
    --actor-id=*)
      ACTOR_ID="${1#--actor-id=}"
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

[[ "$MODE" == "inspect" || "$MODE" == "approve" ]] || render_job_die "mode must be inspect or approve."
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
if [[ "$MARKET_ID" =~ [[:space:]] ]]; then
  render_job_die "--market must be a market id/key without whitespace."
fi
if [[ "$ACTOR_ID" =~ [[:space:]] ]]; then
  render_job_die "--actor-id must not contain whitespace."
fi
RUN_DIR="$repo_root/workspace/runtime/render-oracle-close-cases/$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "$RUN_DIR"

export RENDER_JSON_JOB_SERVICE_ID="$SERVICE_ID"
export RENDER_JSON_JOB_RUN_DIR="$RUN_DIR"
export RENDER_JSON_JOB_POLL_SECONDS="$POLL_SECONDS"
export RENDER_JSON_JOB_POLL_ATTEMPTS="$POLL_ATTEMPTS"
export RENDER_JSON_JOB_LOG_LIMIT="$LOG_LIMIT"

echo "render-oracle-close-cases: mode=${MODE} service=${SERVICE_ID} receipts=${RUN_DIR}"

queue_json="$(render_json_job "review-queue" "node dist/oracle/src/oracle-cli.js review-queue --case-status recommended --json")"
cases_tsv="$RUN_DIR/recommended-close-cases.tsv"
case_summary_tsv "$queue_json" > "$cases_tsv"

if [[ ! -s "$cases_tsv" ]]; then
  echo "render-oracle-close-cases: no recommended close-condition cases."
  echo "render-oracle-close-cases: done receipts=${RUN_DIR}"
  exit 0
fi

while IFS=$'\t' read -r case_id market_id market_title evidence_summary; do
  echo "- ${market_id} | case=${case_id} | ${evidence_summary}"
done < "$cases_tsv"

while IFS=$'\t' read -r case_id market_id market_title evidence_summary; do
  detail_json="$(render_json_job "case-detail-${case_id}" "node dist/oracle/src/oracle-cli.js case-detail --case ${case_id} --json")"
  public_before_json="$RUN_DIR/public-before-${market_id}.json"
  curl -fsS "${PUBLIC_BASE_URL}/api/markets/${market_id}" > "$public_before_json"

  gate_json="$RUN_DIR/gate-${case_id}.json"
  validate_close_gate "$detail_json" "$public_before_json" > "$gate_json"
  node - "$gate_json" <<'NODE'
const fs = require("fs");
const item = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`  ok: ${item.marketTitle}`);
console.log(`      evidence: ${item.evidence}`);
console.log(`      source: ${(item.source ?? []).map((source) => source.label).filter(Boolean).join(", ")}`);
NODE

  if [[ "$MODE" != "approve" ]]; then
    continue
  fi

  idempotency_key="approve-close:${case_id}"
  approve_command="node dist/oracle/src/oracle-cli.js approve-close-condition-case --case ${case_id} --actor-id ${ACTOR_ID} --idempotency-key ${idempotency_key} --json"

  approval_json="$(render_json_job "approve-${case_id}" "$approve_command")"
  public_after_json="$RUN_DIR/public-after-${market_id}.json"
  curl -fsS "${PUBLIC_BASE_URL}/api/markets/${market_id}" > "$public_after_json"

  approval_summary="$RUN_DIR/approval-${case_id}.summary.json"
  validate_close_approval "$detail_json" "$approval_json" "$public_after_json" > "$approval_summary"
  node - "$approval_summary" <<'NODE'
const fs = require("fs");
const item = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`  closed: ${item.marketId} (${item.publicStatus})`);
NODE
done < "$cases_tsv"

echo "render-oracle-close-cases: done receipts=${RUN_DIR}"
