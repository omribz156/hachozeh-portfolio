#!/usr/bin/env bash
# platform-checks — the periodic health-check suite that the HTTP watchdog
# does not cover. Runs the cheap, read-only freshness probes and lets each
# one fire its own platform alert. Intended caller: the com.hachozeh.platform
# -checks launchd agent (every 5 min) installed by install-platform-checks
# -launchd.sh; also runnable by hand.
#
# Covers alert-coverage gaps 1 + 2 (2026-06-11 audit) + the runtime-postgres
# blind spot found in the partial-failure review:
#   - postgres reachability + OrbStack self-heal (check-postgres.sh)
#   - oracle worker heartbeat freshness          (check-oracle-heartbeat.sh)
#   - nightly backup freshness                   (check-backup-freshness.sh)
#
# Each check is independent: one failing never blocks the others, and the
# suite's own exit code is nonzero if ANY check failed (for manual runs).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# launchd hands a minimal PATH; nc/python3/curl used downstream want the real one.
export PATH="${HOME}/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

rc=0
for check in check-postgres.sh check-oracle-heartbeat.sh check-backup-freshness.sh; do
  if [ -x "${SCRIPT_DIR}/${check}" ]; then
    "${SCRIPT_DIR}/${check}" || rc=1
  fi
done
exit "$rc"
