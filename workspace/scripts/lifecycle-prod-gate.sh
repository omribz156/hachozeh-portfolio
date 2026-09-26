#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
receipt_dir="${LIFECYCLE_PROD_GATE_RECEIPT_DIR:-$repo_root/workspace/runtime/lifecycle-prod-gate/$stamp}"
run_production_doctor="${RUN_PRODUCTION_DOCTOR:-false}"

mkdir -p "$receipt_dir"
cd "$repo_root"

log() {
  printf '[lifecycle-prod-gate] %s\n' "$*"
}

run_json_step() {
  local name="$1"
  shift
  local output="$receipt_dir/${name}.json"

  log "$name -> $output"
  "$@" > "$output"
}

run_optional_json_step() {
  local name="$1"
  shift

  if [ "$run_production_doctor" != "true" ]; then
    log "$name skipped (set RUN_PRODUCTION_DOCTOR=true after public origin is live)"
    return
  fi

  run_json_step "$name" "$@"
}

run_json_step \
  horizon_scheduler_once \
  npm --silent --prefix systems/back run horizon:scheduler:once -- --dry-run true --persist-snapshot false --json

run_json_step \
  oracle_lifecycle_heartbeat_once \
  npm --silent --prefix systems/back run oracle -- lifecycle-heartbeat --dry-run true --max-ticks 1 --interval-ms 0 --json

run_json_step \
  oracle_family_route_audit \
  npm --silent --prefix systems/back run oracle -- family-route-audit --json

run_json_step \
  oracle_resolve_inbox \
  npm --silent --prefix systems/back run oracle -- resolve-inbox --json

run_optional_json_step \
  production_doctor \
  npm --silent --prefix systems/back run doctor:production -- --json

node - "$receipt_dir" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const receiptDir = process.argv[2];
const read = (name) => {
  const file = path.join(receiptDir, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const horizon = read("horizon_scheduler_once");
const heartbeat = read("oracle_lifecycle_heartbeat_once");
const familyAudit = read("oracle_family_route_audit");
const inbox = read("oracle_resolve_inbox");
const doctor = read("production_doctor");

const summary = {
  objectType: "lifecycle_prod_gate_receipt",
  generatedAt: new Date().toISOString(),
  receiptDir,
  horizon: horizon
    ? {
        objectType: horizon.objectType ?? null,
        tickNumber: horizon.tickNumber ?? null,
        closeCandidateCount: horizon.closeCandidateCount ?? null,
        closeExecutionCount: horizon.closeExecutionCount ?? null,
        alertCount: horizon.alertCount ?? null,
        overdueOpenMarketCountAfter:
          horizon.overdueOpenMarketCountAfter ?? null,
        appDbClockSkewMs: horizon.appDbClockSkewMs ?? null
      }
    : null,
  oracleHeartbeat: heartbeat
    ? {
        completedTickCount: heartbeat.completedTickCount ?? null,
        blockerCount: heartbeat.blockerCount ?? null,
        warningCount: heartbeat.warningCount ?? null,
        unsafeActionCount: heartbeat.unsafeActionCount ?? null
      }
    : null,
  familyRouteAudit: familyAudit
    ? {
        status: familyAudit.status ?? null,
        blockerCount: familyAudit.blockerCount ?? null,
        warningCount: familyAudit.warningCount ?? null
      }
    : null,
  resolveInbox: inbox
    ? {
        missingCaseCount: inbox.missingCaseCount ?? null,
        recommendedCaseCount: inbox.recommendedCaseCount ?? null,
        reviewNeededCaseCount: inbox.reviewNeededCaseCount ?? null
      }
    : null,
  productionDoctor: doctor
    ? {
        verdict: doctor.verdict ?? null,
        notes: doctor.notes ?? []
      }
    : null
};

fs.writeFileSync(path.join(receiptDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
NODE

log "receipts: $receipt_dir"
