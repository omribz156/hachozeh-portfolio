#!/usr/bin/env bash
set -euo pipefail

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
  workspace/scripts/render-oracle-resolution-cases.sh --inspect [options]
  workspace/scripts/render-oracle-resolution-cases.sh --approve [options]

Options:
  --inspect                  Read prod inbox, case detail, and public market state. Default.
  --approve                  Approve every gated recommended prod resolution case.
  --expect-count <n>         Require exactly n recommended cases before continuing.
  --market <market-id>       Limit prod resolve-inbox to one market.
  --service-id <id>          Render backend service id. Defaults to prod backend.
  --public-base-url <url>    Public origin. Defaults to https://hachozeh.com.
  --actor-id <id>            Approval actor id. Defaults to oracle_cli_operator.
  --poll-seconds <n>         Render job poll interval. Defaults to 4.
  --poll-attempts <n>        Render job poll attempts. Defaults to 45.
  -h, --help                 Show this help.

Env:
  RENDER_BACKEND_SERVICE_ID
  PUBLIC_BASE_URL
  ORACLE_APPROVAL_ACTOR_ID
  RENDER_ORACLE_POLL_SECONDS
  RENDER_ORACLE_POLL_ATTEMPTS
  RENDER_ORACLE_LOG_LIMIT

Notes:
  - This script runs Oracle inside Render using compiled production JS.
  - --inspect is read-only.
  - --approve is mutating and keeps Oracle's human-gated approval boundary.
  - The script refuses ambiguous/non-official/no-winner cases instead of guessing.
  - Receipts are written under workspace/runtime/render-oracle-resolution-cases/.
EOF
}

die() {
  echo "render-oracle-resolution-cases: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required."
}

shell_quote() {
  printf "'"
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

extract_json_from_render_log() {
  local log_file="$1"
  node - "$log_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
const cleaned = raw
  .split(/\r?\n/)
  .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+/, ""))
  .join("\n");

const objects = [];
let start = -1;
let depth = 0;
let inString = false;
let escape = false;

for (let i = 0; i < cleaned.length; i += 1) {
  const ch = cleaned[i];

  if (start === -1) {
    if (ch === "{") {
      start = i;
      depth = 1;
      inString = false;
      escape = false;
    }
    continue;
  }

  if (escape) {
    escape = false;
    continue;
  }

  if (ch === "\\") {
    escape = true;
    continue;
  }

  if (ch === '"') {
    inString = !inString;
    continue;
  }

  if (inString) {
    continue;
  }

  if (ch === "{") {
    depth += 1;
  } else if (ch === "}") {
    depth -= 1;
    if (depth === 0) {
      const candidate = cleaned.slice(start, i + 1);
      try {
        objects.push(JSON.parse(candidate));
      } catch {
        // Keep scanning; Render logs can include non-JSON lines.
      }
      start = -1;
    }
  }
}

