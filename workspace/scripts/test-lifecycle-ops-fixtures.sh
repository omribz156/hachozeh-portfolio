#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/workspace/scripts/lib/render-json-job.sh"

fixture="$repo_root/workspace/test/fixtures/lifecycle-ops/render-job-mixed.log"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

extracted="$tmp_dir/extracted.json"
render_job_extract_json_from_log "$fixture" > "$extracted"

node - "$extracted" <<'NODE'
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (payload.objectType !== "resolve_inbox") {
  throw new Error(`unexpected objectType: ${payload.objectType}`);
}
if (payload.counts?.recommended !== 1) {
  throw new Error("recommended count fixture mismatch");
}
NODE

quoted="$(render_job_shell_quote "operator's note")"
if [[ "$quoted" != "'operator'\\''s note'" ]]; then
  echo "shell quote fixture mismatch: $quoted" >&2
  exit 1
fi

render_command="$(render_job_command_from_args node dist/back/src/scripts/set-discovery-curation.js --json --surface hero --position 1 --event event-gta-6-before-israel-2026)"
if [[ "$render_command" != "node dist/back/src/scripts/set-discovery-curation.js --json --surface hero --position 1 --event event-gta-6-before-israel-2026" ]]; then
  echo "render command fixture mismatch: $render_command" >&2
  exit 1
fi

render_command_with_spaces="$(render_job_command_from_args node script.js --note "operator note")"
if [[ "$render_command_with_spaces" != "node script.js --note 'operator note'" ]]; then
  echo "render command whitespace quoting mismatch: $render_command_with_spaces" >&2
  exit 1
fi

bash -n \
  "$repo_root/workspace/scripts/lifecycle-ops.sh" \
  "$repo_root/workspace/scripts/cleanup-runtime-receipts.sh" \
  "$repo_root/workspace/scripts/market-pack-promote.sh" \
  "$repo_root/workspace/scripts/render-market-publish-check.sh" \
  "$repo_root/workspace/scripts/render-backend-tool-job.sh" \
  "$repo_root/workspace/scripts/render-market-contract-patch.sh" \
  "$repo_root/workspace/scripts/render-market-incident-compensation.sh" \
  "$repo_root/workspace/scripts/render-market-incident-reopen.sh" \
  "$repo_root/workspace/scripts/render-market-incident-finalize.sh" \
  "$repo_root/workspace/scripts/open-market-doctor.sh" \
  "$repo_root/workspace/scripts/render-oracle-close-cases.sh" \
  "$repo_root/workspace/scripts/render-oracle-resolution-cases.sh" \
  "$repo_root/workspace/scripts/lib/render-json-job.sh"

"$repo_root/workspace/scripts/lifecycle-ops.sh" --help >/dev/null
"$repo_root/workspace/scripts/cleanup-runtime-receipts.sh" --help >/dev/null
"$repo_root/workspace/scripts/render-backend-tool-job.sh" --help >/dev/null
"$repo_root/workspace/scripts/lifecycle-ops.sh" integrity-scan --market fake >/dev/null
"$repo_root/workspace/scripts/lifecycle-ops.sh" incident-audit --market fake >/dev/null
"$repo_root/workspace/scripts/lifecycle-ops.sh" notification-scan --market fake >/dev/null
"$repo_root/workspace/scripts/lifecycle-ops.sh" queue-doctor --market fake >/dev/null
"$repo_root/workspace/scripts/lifecycle-ops.sh" cascade-preview --market fake --winning-outcome-id out_fake >/dev/null
"$repo_root/workspace/scripts/render-market-contract-patch.sh" --help >/dev/null
"$repo_root/workspace/scripts/render-market-incident-finalize.sh" --help >/dev/null
"$repo_root/workspace/scripts/lifecycle-ops.sh" contract-patch --help >/dev/null
"$repo_root/workspace/scripts/lifecycle-ops.sh" event-partial-smoke --dry-run >/dev/null

echo "test-lifecycle-ops-fixtures: ok"
