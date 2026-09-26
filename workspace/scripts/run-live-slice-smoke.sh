#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
[live-smoke] retired: run-live-slice-smoke.sh targeted the removed static systems/front runtime.
[live-smoke] use current proof instead:
[live-smoke]   ./workspace/scripts/check-runtime-baseline.sh
[live-smoke]   ./workspace/scripts/run-browser-qa.sh market-detail-binary
[live-smoke]   bash workspace/skills/navi-runtime-ops/scripts/runtime_snapshot.sh
EOF

exit 2