const object = objects.findLast((item) => item && typeof item.objectType === "string") ?? objects.at(-1);
if (!object) {
  console.error(`No JSON object found in ${file}`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(object, null, 2)}\n`);
NODE
}

run_render_job() {
  local label="$1"
  local command_string="$2"
  local start_time job_json job_id job_status job_file log_file json_file

  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  job_json="$(render jobs create "$SERVICE_ID" --start-command "$command_string" --output json --confirm)"
  job_id="$(printf "%s" "$job_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).id));')"

  job_file="$RUN_DIR/${label}.job.json"
  log_file="$RUN_DIR/${label}.log"
  json_file="$RUN_DIR/${label}.json"
  printf "%s\n" "$job_json" > "$job_file"

  echo "render-oracle-resolution-cases: ${label} job=${job_id}" >&2

  job_status="pending"
  for _ in $(seq 1 "$POLL_ATTEMPTS"); do
    job_status="$(render jobs list "$SERVICE_ID" --output json | node -e "
let s = '';
process.stdin.on('data', (d) => s += d);
process.stdin.on('end', () => {
  const jobs = JSON.parse(s);
  const job = jobs.find((item) => item.id === '$job_id');
  process.stdout.write(job ? job.status : 'missing');
});
")"
    echo "render-oracle-resolution-cases: ${label} status=${job_status}" >&2
    case "$job_status" in
      succeeded|failed|canceled)
        break
        ;;
    esac
    sleep "$POLL_SECONDS"
  done

  render logs \
    --resources "$job_id" \
    --start "$start_time" \
    --limit "$LOG_LIMIT" \
    --output text > "$log_file"

  if [[ "$job_status" != "succeeded" ]]; then
    echo "render-oracle-resolution-cases: ${label} logs:" >&2
    sed -n '1,220p' "$log_file" >&2
    die "${label} Render job ended with status=${job_status}."
  fi

  extract_json_from_render_log "$log_file" > "$json_file"
  printf "%s" "$json_file"
}

case_summary_tsv() {
  local inbox_json="$1"
  node - "$inbox_json" "$EXPECTED_COUNT" <<'NODE'
const fs = require("fs");
const inboxPath = process.argv[2];
const expectedRaw = process.argv[3] ?? "";
const inbox = JSON.parse(fs.readFileSync(inboxPath, "utf8"));
const cases = Array.isArray(inbox.recommendedCases) ? inbox.recommendedCases : [];
const expected = expectedRaw === "" ? null : Number(expectedRaw);

if (expected !== null && (!Number.isInteger(expected) || expected < 0)) {
  console.error("--expect-count must be a non-negative integer.");
  process.exit(2);
}

if (expected !== null && cases.length !== expected) {
  console.error(`Expected ${expected} recommended cases, found ${cases.length}.`);
  process.exit(1);
}

for (const item of cases) {
  const values = [
    item.oracleCaseId ?? "",
    item.marketId ?? "",
    item.marketTitle ?? "",
    item.winningOutcomeLabel ?? "",
    item.evidenceSummary ?? ""
  ];
  console.log(values.map((value) => String(value).replace(/\t/g, " ")).join("\t"));
}
NODE
}

validate_case_gate() {
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
const publicSettlement = publicMarket.settlementStatus ?? publicMarket.lifecycle?.settlementStatus ?? null;
const errors = [];

if (item.caseType !== "resolution_check") {
  errors.push(`caseType=${item.caseType ?? "missing"}`);
}
if (item.caseStatus !== "recommended") {
  errors.push(`caseStatus=${item.caseStatus ?? "missing"}`);
}
if (item.marketStatus !== "closed") {
  errors.push(`marketStatus=${item.marketStatus ?? "missing"}`);
}
if (!item.winningOutcomeId || !item.winningOutcomeLabel) {
  errors.push("missing winning outcome mapping");
}
if (!item.evidencePacket?.evidencePacketId || (item.evidencePacket?.sourceCount ?? sources.length) < 1) {
  errors.push("missing evidence packet/source");
}

const hasOfficialSource = sources.some((source) => {
  const type = String(source.sourceType ?? "").toLowerCase();
  const label = String(source.sourceLabel ?? "").toLowerCase();
  return type.includes("official") || type.includes("canonical") || label.includes("official");
});
if (!hasOfficialSource) {
  errors.push("no official/canonical evidence source");
}
if (publicStatus === "resolved" || publicSettlement === "completed") {
  errors.push(`public market already ${publicStatus}/${publicSettlement}`);
}

const summary = {
  marketId: item.marketId,
  marketTitle: item.marketTitle,
  oracleCaseId: item.oracleCaseId,
  winner: item.winningOutcomeLabel,
  evidence: item.evidencePacket?.evidenceSummary ?? detail.outputSnapshot?.reasonSummary ?? null,
  source: sources.map((source) => ({
    label: source.sourceLabel,
    type: source.sourceType,
    url: source.sourceUrl
  })),
  publicStatus,
  publicSettlement
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) {
  console.error(`Gate failed for ${item.oracleCaseId ?? "unknown case"}: ${errors.join("; ")}`);
  process.exit(1);
}
NODE
}

validate_approval_result() {
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
const winner = publicMarket.winner ?? publicMarket.result?.winner ?? null;
const marketStatus = publicMarket.marketStatus ?? publicMarket.status ?? publicMarket.result?.status ?? null;
const settlementStatus =
  publicMarket.settlementStatus ?? publicMarket.lifecycle?.settlementStatus ?? publicMarket.result?.settlementStatus ?? null;
const errors = [];

if (approval.review?.resultStatus !== "completed" || approval.outcome !== "approved_resolution") {
  errors.push(`approval=${approval.outcome ?? "missing"}/${approval.review?.resultStatus ?? "missing"}`);
}
if (approval.resolution?.status !== "resolved") {
  errors.push(`resolutionStatus=${approval.resolution?.status ?? "missing"}`);
}
if (approval.resolution?.settlementStatus !== "completed") {
  errors.push(`resolutionSettlement=${approval.resolution?.settlementStatus ?? "missing"}`);
}
if (marketStatus !== "resolved") {
  errors.push(`publicStatus=${marketStatus ?? "missing"}`);
}
if (settlementStatus !== "completed") {
  errors.push(`publicSettlement=${settlementStatus ?? "missing"}`);
}
if (winner?.label !== item.winningOutcomeLabel && winner?.outcomeId !== item.winningOutcomeId) {
  errors.push(`publicWinner=${winner?.label ?? winner?.outcomeId ?? "missing"}`);
}

const summary = {
  marketId: item.marketId,
  oracleCaseId: item.oracleCaseId,
  resolutionId: approval.resolution?.resolutionId ?? approval.review?.resolutionId ?? null,
  winner: winner?.label ?? item.winningOutcomeLabel,
  marketStatus,
  settlementStatus,
  resolvedAt: publicMarket.resolvedAt ?? publicMarket.result?.resolvedAt ?? publicMarket.lifecycle?.resolvedAt ?? null
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) {
  console.error(`Approval verification failed for ${item.oracleCaseId ?? "unknown case"}: ${errors.join("; ")}`);
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

require_command render
require_command node
require_command curl

[[ "$MODE" == "inspect" || "$MODE" == "approve" ]] || die "mode must be inspect or approve."
[[ -n "$SERVICE_ID" ]] || die "--service-id is required."
[[ -n "$PUBLIC_BASE_URL" ]] || die "--public-base-url is required."
[[ -n "$ACTOR_ID" ]] || die "--actor-id is required."
if [[ "$MARKET_ID" =~ [[:space:]] ]]; then
  die "--market must be a market id/key without whitespace."
fi
if [[ "$ACTOR_ID" =~ [[:space:]] ]]; then
  die "--actor-id must not contain whitespace."
fi

PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
RUN_DIR="workspace/runtime/render-oracle-resolution-cases/$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "$RUN_DIR"

echo "render-oracle-resolution-cases: mode=${MODE} service=${SERVICE_ID} receipts=${RUN_DIR}"

inbox_command="node dist/oracle/src/oracle-cli.js resolve-inbox --json"
if [[ -n "$MARKET_ID" ]]; then
  inbox_command="node dist/oracle/src/oracle-cli.js resolve-inbox --market ${MARKET_ID} --json"
fi

inbox_json="$(run_render_job "resolve-inbox" "$inbox_command")"
cases_tsv="$RUN_DIR/recommended-cases.tsv"
case_summary_tsv "$inbox_json" > "$cases_tsv"

if [[ ! -s "$cases_tsv" ]]; then
  echo "render-oracle-resolution-cases: no recommended cases."
  echo "render-oracle-resolution-cases: done receipts=${RUN_DIR}"
  exit 0
fi

echo "render-oracle-resolution-cases: recommended cases:"
while IFS=$'\t' read -r case_id market_id market_title winner_label evidence_summary; do
  echo "- ${market_id} | case=${case_id} | winner=${winner_label} | ${evidence_summary}"
done < "$cases_tsv"

while IFS=$'\t' read -r case_id market_id market_title winner_label evidence_summary; do
  [[ -n "$case_id" ]] || die "recommended case missing oracleCaseId."
  [[ -n "$market_id" ]] || die "recommended case ${case_id} missing marketId."

  echo "render-oracle-resolution-cases: inspecting case=${case_id} market=${market_id}"
  detail_json="$(run_render_job "case-detail-${case_id}" "node dist/oracle/src/oracle-cli.js case-detail --case ${case_id} --json")"

  public_before_json="$RUN_DIR/public-before-${market_id}.json"
  curl -fsS "${PUBLIC_BASE_URL}/api/markets/${market_id}" > "$public_before_json"

  summary_json="$RUN_DIR/gate-${case_id}.json"
  validate_case_gate "$detail_json" "$public_before_json" > "$summary_json"
  node - "$summary_json" <<'NODE'
const fs = require("fs");
const item = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`  ok: ${item.marketTitle} -> ${item.winner}`);
console.log(`      evidence: ${item.evidence}`);
console.log(`      source: ${(item.source ?? []).map((source) => source.label).filter(Boolean).join(", ")}`);
NODE

  if [[ "$MODE" != "approve" ]]; then
    continue
  fi

  idempotency_key="approve-resolution:${case_id}"
  approve_command="node dist/oracle/src/oracle-cli.js approve-resolution-case --case ${case_id} --actor-id ${ACTOR_ID} --idempotency-key ${idempotency_key} --json"

  echo "render-oracle-resolution-cases: approving case=${case_id}"
  approval_json="$(run_render_job "approve-${case_id}" "$approve_command")"

  public_after_json="$RUN_DIR/public-after-${market_id}.json"
  curl -fsS "${PUBLIC_BASE_URL}/api/markets/${market_id}" > "$public_after_json"

  approval_summary_json="$RUN_DIR/approval-${case_id}.summary.json"
  validate_approval_result "$detail_json" "$approval_json" "$public_after_json" > "$approval_summary_json"
  node - "$approval_summary_json" <<'NODE'
const fs = require("fs");
const item = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`  resolved: ${item.marketId} -> ${item.winner} (${item.settlementStatus})`);
NODE
done < "$cases_tsv"

if [[ "$MODE" == "approve" ]]; then
  post_inbox_json="$(run_render_job "post-resolve-inbox" "$inbox_command")"
  node - "$post_inbox_json" <<'NODE'
const fs = require("fs");
const inbox = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const counts = {
  missing: inbox.missingCaseCount ?? 0,
  recommended: inbox.recommendedCaseCount ?? 0,
  reviewNeeded: inbox.reviewNeededCaseCount ?? 0
};
console.log(`render-oracle-resolution-cases: post inbox missing=${counts.missing} recommended=${counts.recommended} reviewNeeded=${counts.reviewNeeded}`);
if (counts.missing !== 0 || counts.recommended !== 0 || counts.reviewNeeded !== 0) {
  process.exit(1);
}
NODE
fi

echo "render-oracle-resolution-cases: done receipts=${RUN_DIR}"
